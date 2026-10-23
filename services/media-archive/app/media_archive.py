"""Continuously archive business media to private S3-compatible object storage.

Only media bytes are transferred. Local databases, credentials and metadata stay
on the application host. Content-addressed keys and verified multipart ETags make
reruns resumable and deduplicate historical copies without changing source files.
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sqlite3
import sys
import threading
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

MEDIA = {'.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.jpg', '.jpeg',
         '.png', '.webp', '.gif', '.avif', '.heic', '.heif', '.bmp', '.tif',
         '.tiff', '.svg', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'}
CHUNK = 16 * 1024 * 1024
SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
 path TEXT PRIMARY KEY, module TEXT NOT NULL, bytes INTEGER NOT NULL,
 mtime_ns INTEGER NOT NULL, sha256 TEXT, object_key TEXT, etag TEXT,
 content_type TEXT, state TEXT NOT NULL, checked_at INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS objects (
 sha256 TEXT PRIMARY KEY, object_key TEXT NOT NULL, bytes INTEGER NOT NULL,
 etag TEXT NOT NULL, content_type TEXT NOT NULL, verified_at INTEGER NOT NULL
);
"""


def eligible(path):
    suffix = path.suffix.lower()
    return (suffix in MEDIA or
            (suffix == '.zip' and 'bundles' in path.parts) or
            (suffix == '' and 'r2' in path.parts and 'blobs' in path.parts))


def content_type(path, first):
    if first.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if first.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if first.startswith((b'GIF87a', b'GIF89a')):
        return 'image/gif'
    if first.startswith(b'RIFF') and first[8:12] == b'WEBP':
        return 'image/webp'
    if first.startswith(b'RIFF') and first[8:12] == b'WAVE':
        return 'audio/wav'
    if first[4:8] == b'ftyp':
        return 'video/quicktime' if first[8:12] == b'qt  ' else 'video/mp4'
    return mimetypes.guess_type(str(path))[0] or 'application/octet-stream'


class Archive:
    def __init__(self, source, state, connection, workers=3):
        self.source = Path(source).resolve()
        self.state = Path(state)
        self.state.mkdir(parents=True, exist_ok=True)
        self.database = self.state / 'manifest.sqlite'
        self.connection = json.loads(Path(connection).read_text())
        c = self.connection
        self.client = boto3.client(
            's3', endpoint_url=c['endpoint'], aws_access_key_id=c['accessKeyId'],
            aws_secret_access_key=c['secretAccessKey'], region_name=c.get('region', 'us-east-1'),
            config=Config(signature_version='s3v4',
                          s3={'addressing_style': 'path', 'payload_signing_enabled': False},
                          request_checksum_calculation='when_required',
                          response_checksum_validation='when_required',
                          connect_timeout=15, read_timeout=180,
                          retries={'max_attempts': 3}, max_pool_connections=workers * 4))
        self.bucket = c['bucket']
        self.workers = workers
        self.locks = [threading.Lock() for _ in range(64)]
        with self.db() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.database, timeout=30)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA busy_timeout=30000')
            with db:
                yield db
        finally:
            db.close()

    def discover(self):
        cutoff = time.time() - 60
        for root, directories, names in os.walk(self.source, followlinks=False):
            directories[:] = [name for name in directories if name not in
                              {'secrets', 'node_modules', '.git', 'provider-credentials',
                               'object-storage-20261006', 'data-storage-20261006'}]
            for name in names:
                path = Path(root) / name
                if not eligible(path) or path.is_symlink():
                    continue
                try:
                    stat = path.stat()
                    if path.is_file() and stat.st_size and stat.st_mtime < cutoff:
                        yield path, stat
                except FileNotFoundError:
                    continue

    def record(self, path, stat, *, state, sha=None, key=None, etag=None, mime=None, error=None):
        relative = str(path.relative_to(self.source))
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (relative, relative.split('/')[0], stat.st_size, stat.st_mtime_ns,
                        sha, key, etag, mime, state, int(time.time()), error))

    def upload(self, path, size, sha, mime):
        key = 'wis-media/objects/' + sha[:2] + '/' + sha
        part_md5 = []
        upload_id = None
        try:
            with path.open('rb') as stream:
                if size <= CHUNK:
                    body = stream.read()
                    digest = hashlib.md5(body).digest()
                    response = self.client.put_object(
                        Bucket=self.bucket, Key=key, Body=body, ContentLength=len(body),
                        ContentType=mime, ContentMD5=base64.b64encode(digest).decode(),
                        Metadata={'sha256': sha, 'managed-by': 'wis-media'})
                    expected = digest.hex()
                else:
                    created = self.client.create_multipart_upload(
                        Bucket=self.bucket, Key=key, ContentType=mime,
                        Metadata={'sha256': sha, 'managed-by': 'wis-media'})
                    upload_id = created['UploadId']
                    parts = []
                    while True:
                        body = stream.read(CHUNK)
                        if not body:
                            break
                        digest = hashlib.md5(body).digest()
                        part_md5.append(digest)
                        part = self.client.upload_part(
                            Bucket=self.bucket, Key=key, UploadId=upload_id,
                            PartNumber=len(part_md5), Body=body, ContentLength=len(body),
                            ContentMD5=base64.b64encode(digest).decode())
                        assert part['ETag'].strip('"') == digest.hex(), 'Part checksum mismatch'
                        parts.append({'PartNumber': len(part_md5), 'ETag': part['ETag']})
                    response = self.client.complete_multipart_upload(
                        Bucket=self.bucket, Key=key, UploadId=upload_id,
                        MultipartUpload={'Parts': parts})
                    upload_id = None
                    expected = hashlib.md5(b''.join(part_md5)).hexdigest() + '-' + str(len(parts))
            assert response['ETag'].strip('"') == expected, 'Upload ETag mismatch'
            head = self.client.head_object(Bucket=self.bucket, Key=key)
            assert head['ContentLength'] == size, 'Stored size mismatch'
            assert head['Metadata'].get('sha256') == sha, 'Stored SHA256 metadata mismatch'
            assert head['ETag'].strip('"') == expected, 'Stored ETag mismatch'
            with self.db() as db:
                db.execute('INSERT OR REPLACE INTO objects VALUES(?,?,?,?,?,?)',
                           (sha, key, size, expected, mime, int(time.time())))
            return key, expected, mime
        finally:
            if upload_id:
                self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=upload_id)

    def archive(self, path, stat):
        relative = str(path.relative_to(self.source))
        with self.db() as db:
            cached = db.execute('SELECT bytes,mtime_ns,state FROM files WHERE path=?', (relative,)).fetchone()
        if cached == (stat.st_size, stat.st_mtime_ns, 'verified'):
            return 'unchanged'
        try:
            sha = hashlib.sha256()
            with path.open('rb') as stream:
                first = stream.read(64)
                sha.update(first)
                while True:
                    body = stream.read(CHUNK)
                    if not body:
                        break
                    sha.update(body)
            digest = sha.hexdigest()
            mime = content_type(path, first)
            with self.locks[int(digest[:2], 16) % len(self.locks)]:
                with self.db() as db:
                    existing = db.execute('SELECT object_key,etag,content_type FROM objects WHERE sha256=?', (digest,)).fetchone()
                if existing:
                    key, etag, mime = existing
                else:
                    key, etag, mime = self.upload(path, stat.st_size, digest, mime)
            after = path.stat()
            if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                self.record(path, after, state='changed', error='Source changed during upload; retry on next scan')
                return 'changed'
            self.record(path, stat, state='verified', sha=digest, key=key, etag=etag, mime=mime)
            return 'verified'
        except Exception as error:
            code = error.response.get('Error', {}).get('Code') if isinstance(error, ClientError) else type(error).__name__
            self.record(path, stat, state='error', error=code)
            return 'error'

    def status(self):
        with self.db() as db:
            states = dict(db.execute('SELECT state,COUNT(*) FROM files GROUP BY state'))
            count, size = db.execute('SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM objects').fetchone()
            modules = [{'module': module, 'files': files, 'GiB': round(size / 2**30, 3)}
                       for module, files, size in db.execute("SELECT module,COUNT(*),SUM(bytes) FROM files WHERE state='verified' GROUP BY module")]
            errors = dict(db.execute("SELECT error,COUNT(*) FROM files WHERE state='error' GROUP BY error"))
        result = {'time': int(time.time()), 'states': states, 'uniqueObjects': count,
                  'uniqueGiB': round(size / 2**30, 3), 'modules': modules, 'errors': errors}
        temp = self.state / 'status.tmp'
        temp.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        temp.replace(self.state / 'status.json')
        return result

    def scan(self):
        pending = list(self.discover())
        last = time.monotonic()
        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            tasks = [executor.submit(self.archive, path, stat) for path, stat in pending]
            for task in as_completed(tasks):
                task.result()
                if time.monotonic() - last >= 30:
                    print(json.dumps(self.status()), flush=True)
                    last = time.monotonic()
        print(json.dumps({'scanComplete': True, 'eligibleFiles': len(pending), **self.status()}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/source')
    parser.add_argument('--state', default='/state')
    parser.add_argument('--connection', default='/run/secrets/oss-connection.json')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    archive = Archive(args.source, args.state, args.connection, args.workers)
    while True:
        archive.scan()
        if args.once:
            break
        time.sleep(60)
