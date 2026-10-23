"""Real isolated MySQL via its private Unix socket; never production credentials."""
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid

import pymysql
from pymysql.constants import CLIENT

DOCS = 'iso_remix'
SQL = 'iso_business'
CUTOVER = dt.datetime(2026, 9, 25)
tokens_file = Path(tempfile.mkdtemp()) / 'tokens.json'
tokens_file.write_text(json.dumps({DOCS: 'isolated-test-token', SQL: 'isolated-test-token'}))
os.environ['PINYING_TOKENS'] = str(tokens_file)
os.environ['PINYING_STORAGE_PROJECT'] = 'FD-026222'
os.environ['PINYING_RECEIPT_COMPRESSION_ENABLED'] = 'true'

import common


def connection(autocommit=True):
    db = pymysql.connect(unix_socket='/mysql/mysqld.sock', user='root', password='', database='storage_test',
                         charset='utf8mb4', autocommit=autocommit, connect_timeout=5, read_timeout=10,
                         write_timeout=10, client_flag=CLIENT.FOUND_ROWS)
    with db.cursor() as cursor:
        cursor.execute("SET SESSION time_zone='+00:00'")
    return db


class RedisFixture:
    def ping(self): return True
    def close(self): pass
    def pipeline(self, **kwargs): return self
    def setex(self, *args): return self
    def incr(self, *args): return self
    def expire(self, *args): return self
    def execute(self): return []


common.mysql_connection = connection
common.redis_connection = RedisFixture
import sql_gateway as gateway
import documents_repo
import sql_sessions
from growth_maintenance import history_batch, one_cycle, receipt_batch
from receipt_storage import MARKER, ReceiptResultExpired, decode_receipt, encode_receipt


def query(sql, params=()):
    db = connection()
    try:
        with db.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall() if cursor.description else cursor.rowcount
    finally:
        db.close()


def request(method, args, identity=None):
    return gateway.sql_batch(DOCS, {'id': identity or str(uuid.uuid4()), 'repository': 'documents', 'method': method, 'args': args})


def mutation(identity=None):
    return {'id': identity or str(uuid.uuid4()), 'queries': [
        {'sql': 'UPDATE records SET quantity=quantity+1 WHERE id=?', 'params': ['original']},
        {'sql': 'SELECT payload,quantity FROM records WHERE id=?', 'params': ['original']} ]}


class GatewayMysqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        gateway.initialize()
        query('CREATE TABLE pinying_storage_schemas(scope VARCHAR(32) PRIMARY KEY,schema_json JSON NOT NULL)')
        query('CREATE TABLE isolated_records(id VARCHAR(64) PRIMARY KEY,quantity INT NOT NULL,payload LONGTEXT NOT NULL)')
        specs = {'records': {'mysql': 'isolated_records', 'columns': [{'cid': i, 'name': name, 'type': kind, 'notnull': 1, 'dflt_value': None, 'pk': int(i == 0)}
                    for i, (name, kind) in enumerate([('id', 'TEXT'), ('quantity', 'INTEGER'), ('payload', 'TEXT')])],
                    'pk': ['id'], 'indexes': [], 'rowid': True, 'integerPk': None}}
        query('INSERT INTO pinying_storage_schemas VALUES(%s,%s)', (SQL, json.dumps(specs)))
        query('INSERT INTO isolated_records VALUES(%s,%s,%s)', ('original', 0, '真实中文😀完整结果' * 20000))
        cls.server = gateway.ThreadingHTTPServer(('127.0.0.1', 0), gateway.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        query('UPDATE isolated_records SET quantity=0 WHERE id=%s', ('original',))

    def http(self, route, body=None):
        url = 'http://127.0.0.1:' + str(self.server.server_port) + route
        req = urllib.request.Request(url, None if body is None else json.dumps(body).encode(),
                                     {'Authorization': 'Bearer isolated-test-token', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_document_reads_have_no_durable_receipts_and_ignore_write_lock(self):
        path = '/isolated/read.json'
        db = connection(False)
        saved = documents_repo.invoke(db, DOCS, 'commit', [path, 0, {'value': '中文'}]); db.commit(); db.close()
        locker = connection()
        with locker.cursor() as cursor:
            cursor.execute('SELECT GET_LOCK(%s,0)', ('pinying:scope:' + DOCS,)); self.assertEqual(cursor.fetchone()[0], 1)
        try:
            ids = []
            started = time.monotonic()
            for method, args in [('read', [path]), ('readFile', [path]), ('readIfChanged', [path, saved['version']]),
                                 ('readTextIfChanged', [path, saved['version']]), ('statFile', [path]), ('listFiles', ['/isolated'])]:
                identity = str(uuid.uuid4()); ids.append(identity); request(method, args, identity)
            self.assertLess(time.monotonic() - started, 3)
            for identity in ids:
                self.assertEqual(query('SELECT request_id FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (DOCS, identity)), ())
        finally:
            locker.close()

    def test_large_mixed_write_retry_returns_exact_original_once(self):
        payload = mutation()
        original = gateway.sql_batch(SQL, payload)
        self.assertEqual(gateway.sql_batch(SQL, payload), original)
        self.assertEqual(query('SELECT quantity FROM isolated_records')[0][0], 1)
        saved = query('SELECT fingerprint,response_json FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (SQL, payload['id']))[0]
        self.assertLess(len(saved[1]), len(json.dumps(original)) / 10)
        self.assertEqual(decode_receipt(saved[1], SQL, payload['id'], saved[0]), original)
        changed = copy.deepcopy(payload); changed['queries'][0]['params'] = ['different']
        with self.assertRaises(ValueError): gateway.sql_batch(SQL, changed)
        self.assertEqual(query('SELECT quantity FROM isolated_records')[0][0], 1)

    def test_failed_batch_rolls_back_business_and_receipt(self):
        identity = str(uuid.uuid4())
        with self.assertRaises(pymysql.IntegrityError):
            gateway.sql_batch(SQL, {'id': identity, 'queries': [
                {'sql': 'UPDATE records SET quantity=99', 'params': []},
                {'sql': 'INSERT INTO records(id,quantity,payload) VALUES(?,?,?)', 'params': ['original', 7, 'duplicate']} ]})
        self.assertEqual(query('SELECT quantity FROM isolated_records')[0][0], 0)
        self.assertEqual(query('SELECT request_id FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (SQL, identity)), ())

    def test_lost_commit_response_is_read_back_without_second_mutation(self):
        payload = mutation()
        def lost_response(autocommit=True):
            db = connection(autocommit)
            actual = db.commit
            def commit_then_disconnect():
                actual()
                raise ConnectionError('isolated simulated response loss after real commit')
            db.commit = commit_then_disconnect
            return db
        gateway.mysql_connection = lost_response
        try:
            with self.assertRaises(ConnectionError): gateway.sql_batch(SQL, payload)
        finally:
            gateway.mysql_connection = connection
        result = gateway.sql_batch(SQL, payload)
        self.assertEqual(result[1]['results'][0]['quantity'], 1)
        self.assertEqual(query('SELECT quantity FROM isolated_records')[0][0], 1)

    def test_cas_conflict_leaves_no_new_history_or_receipt(self):
        path = '/isolated/cas.json'
        request('commit', [path, 0, {'value': 1}])
        identity = str(uuid.uuid4())
        digest = hashlib.sha256(path.encode()).digest()
        before = query('SELECT version FROM pinying_document_history WHERE scope=%s AND path_hash=%s', (DOCS, digest))
        with self.assertRaises(ValueError): request('commit', [path, 0, {'value': 2}], identity)
        self.assertEqual(request('read', [path])['data'], {'value': 1})
        self.assertEqual(query('SELECT version FROM pinying_document_history WHERE scope=%s AND path_hash=%s', (DOCS, digest)), before)
        self.assertEqual(query('SELECT request_id FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (DOCS, identity)), ())

    def test_new_history_retention_protects_legacy_checkpoint_and_other_path(self):
        path = '/isolated/history.json'; digest = hashlib.sha256(path.encode()).digest()
        other = hashlib.sha256(b'/isolated/other.json').digest()
        sha = hashlib.sha256(b'{}').hexdigest()
        query('INSERT INTO pinying_documents VALUES(%s,%s,%s,%s,201,%s,UTC_TIMESTAMP(6))', (DOCS, digest, path, '{}', sha))
        for version in range(1, 201):
            captured = CUTOVER - dt.timedelta(days=1) if version <= 100 or version == 110 else CUTOVER + dt.timedelta(days=1)
            if version == 50: captured = CUTOVER + dt.timedelta(days=1)  # backfilled legacy stays below release floor
            query('INSERT INTO pinying_document_history VALUES(%s,%s,%s,%s,%s,%s)', (DOCS, digest, version, '{}', sha, captured))
        query('INSERT INTO pinying_document_history VALUES(%s,%s,2,%s,%s,%s)', (DOCS, other, '{}', sha, CUTOVER + dt.timedelta(days=1)))
        policy = {'paths': {DOCS: [path]}, 'checkpoints': {DOCS: {path: [101, 120]}}, 'floors': {DOCS: {path: 101}},
                  'cutover': CUTOVER, 'retain': 32, 'batch': 8, 'byte_budget': 1024, 'payload_days': 7, 'project': 'FD-026222'}
        for _ in range(12): one_cycle(connection, [DOCS], [], policy)
        kept = {row[0] for row in query('SELECT version FROM pinying_document_history WHERE scope=%s AND path_hash=%s', (DOCS, digest))}
        self.assertTrue(set(range(1, 101)).issubset(kept))
        self.assertTrue({101, 110, 120}.issubset(kept))
        self.assertTrue(set(range(169, 201)).issubset(kept))
        self.assertFalse(102 in kept)
        self.assertEqual(query('SELECT version FROM pinying_document_history WHERE scope=%s AND path_hash=%s', (DOCS, other)), ((2,),))

    def test_maintenance_skips_busy_scope_and_failed_commit_rolls_back(self):
        path = '/isolated/rollback-history.json'; digest = hashlib.sha256(path.encode()).digest(); sha = 'a' * 64
        query('INSERT INTO pinying_documents VALUES(%s,%s,%s,%s,100,%s,UTC_TIMESTAMP(6))', (DOCS, digest, path, '{}', sha))
        query('INSERT INTO pinying_document_history VALUES(%s,%s,40,%s,%s,%s)', (DOCS, digest, '{}', sha, CUTOVER + dt.timedelta(days=1)))
        policy = {'paths': {DOCS: [path]}, 'checkpoints': {}, 'floors': {DOCS: {path: 30}}, 'cutover': CUTOVER,
                  'retain': 32, 'batch': 8, 'byte_budget': 1024, 'payload_days': 7, 'project': 'FD-026222'}
        locker = connection()
        with locker.cursor() as cursor: cursor.execute('SELECT GET_LOCK(%s,0)', ('pinying:scope:' + DOCS,))
        try: self.assertEqual(one_cycle(connection, [DOCS], [], policy), (0, 0))
        finally: locker.close()
        def failed_commit(autocommit=True):
            db = connection(autocommit)
            def fail(): raise ConnectionError('isolated commit rejection')
            db.commit = fail
            return db
        with self.assertRaises(ConnectionError): one_cycle(failed_commit, [DOCS], [], policy)
        self.assertEqual(query('SELECT version FROM pinying_document_history WHERE scope=%s AND path_hash=%s', (DOCS, digest)), ((40,),))

    def test_payload_expiry_preserves_legacy_other_project_and_committed_identity(self):
        payload = mutation(); gateway.sql_batch(SQL, payload)
        created = CUTOVER + dt.timedelta(days=1)
        query('UPDATE pinying_rpc_receipts SET created_at=%s WHERE scope=%s AND request_id=%s', (created, SQL, payload['id']))
        legacy_id = str(uuid.uuid4()); foreign_id = str(uuid.uuid4()); before_id = str(uuid.uuid4())
        legacy = json.dumps({'old': 'legacy' * 20000})
        foreign = encode_receipt({'other': 'foreign' * 20000}, SQL, foreign_id, 'a' * 64, project='OTHER-PROJECT')
        prior = encode_receipt({'prior': 'prior' * 20000}, SQL, before_id, 'a' * 64, project='FD-026222')
        for identity, value, at in [(legacy_id, legacy, created), (foreign_id, foreign, created), (before_id, prior, CUTOVER - dt.timedelta(days=1))]:
            query('INSERT INTO pinying_rpc_receipts VALUES(%s,%s,%s,%s,%s)', (SQL, identity, 'a' * 64, value, at))
        policy = {'project': 'FD-026222', 'cutover': CUTOVER, 'payload_days': 7, 'batch': 8, 'byte_budget': 1024 * 1024}
        db = connection(False)
        try:
            self.assertEqual(receipt_batch(db, SQL, policy, CUTOVER + dt.timedelta(days=10)), 1); db.commit()
        finally: db.close()
        for identity, expected in [(legacy_id, legacy), (foreign_id, foreign), (before_id, prior)]:
            actual = query('SELECT response_json FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (SQL, identity))[0][0]
            self.assertEqual(json.loads(actual), json.loads(expected))
        row = query('SELECT fingerprint,response_json FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (SQL, payload['id']))[0]
        proof = json.loads(row[1])[MARKER]
        self.assertTrue(proof['committed']); self.assertTrue(proof['expired']); self.assertNotIn('content', proof)
        self.assertLess(len(row[1]), 1000)
        self.assertEqual(proof['fingerprint'], row[0])
        with self.assertRaises(ReceiptResultExpired): gateway.sql_batch(SQL, payload)
        status, body = self.http('/sql/' + SQL, payload)
        self.assertEqual(status, 409); self.assertTrue(body['committed']); self.assertFalse(body['retryable'])
        self.assertEqual(query('SELECT quantity FROM isolated_records')[0][0], 1)

    def test_expired_payload_cannot_reexecute_even_if_request_body_changes(self):
        identity = str(uuid.uuid4()); payload = mutation(identity)
        original = gateway.sql_batch(SQL, payload)
        row = query('SELECT fingerprint,response_json FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (SQL, identity))[0]
        saved = json.loads(row[1]); saved[MARKER]['expired'] = True; saved[MARKER].pop('content', None)
        query('UPDATE pinying_rpc_receipts SET response_json=%s WHERE scope=%s AND request_id=%s', (json.dumps(saved), SQL, identity))
        payload['queries'][0]['params'] = ['new-id']
        with self.assertRaises(ValueError): gateway.sql_batch(SQL, payload)
        self.assertEqual(query('SELECT quantity FROM isolated_records')[0][0], 1)

    def test_http_health_proves_loaded_build_and_read_does_not_persist_receipt(self):
        status, body = self.http('/health')
        self.assertEqual(status, 200); self.assertEqual(body['build_id'], gateway.BUILD_ID)
        self.assertEqual(body['loaded_source_sha256'], gateway.LOADED_SOURCE_SHA256)
        identity = str(uuid.uuid4())
        status, body = self.http('/documents/' + DOCS, {'id': identity, 'method': 'statFile', 'args': ['/missing.json']})
        self.assertEqual(status, 200); self.assertFalse(body['exists'])
        self.assertEqual(query('SELECT request_id FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (DOCS, identity)), ())

    def test_http_write_pause_is_explicit_and_has_no_receipt_or_mutation(self):
        query("CREATE TRIGGER isolated_pause BEFORE INSERT ON pinying_documents FOR EACH ROW BEGIN IF NEW.logical_path='/isolated/blocked.json' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated maintenance'; END IF; END")
        try:
            identity = str(uuid.uuid4())
            status, body = self.http('/documents/' + DOCS, {'id': identity, 'method': 'commit', 'args': ['/isolated/blocked.json', 0, {'x': 1}]})
            self.assertEqual(status, 423); self.assertEqual(body['code'], 'DATABASE_WRITE_PAUSED'); self.assertFalse(body['retryable'])
            self.assertEqual(query('SELECT request_id FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (DOCS, identity)), ())
            self.assertFalse(request('statFile', ['/isolated/blocked.json'])['exists'])
        finally: query('DROP TRIGGER isolated_pause')

    def test_session_commit_replays_after_session_is_gone(self):
        session = str(uuid.uuid4()); commit_id = str(uuid.uuid4())
        sql_sessions.request(SQL, {'id': str(uuid.uuid4()), 'session': session, 'control': 'begin'})
        sql_sessions.request(SQL, {'id': str(uuid.uuid4()), 'session': session, 'control': 'query', 'sql': 'UPDATE records SET quantity=quantity+1', 'params': []})
        payload = {'id': commit_id, 'session': session, 'control': 'commit'}
        self.assertEqual(sql_sessions.request(SQL, payload), {'committed': True})
        self.assertEqual(sql_sessions.request(SQL, payload), {'committed': True})
        self.assertEqual(query('SELECT quantity FROM isolated_records')[0][0], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
