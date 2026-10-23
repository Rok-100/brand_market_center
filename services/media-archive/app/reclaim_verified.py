"""Remove only byte-verified media copies with a private OSS recovery journal."""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
from media_archive import Archive,eligible

parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
archive=Archive('/source','/state','/run/secrets/oss-connection.json',workers=8)
policy=json.loads(Path('/plan/protected-media-paths.json').read_text())
protected=policy['protected'];allowed=policy['allowed']
journal=Path('/state/reclaimed.sqlite')
with sqlite3.connect(journal) as db:
    db.execute('CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,object_key TEXT,sha256 TEXT,bytes INTEGER,mtime_ns INTEGER,uid INTEGER,gid INTEGER,mode INTEGER,state TEXT,changed_at INTEGER)')
with archive.db() as db:rows=db.execute("SELECT path,bytes,mtime_ns,sha256,object_key,etag FROM files WHERE state='verified'").fetchall()
root=Path('/source').resolve()

def reclaim(row):
    relative,size,mtime,sha,key,etag=row;file=root/relative
    try:
        resolved=file.resolve(strict=True)
        if not resolved.is_relative_to(root) or file.is_symlink() or not eligible(file):return 'excluded',0
        if any(relative==path or relative.startswith(path+'/') for path in protected) and not any(relative==path or relative.startswith(path+'/') for path in allowed):return 'active-reader',0
        before=file.stat()
        if (before.st_size,before.st_mtime_ns)!=(size,mtime):return 'changed',0
        digest=hashlib.sha256()
        with file.open('rb') as stream:
            for block in iter(lambda:stream.read(16*1024*1024),b''):digest.update(block)
        if digest.hexdigest()!=sha:return 'changed',0
        head=archive.client.head_object(Bucket=archive.bucket,Key=key)
        if head['ContentLength']!=size or head.get('Metadata',{}).get('sha256')!=sha or head['ETag'].strip('"')!=etag:return 'remote-mismatch',0
        after=file.stat()
        if (after.st_ino,after.st_size,after.st_mtime_ns)!=(before.st_ino,size,mtime):return 'changed',0
        if args.apply:
            with sqlite3.connect(journal,timeout=60) as db:
                db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?,?,?)',(relative,key,sha,size,mtime,before.st_uid,before.st_gid,before.st_mode&0o777,'verified',int(time.time())))
            file.unlink()
            with sqlite3.connect(journal,timeout=60) as db:db.execute("UPDATE files SET state='removed',changed_at=? WHERE path=?",(int(time.time()),relative))
        return 'removed' if args.apply else 'removable',size
    except FileNotFoundError:return 'already-absent',0
    except Exception as error:return type(error).__name__,0

totals={};released=0;last=time.monotonic()
with ThreadPoolExecutor(max_workers=8) as executor:
    for future in as_completed([executor.submit(reclaim,row) for row in rows]):
        state,size=future.result();totals[state]=totals.get(state,0)+1;released+=size
        if time.monotonic()-last>30:
            Path('/state/reclamation-progress.json').write_text(json.dumps({'states':totals,'GiB':round(released/2**30,3),'apply':args.apply}));last=time.monotonic()
result={'states':totals,'releasedBytes':released,'releasedGiB':round(released/2**30,3),'apply':args.apply}
Path('/state/reclamation-result.json').write_text(json.dumps(result));print(json.dumps(result),flush=True)
