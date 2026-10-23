"""Restore an exact removed original from its verified private recovery journal."""
import argparse
import hashlib
import os
from pathlib import Path
import sqlite3
from media_archive import Archive

parser=argparse.ArgumentParser();parser.add_argument('relative_path');parser.add_argument('--test-root');args=parser.parse_args()
archive=Archive('/source','/state','/run/secrets/oss-connection.json')
with sqlite3.connect('/state/reclaimed.sqlite') as db:
    row=db.execute('SELECT object_key,sha256,bytes,mtime_ns,uid,gid,mode FROM files WHERE path=?',(args.relative_path,)).fetchone()
if not row:raise ValueError('No verified recovery entry exists')
root=Path(args.test_root or '/source').resolve();target=(root/args.relative_path).resolve()
if not target.is_relative_to(root) or target==root:raise ValueError('Recovery target escapes source root')
if target.exists():raise ValueError('Recovery never overwrites an existing file')
target.parent.mkdir(parents=True,exist_ok=True);temporary=target.with_name(target.name+'.oss-restoring');digest=hashlib.sha256();size=0
try:
    body=archive.client.get_object(Bucket=archive.bucket,Key=row[0])['Body']
    try:
        with temporary.open('xb') as stream:
            for chunk in iter(lambda:body.read(16*1024*1024),b''):stream.write(chunk);digest.update(chunk);size+=len(chunk)
            stream.flush();os.fsync(stream.fileno())
    finally:body.close()
    if digest.hexdigest()!=row[1] or size!=row[2]:raise ValueError('Recovery checksum differs')
    os.chmod(temporary,row[6]);os.chown(temporary,row[4],row[5]);os.utime(temporary,ns=(row[3],row[3]));os.link(temporary,target);temporary.unlink()
    print('Recovered and SHA256 verified')
finally:
    if temporary.exists():temporary.unlink()
