"""Versioned native MySQL documents with optimistic transactions."""
import hashlib
import json
import base64
import re
import threading
import time
from history_retention import policy_for, before_write, after_write


def initialize(db):
    with db.cursor() as cursor:
        cursor.execute('CREATE TABLE IF NOT EXISTS pinying_documents(scope VARCHAR(32) NOT NULL,path_hash BINARY(32) NOT NULL,logical_path LONGTEXT NOT NULL,body LONGTEXT NOT NULL,version BIGINT NOT NULL,sha256 CHAR(64) NOT NULL,updated_at DATETIME(6) NOT NULL,PRIMARY KEY(scope,path_hash)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin')
        cursor.execute('CREATE TABLE IF NOT EXISTS pinying_document_history(scope VARCHAR(32) NOT NULL,path_hash BINARY(32) NOT NULL,version BIGINT NOT NULL,body LONGTEXT NOT NULL,sha256 CHAR(64) NOT NULL,captured_at DATETIME(6) NOT NULL,PRIMARY KEY(scope,path_hash,version)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin')


def invoke(db,scope,method,args):
    path=args[0]
    if not isinstance(path,str) or not path.startswith('/') or len(path)>1024:
        raise ValueError('Document path is invalid')
    digest=hashlib.sha256(path.encode()).digest()
    with db.cursor() as cursor:
        if method in {'readIfChanged','readTextIfChanged'}:
            expected=args[1]
            if not isinstance(expected,int) or expected<0:raise ValueError('Document version is invalid')
            cursor.execute('SELECT version,sha256 FROM pinying_documents WHERE scope=%s AND path_hash=%s',(scope,digest))
            row=cursor.fetchone()
            if row and row[0]==expected:
                return {'unchanged':True,'exists':row[1]!='0'*64,'version':row[0],'sha256':row[1]}
            return invoke(db,scope,'readFile' if method=='readTextIfChanged' else 'read',[path])
        if method=='listFiles':
            cursor.execute('SELECT logical_path,version,sha256 FROM pinying_documents WHERE scope=%s AND sha256<>%s ORDER BY path_hash',(scope,'0'*64))
            return [{'path':row[0],'version':row[1],'sha256':row[2]} for row in cursor.fetchall() if row[0].startswith(path)]
        if method=='statFile':
            length='0' if len(args)>1 and args[1] is True else 'OCTET_LENGTH(body)'
            cursor.execute('SELECT version,sha256,'+length+' FROM pinying_documents WHERE scope=%s AND path_hash=%s',(scope,digest))
            row=cursor.fetchone()
            return {'exists':bool(row and row[1]!='0'*64),'version':row[0] if row else 0,'sha256':row[1] if row else None,'bytes':row[2] if row else 0}
        projection='logical_path,body,version,sha256' if method in {'read','readFile','renameFile'} else "logical_path,'' AS body,version,sha256"
        cursor.execute('SELECT '+projection+' FROM pinying_documents WHERE scope=%s AND path_hash=%s'+('' if method in {'read','readFile'} else ' FOR UPDATE'),(scope,digest))
        previous=cursor.fetchone()
        if previous and previous[0]!=path:raise ValueError('Document path collision')
        if method=='renameFile':
            expected,destination,target_expected=args[1:4]
            if not previous or previous[3]=='0'*64:raise ValueError('Metadata source does not exist')
            if previous[2]!=expected:raise ValueError('Metadata changed during rename')
            stored=invoke(db,scope,'writeFile',[destination,target_expected,previous[1]])
            removed=invoke(db,scope,'deleteFile',[path,expected,None])
            return {'target':stored,'source':removed}
        if method in {'read','readFile'}:
            exists=bool(previous and previous[3]!='0'*64)
            return {'exists':exists,'data':(json.loads(previous[1]) if method=='read' else previous[1]) if exists else None,'version':previous[2] if previous else 0,'sha256':previous[3] if previous else None}
        if method not in {'commit','writeFile','writeFileDelta','deleteFile'}:raise ValueError('Unknown document operation')
        expected,data=args[1:3]
        actual=previous[2] if previous else 0
        if expected!=actual:raise ValueError('Document changed during transaction')
        history_policy=policy_for(scope,path)
        if method=='writeFileDelta':
            if not previous or previous[3]!=data['baseSha256']:raise ValueError('Document changed during delta')
            if type(data['bytes']) is not int or not 0<=data['bytes']<=80*1024*1024:raise ValueError('Delta size is invalid')
            if not re.fullmatch(r'[0-9a-f]{64}',data['sha256']):raise ValueError('Delta hash is invalid')
            hunks=data.get('hunks') or [data]
            if not isinstance(hunks,list) or not 1<=len(hunks)<=32:raise ValueError('Delta parts are invalid')
            parts=[];parameters=[];end=0;inserted=0
            for hunk in hunks:
                for name in ['prefix','remove']:
                    if type(hunk[name]) is not int or not 0<=hunk[name]<=80*1024*1024:raise ValueError('Delta size is invalid')
                if hunk['prefix']<end:raise ValueError('Delta parts overlap')
                insert=base64.b64decode(hunk['insert'],validate=True);inserted+=len(insert)
                parts.extend(['SUBSTRING(CAST(body AS BINARY),%s,%s)','UNHEX(%s)'])
                parameters.extend([end+1,hunk['prefix']-end,insert.hex()]);end=hunk['prefix']+hunk['remove']
            if inserted>16*1024*1024:raise ValueError('Delta is too large')
            parts.append('SUBSTRING(CAST(body AS BINARY),%s)');parameters.append(end+1)
            if data['sha256']==previous[3]:return {'version':actual,'sha256':previous[3]}
            if history_policy:before_write(cursor,scope,digest,previous,history_policy)
            else:cursor.execute('INSERT IGNORE INTO pinying_document_history SELECT scope,path_hash,version,body,sha256,UTC_TIMESTAMP(6) FROM pinying_documents WHERE scope=%s AND path_hash=%s',(scope,digest))
            cursor.execute('UPDATE pinying_documents SET body=CONCAT('+','.join(parts)+'),version=version+1,sha256=%s,updated_at=UTC_TIMESTAMP(6) WHERE scope=%s AND path_hash=%s AND %s<=OCTET_LENGTH(body)',tuple(parameters+[data['sha256'],scope,digest,end]))
            if cursor.rowcount!=1:raise ValueError('Delta exceeds original content')
            cursor.execute('SELECT OCTET_LENGTH(body),SHA2(body,256),JSON_VALID(body) FROM pinying_documents WHERE scope=%s AND path_hash=%s',(scope,digest))
            size,sha,valid=cursor.fetchone()
            if size!=data['bytes'] or sha!=data['sha256'] or (path.endswith('.json') and not valid):raise ValueError('Delta content verification failed')
            if history_policy:after_write(cursor,scope,digest,history_policy)
            return {'version':actual+1,'sha256':sha}
        if method=='writeFile':
            if not isinstance(data,str):raise ValueError('Metadata file must be UTF-8 text')
            if path.endswith('.json'):json.loads(data)
            body=data
        elif method=='deleteFile':body='null'
        else:body=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)
        sha='0'*64 if method=='deleteFile' else hashlib.sha256(body.encode()).hexdigest()
        if previous and sha==previous[3]:return {'version':actual,'sha256':sha}
        if history_policy:
            before_write(cursor,scope,digest,previous,history_policy,force=method=='deleteFile')
        elif previous:
            cursor.execute('INSERT IGNORE INTO pinying_document_history SELECT scope,path_hash,version,body,sha256,UTC_TIMESTAMP(6) FROM pinying_documents WHERE scope=%s AND path_hash=%s',(scope,digest))
        cursor.execute('INSERT INTO pinying_documents VALUES(%s,%s,%s,%s,%s,%s,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE body=VALUES(body),version=VALUES(version),sha256=VALUES(sha256),updated_at=VALUES(updated_at)',(scope,digest,path,body,actual+1,sha))
        if history_policy:after_write(cursor,scope,digest,history_policy)
        # These are adapter recovery snapshots; business audit trails are in body.
        # Preserve the imported baseline and the 32 most recent predecessors.
        return {'version':actual+1,'sha256':sha}


def start_history_maintenance(scopes):
    """Prune only adapter recovery versions, outside business transactions."""
    from common import mysql_connection
    def maintain():
        while True:
            time.sleep(15)
            db=None
            try:
                db=mysql_connection()
                for scope in scopes:
                    lock='pinying:history:'+scope
                    with db.cursor() as cursor:
                        cursor.execute('SELECT GET_LOCK(%s,0)',(lock,))
                        if cursor.fetchone()[0]!=1:continue
                        try:
                            cursor.execute('SELECT path_hash,version FROM pinying_documents WHERE scope=%s AND version>34',(scope,))
                            candidates=cursor.fetchall()
                            for digest,version in candidates:
                                # Keep the imported baseline and at least 32
                                # predecessors. Later commits are never pruned.
                                cursor.execute('DELETE FROM pinying_document_history WHERE scope=%s AND path_hash=%s AND version>1 AND version<%s LIMIT 8',(scope,digest,version-32))
                        finally:cursor.execute('SELECT RELEASE_LOCK(%s)',(lock,))
            except Exception:
                pass  # Recovery maintenance cannot fail business requests.
            finally:
                if db:db.close()
    threading.Thread(target=maintain,daemon=True,name='document-history-maintenance').start()
