import hashlib
import json
from pathlib import Path
import time
import urllib.request
import uuid
import pymysql

def health():
    with urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=5) as response:
        assert response.status == 200
        return json.load(response)

result = health()
expected = {name: hashlib.sha256(Path('/opt/storage', name).read_bytes()).hexdigest() for name in result['loaded_source_sha256']}
assert result['loaded_source_sha256'] == expected
assert result['build_id'] == 'wis-storage-growth-20261007-r1'
assert result['maintenance']['enabled'] is True
identity = str(uuid.uuid4())
body = json.dumps({'id': identity, 'method': 'statFile', 'args': ['/missing.json']}).encode()
request = urllib.request.Request('http://127.0.0.1:8080/documents/iso_remix', body,
    {'Authorization': 'Bearer isolated-test-token', 'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=5) as response:
    assert response.status == 200 and json.load(response)['exists'] is False
db = pymysql.connect(unix_socket='/mysql/mysqld.sock', user='root', password='', database='storage_test')
try:
    with db.cursor() as cursor:
        cursor.execute('SELECT request_id FROM pinying_rpc_receipts WHERE scope=%s AND request_id=%s', ('iso_remix', identity))
        assert cursor.fetchone() is None
finally: db.close()
deadline = time.monotonic() + 25
while result['maintenance']['runs'] == 0 and time.monotonic() < deadline:
    time.sleep(1)
    result = health()
assert result['maintenance']['runs'] > 0
assert result['maintenance']['last_error'] is None
assert result['maintenance']['history_deleted'] == 0
print(json.dumps({'ok': True, 'actualEntryPoint': True, 'immutableLoadedSha': True,
                  'readReceiptAbsent': True, 'liveMaintenanceCycles': result['maintenance']['runs'],
                  'legacyHistoryUntouched': True, 'loadedSources': expected}))
