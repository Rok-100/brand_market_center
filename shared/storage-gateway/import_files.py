"""Import byte-preserving UTF-8 metadata into native MySQL documents."""
import argparse
import hashlib
import json
from pathlib import Path
from common import mysql_connection
from documents_repo import initialize,invoke

parser=argparse.ArgumentParser();parser.add_argument('--mapping',required=True);parser.add_argument('--rules');parser.add_argument('--missing-only',action='store_true');args=parser.parse_args()
mapping=json.loads(Path(args.mapping).read_text());db=mysql_connection(autocommit=False);initialize(db)
if args.rules:
    import os
    discovered={item['path']:item for item in mapping}
    for rule in json.loads(Path(args.rules).read_text())['rules']:
        root=Path(rule['root'])
        for base,directories,names in os.walk(root,followlinks=False):
            directories[:]=[name for name in directories if '/'+str((Path(base)/name).relative_to(root)) not in rule.get('exclude',[])]
            for name in names:
                source=Path(base)/name;relative='/'+str(source.relative_to(root))
                if not name.endswith(('.json','.jsonl')) or source.is_symlink() or any(relative==item or relative.startswith(item+'/') for item in rule.get('exclude',[])):continue
                path=rule['logicalRoot']+relative;discovered[path]={'source':str(source),'path':path,'scope':rule['connection']['scope']}
    mapping=list(discovered.values())
count=size=0
try:
    for item in mapping:
        file=Path(item['source'])
        if not file.exists():continue
        if args.missing_only and invoke(db,item['scope'],'statFile',[item['path'],True])['version']>0:continue
        before=file.stat();raw=file.read_bytes();after=file.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Metadata changed while importing')
        text=raw.decode('utf8');sha=hashlib.sha256(raw).hexdigest()
        previous=invoke(db,item['scope'],'statFile',[item['path']])
        if args.missing_only and previous['version']>0:continue
        if previous['sha256']!=sha:invoke(db,item['scope'],'writeFile',[item['path'],previous['version'],text])
        stored=invoke(db,item['scope'],'statFile',[item['path']])
        assert stored['sha256']==sha and stored['bytes']==len(raw),'Metadata checksum differs'
        db.commit();count+=1;size+=len(raw)
        if count%250==0:print(json.dumps({'imported':count,'bytes':size}),flush=True)
    print(json.dumps({'verifiedFiles':count,'bytes':size}),flush=True)
except Exception:db.rollback();raise
finally:db.close()
