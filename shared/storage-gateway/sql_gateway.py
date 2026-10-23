"""Private, scoped compatibility gateway; business rows live in native MySQL tables.

SQL is parsed before table names are resolved from a verified migration registry.
Unregistered tables, DDL and multiple statements are rejected. A batch commits
atomically with its receipt, so transport retries cannot repeat committed writes.
"""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import time
import threading
import uuid

import pymysql
import sqlglot
from sqlglot import exp
from common import mysql_connection, redis_connection, wire, unwire, quote_identifier as q
from receipt_storage import encode_receipt, decode_receipt, ReceiptResultExpired
from growth_maintenance import snapshot_status

BUILD_ID = 'wis-storage-growth-20261007-r1'
LOADED_SOURCE_SHA256 = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                       for name in ('sql_gateway.py', 'sql_sessions.py', 'documents_repo.py', 'receipt_storage.py', 'growth_maintenance.py')}
PROCESS_STARTED_AT = time.time()

TOKENS = json.loads(Path(os.environ.get('PINYING_TOKENS', '/run/secrets/gateway-tokens.json')).read_text())
CACHE_PREFIX = 'pinying:storage:20261006:v1:'
LARGE_OPERATION=threading.BoundedSemaphore(1)


def parameters(sql):
    """Convert only unquoted placeholders, escaping literal percent for PyMySQL."""
    output = []
    quote = None
    i = 0
    count = 0
    while i < len(sql):
        char = sql[i]
        if quote:
            output.append('%%' if char == '%' else char)
            if char == '\\' and i + 1 < len(sql):
                i += 1
                output.append('%%' if sql[i] == '%' else sql[i])
            elif char == quote:
                if i + 1 < len(sql) and sql[i + 1] == quote:
                    i += 1
                    output.append(quote)
                else:
                    quote = None
        elif char in "'\"`":
            quote = char
            output.append(char)
        elif char == '?':
            output.append('%s')
            count += 1
        else:
            output.append('%%' if char == '%' else char)
        i += 1
    return ''.join(output), count


def registry(db, scope):
    # MySQL is authoritative; schema changes are never hidden by cached registry.
    with db.cursor() as cursor:
        cursor.execute('SELECT schema_json FROM pinying_storage_schemas WHERE scope=%s', (scope,))
        row = cursor.fetchone()
    if not row:
        raise ValueError('Scope has no verified migration')
    return json.loads(row[0])


def translate(sql, specs):
    tokens=sqlglot.tokenize(sql,read='sqlite')
    replacements=[]
    for i,token in enumerate(tokens):
        if token.token_type!=sqlglot.TokenType.IS or i+1>=len(tokens):continue
        negative=tokens[i+1].token_type==sqlglot.TokenType.NOT
        following=i+2 if negative else i+1
        if following>=len(tokens) or tokens[following].token_type in {sqlglot.TokenType.NULL,sqlglot.TokenType.TRUE,sqlglot.TokenType.FALSE}:continue
        replacements.append((token.start,tokens[i+1].end+1 if negative else token.end+1,'IS DISTINCT FROM' if negative else 'IS NOT DISTINCT FROM'))
    for start,end,replacement in reversed(replacements):sql=sql[:start]+replacement+sql[end:]
    conflict_where=None
    if re.match(r'\s*INSERT\b',sql,re.I):
        # This SQLGlot version omits SQLite's trailing upsert WHERE grammar.
        depth=0
        for token in sqlglot.tokenize(sql,read='sqlite'):
            if token.token_type==sqlglot.TokenType.L_PAREN:depth+=1
            elif token.token_type==sqlglot.TokenType.R_PAREN:depth-=1
            elif token.token_type==sqlglot.TokenType.WHERE and depth==0 and re.search(r'\bON\s+CONFLICT\b.*\bDO\s+UPDATE\b',sql[:token.start],re.I|re.S):
                conflict_where=sqlglot.parse_one('SELECT 1 '+sql[token.start:],read='sqlite').args['where']
                sql=sql[:token.start]
                break
    statements = sqlglot.parse(sql, read='sqlite')
    if len(statements) != 1 or statements[0] is None:
        raise ValueError('Exactly one SQL statement is required')
    tree = statements[0]
    if not isinstance(tree, (exp.Select, exp.Union, exp.Insert, exp.Update, exp.Delete)):
        raise ValueError('Statement requires a versioned migration')
    if tree.args.get('returning'):
        raise ValueError('RETURNING requires an explicit compatibility mapping')
    ctes = {cte.alias for cte in tree.find_all(exp.CTE)}
    originals = []
    replacements = {}
    for table in tree.find_all(exp.Table):
        original = table.name
        if original in ctes:
            continue
        if table.db or table.catalog or original not in specs:
            raise ValueError('Unregistered table')
        spec = specs[original]
        originals.append(original)
        replacements[original] = spec['mysql']
        table.set('this', exp.to_identifier(spec['mysql'], quoted=True))
    for column in list(tree.find_all(exp.Column)):
        if column.table in replacements:
            column.set('table', exp.to_identifier(replacements[column.table], quoted=True))
        if column.name.lower() in {'rowid', '_rowid_', 'oid'}:
            candidates = set(originals)
            if len(candidates) != 1:
                raise ValueError('Ambiguous rowid')
            spec = specs[next(iter(candidates))]
            if not spec['rowid']:
                raise ValueError('Table has no rowid')
            column.set('this', exp.to_identifier(spec['integerPk'] or '__rowid', quoted=True))
    for node in list(tree.find_all(exp.Is)):
        if not isinstance(node.expression,(exp.Null,exp.Boolean)):
            node.replace(exp.NullSafeEQ(this=node.this,expression=node.expression))
    for node in list(tree.find_all(exp.Anonymous)):
        if node.name.upper()=='JSON_ARRAY_LENGTH':
            node.set('this','JSON_LENGTH')
        if node.name.upper()=='JULIANDAY' and len(node.expressions)==1:
            argument=node.expressions[0].sql('mysql')
            node.replace(sqlglot.parse_one("TIMESTAMPDIFF(MICROSECOND,'1970-01-01',CAST(REPLACE(REPLACE(JSON_UNQUOTE("+argument+"),'T',' '),'Z','') AS DATETIME(6)))/86400000000+2440587.5",read='mysql'))
        if node.name.upper() == 'DATETIME' and len(node.expressions) == 1 and isinstance(node.expressions[0], exp.Literal) and node.expressions[0].this == 'now':
            node.replace(exp.CurrentTimestamp())
    ignore = False
    conflict_sql = ''
    if isinstance(tree, exp.Insert):
        if isinstance(tree.this,exp.Table):
            original=originals[0]
            tree.set('this',exp.Schema(this=tree.this,expressions=[exp.to_identifier(column['name'],quoted=True) for column in specs[original]['columns']]))
        alternative = tree.args.get('alternative')
        if alternative:
            if alternative != 'IGNORE':
                raise ValueError('INSERT variant requires an explicit mapping')
            ignore = True
            tree.set('alternative', None)
        conflict = tree.args.get('conflict')
        if conflict:
            if conflict_where is not None:conflict.set('where',conflict_where)
            # MySQL cannot select a conflict target. Only a verified primary-key
            # target is accepted, and other unique constraints must be absent.
            spec = specs[originals[0]]
            keys = [key.name for key in conflict.args.get('conflict_keys', [])]
            if keys != spec['pk'] or any(index['unique'] for index in spec['indexes']):
                raise ValueError('Conflict target needs an explicit mapping')
            if conflict.args['action'].this.upper() == 'DO NOTHING':
                ignore = True
            else:
                assignments = []
                condition=conflict.args.get('where')
                condition=condition.this if isinstance(condition,exp.Where) else condition
                if condition is not None:
                    for column in list(condition.find_all(exp.Column)):
                        if column.table.lower()=='excluded':column.replace(exp.Anonymous(this='VALUES',expressions=[exp.column(column.name)]))
                for assignment in conflict.expressions:
                    for column in list(assignment.find_all(exp.Column)):
                        if column.table.lower() == 'excluded':
                            column.replace(exp.Anonymous(this='VALUES', expressions=[exp.column(column.name)]))
                    if condition is not None:
                        assignment.set('expression',exp.If(this=condition.copy(),true=assignment.expression,false=assignment.this.copy()))
                    assignments.append(assignment.sql('mysql', identify=True))
                conflict_sql = ' ON DUPLICATE KEY UPDATE ' + ','.join(assignments)
            tree.set('conflict', None)
    output = tree.sql('mysql', identify=True) + conflict_sql
    converted, count = parameters(output)
    return converted, count, ignore


def execute(db, sql, values, specs):
    if re.fullmatch(r'\s*PRAGMA\s+pinying_database_status\s*;?\s*', sql, re.I):
        if values:raise ValueError('Status query does not accept parameters')
        with db.cursor() as cursor:
            cursor.execute('SELECT @@read_only')
            return result([{'read_only':bool(cursor.fetchone()[0])}])
    if re.fullmatch(r'\s*PRAGMA\s+data_version\s*;?\s*',sql,re.I):
        return result([{'data_version':time.time_ns()}])
    if re.fullmatch(r'\s*PRAGMA\s+(?:journal_mode|synchronous|busy_timeout|query_only|foreign_keys|wal_checkpoint)\b.*',sql,re.I):
        return result([])
    match = re.fullmatch(r'\s*PRAGMA\s+table_info\s*\(\s*["`\[]?([A-Za-z0-9_]+)["`\]]?\s*\)\s*;?\s*', sql, re.I)
    if match:
        spec = specs.get(match[1])
        if not spec:
            raise ValueError('Unregistered table')
        return result([{'cid': c['cid'], 'name': c['name'], 'type': c['type'], 'notnull': c['notnull'], 'dflt_value': c['dflt_value'], 'pk': c['pk']} for c in spec['columns']])
    if re.match(r'\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b', sql, re.I):
        tree = sqlglot.parse_one(sql, read='sqlite')
        tables = list(tree.find_all(exp.Table))
        if not tables or any(table.name not in specs or table.db or table.catalog for table in tables):
            raise ValueError('DDL references an unregistered table')
        if tree.args.get('kind') == 'TABLE':
            columns = [column.name for column in tree.find_all(exp.ColumnDef)]
            known = {column['name'] for column in specs[tables[0].name]['columns']}
            if not set(columns).issubset(known):
                raise ValueError('DDL requires a versioned migration')
        else:
            # Startup indexes must already exist in the verified source schema.
            index = tree.find(exp.Index)
            if index and index.name not in {i['name'] for spec in specs.values() for i in spec['indexes']}:
                raise ValueError('Index requires a versioned migration')
        return result([])
    translated, count, ignore = translate(sql, specs)
    if count != len(values):
        raise ValueError('Parameter count differs')
    with db.cursor() as cursor:
        try:
            changes = cursor.execute(translated, tuple(unwire(values)))
        except pymysql.IntegrityError as error:
            if ignore and error.args[0] == 1062:
                return result([])
            raise
        if cursor.description:
            columns = [column[0] for column in cursor.description]
            indexes = [i for i, name in enumerate(columns) if not name.startswith('__unique_') and name != '__rowid']
            raw = [[wire(row[i]) for i in indexes] for row in cursor.fetchall()]
            names = [columns[i] for i in indexes]
            return result([dict(zip(names, row)) for row in raw], columns=names, raw=raw)
        return result([], changes=changes, rowid=cursor.lastrowid or 0)


def result(rows, changes=0, rowid=0, columns=None, raw=None):
    columns = columns if columns is not None else list(rows[0]) if rows else []
    return {'success': True, 'results': rows, 'columns': columns, 'raw': raw if raw is not None else [[row.get(c) for c in columns] for row in rows],
            'meta': {'changes': changes, 'last_row_id': rowid, 'changed_db': bool(changes), 'duration': 0, 'rows_read': len(rows), 'rows_written': changes}}


def read_query(sql):
    if re.match(r'\s*PRAGMA\b',sql,re.I):return True
    if not re.match(r'\s*(SELECT|WITH)\b',sql,re.I):return False
    return isinstance(sqlglot.parse_one(sql,read='sqlite'),(exp.Select,exp.Union))


def repository_read(schema_scope,payload,queries):
    method=payload.get('method')
    if payload.get('repository')=='documents':return method in {'read','readIfChanged','readTextIfChanged','readFile','statFile','listFiles'}
    # Verified CREATE IF NOT EXISTS statements below only validate the imported
    # registry. They never execute DDL and must not write durable RPC receipts.
    if not method:return all(read_query(query['sql']) or re.match(r'\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b',query['sql'],re.I) for query in queries)
    if schema_scope=='creative_r2' and method=='restoreR2Cache':return True
    if schema_scope not in {'intelligence','intelligence_fixture'}:return False
    if method in {'get','overview','delivery','close'}:return True
    args=payload.get('args',[])
    return (method=='setting' and len(args)==1) or (method=='rawQuery' and bool(args) and read_query(args[0]))


def sql_batch(scope, payload):
    identity = payload.get('id')
    uuid.UUID(identity)
    method = payload.get('method')
    authorization=TOKENS.get(scope)
    schema_scope=authorization.get('scope',scope) if isinstance(authorization,dict) else scope
    readonly=isinstance(authorization,dict) and authorization.get('readonly') is True
    queries = payload.get('queries')
    if method:
        body = {'method':method,'args':payload.get('args',[]),'repository':payload.get('repository')}
    else:
        if not queries or len(queries) > 256:
            raise ValueError('Batch size is invalid')
        body = queries
    if readonly:
        if method and not (payload.get('repository')=='documents' and method in {'read','readIfChanged','readTextIfChanged','readFile','statFile','listFiles'}):raise ValueError('Read-only scope does not allow mutations')
        for query in queries or []:
            if not read_query(query['sql']):raise ValueError('Read-only scope does not allow mutations')
    fingerprint = hashlib.sha256(json.dumps(body, separators=(',', ':'), sort_keys=True).encode()).hexdigest()
    reading=repository_read(schema_scope,payload,queries)
    db = mysql_connection(autocommit=False)
    locked = False
    large_read=False
    try:
        if payload.get('repository')=='documents' and method in {'read','readFile'} and not payload.get('_large_guard'):
            path=payload['args'][0]
            with db.cursor() as cursor:
                cursor.execute('SELECT OCTET_LENGTH(body) FROM pinying_documents WHERE scope=%s AND path_hash=%s',(schema_scope,hashlib.sha256(path.encode()).digest()))
                size=cursor.fetchone()
            if size and size[0]>=32*1024*1024:
                if not LARGE_OPERATION.acquire(timeout=30):raise TimeoutError('Large document is busy')
                large_read=True
                payload['_large_read_lock']=True
        with db.cursor() as cursor:
            restoring_cache=schema_scope=='creative_r2' and method=='restoreR2Cache'
            if reading and not restoring_cache:
                row=None
            else:
                cursor.execute('SELECT GET_LOCK(%s,30)', ('pinying:scope:' + scope,))
                if cursor.fetchone()[0] != 1:
                    raise TimeoutError('Scope is busy')
                locked = True
                if reading:row=None
                else:
                    cursor.execute('SELECT fingerprint,response_json FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', (scope, identity))
                    row = cursor.fetchone()
            if row:
                if row[0] != fingerprint:
                    raise ValueError('Request ID reused with different contents')
                return decode_receipt(row[1], scope, identity, fingerprint)
        specs = None if payload.get('repository')=='documents' else registry(db, schema_scope)
        started = time.monotonic()
        if method:
            if payload.get('repository')=='documents':
                from documents_repo import invoke
                response=wire(invoke(db,schema_scope,method,payload.get('args',[])))
            elif scope=='cloud_push' and method=='observeCloudPush':
                from cloud_push_repo import observe
                response=observe(db,specs,*payload['args'])
            elif scope=='creative_r2' and method in {'checkpointR2Cache','restoreR2Cache'}:
                from r2_cache_mysql import invoke
                response=invoke(db,specs,method,payload.get('args',[]))
            else:
                from intelligence_repo import invoke
                response = wire(invoke(db,specs,method,payload.get('args',[])))
        else:
            response = [execute(db, query['sql'], query.get('params', []), specs) for query in queries]
            for item in response:
                item['meta']['duration'] = (time.monotonic() - started) * 1000
        if not reading:
            with db.cursor() as cursor:
                saved_response = encode_receipt(response, scope, identity, fingerprint, operation=method or 'sql_batch')
                cursor.execute('INSERT INTO pinying_rpc_receipts VALUES(%s,%s,%s,%s,UTC_TIMESTAMP(6))', (scope, identity, fingerprint, saved_response))
        db.commit()
        # Redis stores operational counters and ephemeral receipts only. The
        # MySQL receipt remains authoritative even when Redis is unavailable.
        try:
            cache = redis_connection()
            pipeline=cache.pipeline(transaction=False)
            if not reading:
                cached_response=json.dumps(response,ensure_ascii=False)
                if len(cached_response.encode())<=65536:pipeline.setex(CACHE_PREFIX + scope + ':receipt:' + identity, 3600, cached_response)
            pipeline.incr(CACHE_PREFIX + scope + ':requests')
            pipeline.expire(CACHE_PREFIX + scope + ':requests', 86400)
            pipeline.execute()
            cache.close()
        except Exception:
            pass
        return response
    except Exception:
        db.rollback()
        raise
    finally:
        if locked:
            with db.cursor() as cursor:
                cursor.execute('SELECT RELEASE_LOCK(%s)', ('pinying:scope:' + scope,))
        db.close()
        if large_read and not payload.get('_handler_guard'):LARGE_OPERATION.release()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log SQL, business data or authorization headers.

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != '/health':
            self.reply(404, {'error': 'Unknown route'})
            return
        try:
            db = mysql_connection()
            with db.cursor() as cursor:
                cursor.execute('SELECT 1')
                assert cursor.fetchone()[0] == 1
            db.close()
            cache = redis_connection()
            assert cache.ping()
            cache.close()
            self.reply(200, {'status': 'ok', 'mysql': True, 'redis': True, 'build_id': BUILD_ID,
                             'loaded_source_sha256': LOADED_SOURCE_SHA256, 'process_started_at': PROCESS_STARTED_AT,
                             'maintenance': snapshot_status()})
        except Exception:
            self.reply(503, {'status': 'unavailable'})

    def do_POST(self):
        match = re.fullmatch(r'/(sql|intelligence|documents|session)/([a-z0-9_]+)', self.path)
        if not match:
            self.reply(404, {'error': 'Unknown route'})
            return
        scope = match[2]
        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
        expected=TOKENS.get(scope)
        expected=expected.get('token') if isinstance(expected,dict) else expected
        if not expected or not hmac.compare_digest(token, expected):
            self.reply(403, {'error': 'Access denied'})
            return
        large_request=False;payload={}
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 80 * 1024 * 1024:
                raise ValueError('Body size is invalid')
            if length>=32*1024*1024:
                if not LARGE_OPERATION.acquire(timeout=30):raise TimeoutError('Large document is busy')
                large_request=True
            payload = json.loads(self.rfile.read(length))
            payload['_large_guard']=large_request
            payload['_handler_guard']=True
            if match[1]=='session':
                from sql_sessions import request
                self.reply(200,request(scope,payload))
                return
            if (match[1]!='sql') != bool(payload.get('method')):
                raise ValueError('Invalid operation route')
            if match[1]=='documents':payload['repository']='documents'
            response = sql_batch(scope, payload)
            self.reply(200, response)
        except (BrokenPipeError, ConnectionResetError):
            return
        except ReceiptResultExpired as error:
            self.reply(409, {'error': str(error), 'code': 'RPC_RESULT_EXPIRED', 'committed': True,
                             'request_id': error.request_id, 'retryable': False})
        except (ValueError, KeyError) as error:
            self.reply(400, {'error': str(error)})
        except pymysql.IntegrityError:
            self.reply(409, {'error': 'Constraint violation'})
        except Exception as error:
            print(json.dumps({'scope': scope, 'errorType': type(error).__name__, 'code': error.args[0] if isinstance(error, pymysql.MySQLError) and error.args else None}), flush=True)
            if isinstance(error,pymysql.MySQLError) and error.args and error.args[0]==1644:
                self.reply(423, {'error': '数据库正在维护，当前保存已暂停；已有任务和素材已保留。',
                                 'code': 'DATABASE_WRITE_PAUSED', 'retryable': False})
            elif isinstance(error,pymysql.OperationalError) and error.args and error.args[0]==1290:
                self.reply(503, {'error':'数据库当前只读，暂时无法保存，请稍后重试','code':'DATABASE_READ_ONLY','retryable':False})
            else:self.reply(503, {'error': 'Database operation failed'})
        finally:
            if large_request or payload.get('_large_read_lock'):LARGE_OPERATION.release()


def initialize():
    db = mysql_connection()
    with db.cursor() as cursor:
        required={'pinying_documents','pinying_document_history','pinying_rpc_receipts'}
        cursor.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (%s,%s,%s)',tuple(sorted(required)))
        if {row[0] for row in cursor.fetchall()}==required:
            db.close()
            return
    from documents_repo import initialize as initialize_documents
    initialize_documents(db)
    with db.cursor() as cursor:
        cursor.execute('CREATE TABLE IF NOT EXISTS pinying_rpc_receipts(scope VARCHAR(32) NOT NULL,request_id CHAR(36) NOT NULL,fingerprint CHAR(64) NOT NULL,response_json JSON NOT NULL,created_at DATETIME(6) NOT NULL,PRIMARY KEY(scope,request_id),KEY expiry(created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin')
    db.close()


if __name__ == '__main__':
    initialize()
    from documents_repo import start_history_maintenance
    writable_scopes={value.get('scope',scope) if isinstance(value,dict) else scope for scope,value in TOKENS.items() if not (isinstance(value,dict) and value.get('readonly'))}
    if os.environ.get('PINYING_GROWTH_MAINTENANCE_ENABLED') == 'true':
        from growth_maintenance import start_growth_maintenance
        receipt_scopes = sorted(scope for scope, value in TOKENS.items()
                                if not (isinstance(value, dict) and value.get('readonly')))
        start_growth_maintenance(sorted(writable_scopes), receipt_scopes)
    elif os.environ.get('PINYING_HISTORY_MAINTENANCE_ENABLED')=='true':
        start_history_maintenance(sorted(writable_scopes))
    print(json.dumps({'event': 'storage_gateway_started', 'build_id': BUILD_ID,
                      'loaded_source_sha256': LOADED_SOURCE_SHA256, 'process_started_at': PROCESS_STARTED_AT}), flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
