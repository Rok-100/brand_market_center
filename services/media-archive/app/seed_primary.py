"""Seed original media paths into the OSS primary filesystem, preserving hashes."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import sqlite3
import time

from media_archive import Archive

parser = argparse.ArgumentParser()
parser.add_argument('--module')
args = parser.parse_args()
source_root = Path('/source')
host_root = Path('/home/brand-marketing/fandow-apps/fd-026222/persistent')
plans = json.loads(Path('/plan/mount-plan.json').read_text())
if args.module:
    plans = [plan for plan in plans if plan['module'] == args.module]
archive = Archive(source_root, '/state', '/run/secrets/oss-connection.json', workers=8)
primary_db = Path('/state/primary.sqlite')
with sqlite3.connect(primary_db) as db:
    db.executescript('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS primary_files(path TEXT PRIMARY KEY,module TEXT,bytes INTEGER,mtime_ns INTEGER,sha256 TEXT,remote_key TEXT,verified_at INTEGER);')


def seed(path, plan):
    stat = path.stat()
    relative = str(path.relative_to(source_root))
    key = 'wis-media/live/' + plan['remote'] + '/' + str(path.relative_to(source_root / Path(plan['source']).relative_to(host_root)))
    with sqlite3.connect(primary_db, timeout=30) as db:
        row = db.execute('SELECT bytes,mtime_ns,remote_key FROM primary_files WHERE path=?', (relative,)).fetchone()
    if row == (stat.st_size, stat.st_mtime_ns, key):
        return True
    result = archive.archive(path, stat)
    if result not in {'verified', 'unchanged'}:
        return False
    with archive.db() as db:
        stored = db.execute('SELECT sha256,object_key,content_type,state FROM files WHERE path=?', (relative,)).fetchone()
    assert stored[3] == 'verified'
    sha, object_key, mime, _ = stored
    archive.client.copy_object(Bucket=archive.bucket, Key=key,
                              CopySource={'Bucket': archive.bucket, 'Key': object_key},
                              MetadataDirective='REPLACE', ContentType=mime,
                              Metadata={'sha256': sha, 'mtime': str(stat.st_mtime), 'managed-by': 'wis-media-primary'})
    head = archive.client.head_object(Bucket=archive.bucket, Key=key)
    assert head['ContentLength'] == stat.st_size and head['Metadata']['sha256'] == sha
    after = path.stat()
    if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
        return False
    with sqlite3.connect(primary_db, timeout=30) as db:
        db.execute('INSERT OR REPLACE INTO primary_files VALUES(?,?,?,?,?,?,?)',
                   (relative, plan['module'], stat.st_size, stat.st_mtime_ns, sha, key, int(time.time())))
    return True


jobs = []
symlinks = []
for plan in plans:
    source = source_root / Path(plan['source']).relative_to(host_root)
    if not source.exists():
        continue
    for base, dirs, files in os.walk(source, followlinks=False):
        for name in files:
            path = Path(base) / name
            if path.is_symlink():
                symlinks.append(str(path.relative_to(source_root)))
            elif path.is_file():
                jobs.append((path, plan))
assert not symlinks, 'Media paths contain symlinks; inspect before switching'
done = 0
errors = 0
last = time.monotonic()
with ThreadPoolExecutor(max_workers=8) as executor:
    tasks = [executor.submit(seed, path, plan) for path, plan in jobs]
    for future in as_completed(tasks):
        try:
            success = future.result()
        except Exception as error:
            success = False
            print(json.dumps({'seedError': type(error).__name__}), flush=True)
        done += 1
        errors += not success
        if time.monotonic() - last >= 30:
            print(json.dumps({'phase': 'primary-seed', 'module': args.module, 'processed': done, 'total': len(jobs), 'errors': errors}), flush=True)
            last = time.monotonic()
result = {'seedComplete': True, 'module': args.module, 'processed': done, 'errors': errors}
Path('/state/seed-result-' + (args.module or 'all') + '.json').write_text(json.dumps(result))
print(json.dumps(result), flush=True)
if errors:
    raise SystemExit(1)
