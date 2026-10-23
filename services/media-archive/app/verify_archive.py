"""Exercise multipart integrity, deduplication and private ranged playback."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time

import requests

from media_archive import Archive, CHUNK

with tempfile.TemporaryDirectory(prefix='wis-oss-regression-') as temporary:
    root = Path(temporary)
    source = root / 'source'
    source.mkdir()
    path = source / 'multipart-probe.mp4'
    body = os.urandom(CHUNK + 1024)
    path.write_bytes(body)
    os.utime(path, (time.time() - 120, time.time() - 120))
    archive = Archive(source, root / 'state', '/run/secrets/oss-connection.json', workers=1)
    key = None
    try:
        archive.scan()
        status = archive.status()
        assert status['states'] == {'verified': 1}, status
        assert status['uniqueObjects'] == 1
        with archive.db() as db:
            key, digest = db.execute('SELECT object_key,sha256 FROM files').fetchone()
        assert digest == hashlib.sha256(body).hexdigest()
        url = archive.client.generate_presigned_url('get_object',
              Params={'Bucket': archive.bucket, 'Key': key}, ExpiresIn=60)
        response = requests.get(url, headers={'Range': 'bytes=16777210-16777230'}, timeout=20)
        assert response.status_code == 206
        assert response.content == body[16777210:16777231]
        public = requests.get(archive.connection['endpoint'] + '/' + archive.bucket + '/' + key, timeout=20)
        assert public.status_code == 403
        duplicate = source / 'duplicate.mp4'
        shutil.copyfile(path, duplicate)
        os.utime(duplicate, (time.time() - 120, time.time() - 120))
        archive.scan()
        status = archive.status()
        assert status['states'] == {'verified': 2}
        assert status['uniqueObjects'] == 1
        assert path.read_bytes() == body and duplicate.read_bytes() == body
        print(json.dumps({'multipartIntegrity': True, 'crossPartRange': True,
                          'privateAccess': True, 'deduplication': True,
                          'localFilesPreserved': True}))
    finally:
        if key:
            archive.client.delete_object(Bucket=archive.bucket, Key=key)
