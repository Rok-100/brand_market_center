"""Resume only FK creation after a verified row import."""
import hashlib
import json
import sqlite3
import sys
from common import mysql_connection, quote_identifier as q
from migrate_sqlite import describe, create_table

scope = sys.argv[1]
source = sqlite3.connect('file:/state/' + scope + '-source.sqlite?mode=ro&immutable=1', uri=True)
specs = describe(source,scope)
db = mysql_connection()
for spec in specs.values():
    create_table(db, spec)
for spec in specs.values():
    grouped = {}
    for fk in spec['foreignKeys']: grouped.setdefault(fk['id'], []).append(fk)
    for identity, keys in grouped.items():
        keys.sort(key=lambda key:key['seq'])
        parent = specs[keys[0]['table']]
        name = 'f_' + hashlib.sha256((scope + spec['name'] + str(identity)).encode()).hexdigest()[:24]
        with db.cursor() as cursor:
            cursor.execute('SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_name=%s',(name,))
            if cursor.fetchone()[0]: continue
            targets = [key['to'] or parent['pk'][key['seq']] for key in keys]
            sql = 'ALTER TABLE '+q(spec['mysql'])+' ADD CONSTRAINT '+q(name)+' FOREIGN KEY ('+','.join(q(key['from']) for key in keys)+') REFERENCES '+q(parent['mysql'])+' ('+','.join(q(column) for column in targets)+') ON DELETE '+keys[0]['on_delete']+' ON UPDATE '+keys[0]['on_update']
            try:
                cursor.execute(sql)
            except Exception as error:
                cursor.execute('SHOW WARNINGS')
                print(json.dumps({'table':spec['name'],'keys':keys,'columns':[c for c in spec['columns'] if c['name'] in {key['from'] for key in keys}],'code':error.args[0],'warnings':cursor.fetchall()}),flush=True)
                raise
print(json.dumps({'foreignKeysVerified':True}))
db.close()
