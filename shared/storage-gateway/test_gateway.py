"""Exercise actual MySQL/Redis with an isolated scope, never production rows."""
import json
from pathlib import Path
import sqlite3
import tempfile
import uuid
import pymysql

from common import mysql_connection, redis_connection, quote_identifier as q
from migrate_sqlite import migrate
from sql_gateway import execute, initialize, registry, sql_batch, CACHE_PREFIX

scope = 'test_' + uuid.uuid4().hex[:12]
with tempfile.TemporaryDirectory() as directory:
    source = Path(directory) / 'fixture.sqlite'
    db = sqlite3.connect(source)
    db.executescript("""
    CREATE TABLE records(id TEXT PRIMARY KEY,name TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0,payload BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE queue(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,status TEXT NOT NULL);
    CREATE UNIQUE INDEX active_tasks ON queue(task_id) WHERE status IN ('queued','running');
    INSERT INTO records VALUES('original','中文 / ? 100%',3,x'0001ff','2026-10-06 01:02:03');
    INSERT INTO queue(task_id,status) VALUES('same','done'),('same','done'),('same','queued');
    """)
    db.commit()
    db.close()
    try:
        verified = migrate(scope, source, Path(directory))
        assert all(table['verified'] for table in verified['tables'])
        initialize()
        connection = mysql_connection(autocommit=False)
        specs = registry(connection, scope)
        def run(sql, params=()): return execute(connection, sql, list(params), specs)
        assert run("SELECT name FROM records WHERE id=?", ['original'])['results'][0]['name'] == '中文 / ? 100%'
        assert run("SELECT payload FROM records WHERE id=?", ['original'])['results'][0]['payload'] == {'__pinying_bytes__':'AAH/'}
        assert run("SELECT count(*) AS n FROM records WHERE name LIKE ?", ['%100%'])['results'][0]['n'] == 1
        assert len(run('PRAGMA table_info(records)')['results']) == 5
        run("INSERT INTO records(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name", ['original','new'])
        assert run('SELECT name FROM records')['results'][0]['name'] == 'new'
        connection.rollback()
        assert run('SELECT name FROM records')['results'][0]['name'] == '中文 / ? 100%'
        run("INSERT INTO queue(task_id,status) VALUES(?,?)", ['same','done'])
        try:
            run("INSERT INTO queue(task_id,status) VALUES(?,?)", ['same','running'])
            raise AssertionError('Active-task uniqueness was not enforced')
        except pymysql.IntegrityError:
            pass
        ignored = run("INSERT OR IGNORE INTO queue(task_id,status) VALUES(?,?)", ['same','queued'])
        assert ignored['meta']['changes'] == 0
        assert run('SELECT rowid FROM queue ORDER BY rowid LIMIT 1')['results'][0]['id'] == 1
        connection.rollback()
        for sql in ['SELECT * FROM workspace_users', 'SELECT * FROM mysql.user', 'DROP TABLE records', 'SELECT 1; DELETE FROM records']:
            try:
                run(sql)
                raise AssertionError('Out-of-scope operation was accepted')
            except ValueError:
                pass
        connection.close()
        identity = str(uuid.uuid4())
        payload = {'id':identity,'queries':[{'sql':'UPDATE records SET quantity=quantity+1 WHERE id=?','params':['original']}]}
        first = sql_batch(scope, payload)
        assert sql_batch(scope, payload) == first
        payload2 = {'id': str(uuid.uuid4()),'queries':[{'sql':'SELECT quantity FROM records WHERE id=?','params':['original']}]}
        assert sql_batch(scope, payload2)[0]['results'][0]['quantity'] == 4
        try:
            sql_batch(scope, {'id':str(uuid.uuid4()),'queries':[{'sql':'UPDATE records SET quantity=99'}, {'sql':'INSERT INTO records(id,name) VALUES(?,?)','params':['original','duplicate']}]})
            raise AssertionError('Failing batch committed')
        except pymysql.IntegrityError:
            pass
        assert sql_batch(scope, {'id':str(uuid.uuid4()),'queries':[{'sql':'SELECT quantity FROM records'}]})[0]['results'][0]['quantity'] == 4
        cache = redis_connection()
        assert cache.get(CACHE_PREFIX + scope + ':requests') is not None
        keys = list(cache.scan_iter(CACHE_PREFIX + scope + ':*'))
        if keys: cache.delete(*keys)
        cache.close()
        print(json.dumps({'nativeMysql':True,'redis':True,'migrationHashes':True,'rollback':True,'batchAtomicity':True,'retryExactlyOnce':True,'partialUnique':True,'scopeIsolation':True}))
    finally:
        connection = mysql_connection()
        with connection.cursor() as cursor:
            for original in ['records','queue']:
                cursor.execute('DROP TABLE IF EXISTS ' + q('py_' + scope + '_' + original))
            cursor.execute('DELETE FROM pinying_storage_schemas WHERE scope=%s',(scope,))
            cursor.execute('DELETE FROM pinying_rpc_receipts WHERE scope=%s',(scope,))
        connection.close()
