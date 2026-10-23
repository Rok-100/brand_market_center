"""Import selected business JSON documents, preserving all existing records."""
import argparse
import hashlib
import json
from pathlib import Path
from common import mysql_connection
from documents_repo import initialize,invoke

parser=argparse.ArgumentParser()
parser.add_argument('--scope',required=True)
parser.add_argument('--mapping',required=True)
args=parser.parse_args()
mapping=json.loads(Path(args.mapping).read_text())
db=mysql_connection(autocommit=False)
initialize(db)
result=[]
try:
    for item in mapping:
        source=Path(item['source'])
        if not source.exists():
            result.append({'path':item['path'],'absent':True})
            continue
        data=json.loads(source.read_text())
        previous=invoke(db,args.scope,'read',[item['path']])
        invoke(db,args.scope,'commit',[item['path'],previous['version'],data])
        stored=invoke(db,args.scope,'read',[item['path']])
        assert stored['data']==data,'Document content differs'
        result.append({'path':item['path'],'bytes':source.stat().st_size,'verified':True,'version':stored['version']})
    db.commit()
    print(json.dumps({'scope':args.scope,'documents':result}),flush=True)
except Exception:
    db.rollback()
    raise
finally:db.close()
