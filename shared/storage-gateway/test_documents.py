"""Verify real MySQL document rollback, conflict detection and history."""
import json
import hashlib
import base64
import uuid
from common import mysql_connection
from documents_repo import initialize,invoke

scope='test_docs_'+uuid.uuid4().hex[:10]
db=mysql_connection(autocommit=False)
initialize(db)
path='/isolated/fixture.json'
try:
    initial={'version':3,'tasks':[{'id':'fixture','text':'中文'}],'outbox':[]}
    invoke(db,scope,'commit',[path,0,initial]);db.commit()
    first=invoke(db,scope,'read',[path]);assert first['data']==initial
    unchanged=invoke(db,scope,'readIfChanged',[path,first['version']])
    assert unchanged['unchanged'] and 'data' not in unchanged
    modified={**initial,'outbox':[{'id':'fixture-outbox'}]}
    invoke(db,scope,'commit',[path,first['version'],modified]);db.rollback()
    assert invoke(db,scope,'read',[path])['data']==initial
    invoke(db,scope,'commit',[path,first['version'],modified]);db.commit()
    changed=invoke(db,scope,'readIfChanged',[path,first['version']])
    assert changed['data']==modified and not changed.get('unchanged')
    try:
        invoke(db,scope,'commit',[path,first['version'],initial])
        raise AssertionError('Stale version overwrote a document')
    except ValueError:db.rollback()
    assert invoke(db,scope,'read',[path])['data']==modified
    raw=invoke(db,scope,'readFile',[path]);old=raw['data'].encode()
    new=old.replace('中文'.encode(),'中文😀'.encode())
    prefix=next(i for i in range(min(len(old),len(new))) if old[i]!=new[i])
    suffix=0
    while suffix<min(len(old),len(new))-prefix and old[-suffix-1]==new[-suffix-1]:suffix+=1
    delta={'baseSha256':hashlib.sha256(old).hexdigest(),'sha256':hashlib.sha256(new).hexdigest(),'prefix':prefix,'remove':len(old)-prefix-suffix,'insert':base64.b64encode(new[prefix:len(new)-suffix]).decode(),'bytes':len(new)}
    saved=invoke(db,scope,'writeFileDelta',[path,raw['version'],delta]);db.commit()
    assert invoke(db,scope,'readFile',[path])['data'].encode()==new
    try:
        invoke(db,scope,'writeFileDelta',[path,raw['version'],delta])
        raise AssertionError('Delta bypassed version conflict')
    except ValueError:db.rollback()
    # A wrong final hash must roll back the entire write, including history.
    bad={**delta,'baseSha256':saved['sha256'],'sha256':'a'*64,'prefix':0,'remove':len(new),'insert':base64.b64encode(b'{}').decode(),'bytes':2}
    try:
        invoke(db,scope,'writeFileDelta',[path,saved['version'],bad])
        raise AssertionError('Invalid delta hash was accepted')
    except ValueError:db.rollback()
    assert invoke(db,scope,'readFile',[path])['data'].encode()==new
    with db.cursor() as cursor:
        cursor.execute('SELECT COUNT(*) FROM pinying_document_history WHERE scope=%s',(scope,));assert cursor.fetchone()[0]==2
    print(json.dumps({'rollback':True,'optimisticConflict':True,'history':True,'unicodeAndIds':True}))
finally:
    db.rollback()
    with db.cursor() as cursor:
        cursor.execute('DELETE FROM pinying_documents WHERE scope=%s',(scope,))
        cursor.execute('DELETE FROM pinying_document_history WHERE scope=%s',(scope,))
    db.commit();db.close()
