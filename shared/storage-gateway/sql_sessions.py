"""Short synchronous compatibility transactions for legacy Node/Python stores."""
import hashlib
import json
import threading
import time
import uuid
from common import mysql_connection,wire
from receipt_storage import decode_receipt

SESSIONS={}
GUARD=threading.Lock()


def dispose(session,commit=False):
    try:
        if commit:session['db'].commit()
        else:session['db'].rollback()
    finally:
        try:
            with session['db'].cursor() as cursor:cursor.execute('SELECT RELEASE_LOCK(%s)',('pinying:scope:'+session['scope'],))
        finally:session['db'].close()


def cleanup():
    while True:
        time.sleep(15)
        with GUARD:items=list(SESSIONS.items())
        for key,session in items:
            if time.monotonic()-session['touched']<120:continue
            if not session['lock'].acquire(blocking=False):continue
            try:
                with GUARD:removed=SESSIONS.pop(key,None)
                if removed:
                    try:dispose(session)
                    except Exception:pass
            finally:session['lock'].release()


def request(scope,payload):
    from sql_gateway import registry,execute,TOKENS,read_query
    authorization=TOKENS.get(scope)
    readonly=isinstance(authorization,dict) and authorization.get('readonly') is True
    schema_scope=authorization.get('scope',scope) if isinstance(authorization,dict) else scope
    identity=payload['session'];uuid.UUID(identity)
    request_id=payload['id'];uuid.UUID(request_id)
    key=(scope,identity)
    operation=payload['control']
    with GUARD:session=SESSIONS.get(key)
    if operation=='begin':
        if session:return {'begun':True}
        db=mysql_connection(autocommit=False)
        try:
            with db.cursor() as cursor:
                cursor.execute('SELECT GET_LOCK(%s,10)',('pinying:scope:'+scope,))
                if cursor.fetchone()[0]!=1:raise TimeoutError('Store is busy')
            session={'db':db,'scope':scope,'specs':registry(db,schema_scope),'readonly':readonly,'touched':time.monotonic(),'lock':threading.Lock(),'responses':{}}
            with GUARD:
                if key in SESSIONS:
                    dispose(session)
                    return {'begun':True}
                SESSIONS[key]=session
            return {'begun':True}
        except Exception:
            db.close();raise
    if session is None:
        if operation=='commit':
            db=mysql_connection()
            try:
                with db.cursor() as cursor:
                    cursor.execute('SELECT response_json FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s',(scope,request_id))
                    row=cursor.fetchone()
                    if row:return decode_receipt(row[0], scope, request_id)
            finally:db.close()
        if operation=='rollback':return {'rolledBack':True}
        raise ValueError('Transaction expired; retry the operation after refreshing')
    fingerprint=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
    with session['lock']:
        session['touched']=time.monotonic()
        if request_id in session['responses']:
            saved_hash,response=session['responses'][request_id]
            if saved_hash!=fingerprint:raise ValueError('Request ID reused')
            return response
        if operation in {'query','batch'}:
            queries=payload.get('queries') if operation=='batch' else [{'sql':payload['sql'],'params':payload.get('params',[])}]
            if not queries or len(queries)>256:raise ValueError('Invalid transaction batch')
            if session['readonly']:
                import sqlglot
                from sqlglot import exp
                for query in queries:
                    if not read_query(query['sql']):raise ValueError('Read-only transaction cannot mutate business data')
            responses=[wire(execute(session['db'],query['sql'],query.get('params',[]),session['specs'])) for query in queries]
            response=responses if operation=='batch' else responses[0]
            session['responses'][request_id]=(fingerprint,response)
            return response
        if operation not in {'commit','rollback'}:raise ValueError('Unknown transaction operation')
        response={'committed':True} if operation=='commit' else {'rolledBack':True}
        if operation=='commit':
            with session['db'].cursor() as cursor:
                cursor.execute('INSERT INTO pinying_rpc_receipts VALUES(%s,%s,%s,%s,UTC_TIMESTAMP(6))',(scope,request_id,fingerprint,json.dumps(response)))
        with GUARD:SESSIONS.pop(key,None)
        dispose(session,commit=operation=='commit')
        return response


threading.Thread(target=cleanup,daemon=True).start()
