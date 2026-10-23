"""Publish a registry only after completed row hashes and all FKs are proven."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import time
from common import mysql_connection, quote_identifier as q
from migrate_sqlite import describe

scope = sys.argv[1]
snapshot = sqlite3.connect('file:/state/' + scope + '-source.sqlite?mode=ro&immutable=1',uri=True)
specs = describe(snapshot,scope)
verified = {}
for line in Path('/evidence/' + scope + '-import.log').read_text().splitlines():
    try: item = json.loads(line)
    except ValueError: continue
    if item.get('scope') == scope and item.get('verified') is True and len(item.get('sha256','')) == 64:
        verified[item['table']] = item
assert set(verified) == set(specs), 'Every table needs completed row-hash evidence'
db = mysql_connection()
with db.cursor() as cursor:
    for name,spec in specs.items():
        cursor.execute('SELECT COUNT(*) FROM ' + q(spec['mysql']))
        assert cursor.fetchone()[0] == verified[name]['rows'], 'Target changed since its verified import'
        for identity in {fk['id'] for fk in spec['foreignKeys']}:
            label = 'f_' + hashlib.sha256((scope + name + str(identity)).encode()).hexdigest()[:24]
            cursor.execute('SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_name=%s',(label,))
            assert cursor.fetchone()[0] == 1, 'Foreign key was not validated'
    cursor.execute('INSERT INTO pinying_storage_schemas VALUES(%s,%s,%s,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE schema_json=VALUES(schema_json),updated_at=VALUES(updated_at)',(scope,str('/state/'+scope+'-source.sqlite'),json.dumps(specs)))
result = {'scope':scope,'tables':list(verified.values()),'sourceIntegrity':'ok','foreignKeysVerified':True,'finishedAt':int(time.time())}
Path('/state/' + scope + '-verified.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'scope':scope,'nativeTablesVerified':len(specs),'nativeRowsVerified':sum(item['rows'] for item in verified.values()),'foreignKeysVerified':True}),flush=True)
db.close()
snapshot.close()
