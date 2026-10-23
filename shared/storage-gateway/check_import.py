"""Report migration discrepancies without printing business values or credentials."""
import sqlite3
import json
import sys
from migrate_sqlite import describe, row_hash, sqlite_quote
from common import mysql_connection, quote_identifier as q

scope = sys.argv[1]
source = sqlite3.connect('file:/state/' + scope + '-source.sqlite?mode=ro&immutable=1', uri=True)
db = mysql_connection()
for spec in describe(source, scope).values():
    names = [c['name'] for c in spec['columns']]
    order = 'rowid' if spec['rowid'] else ','.join(sqlite_quote(n) for n in spec['pk'])
    rows = list(source.execute('SELECT ' + ','.join(sqlite_quote(n) for n in names) + ' FROM ' + sqlite_quote(spec['name']) + ' ORDER BY ' + order))
    with db.cursor() as cursor:
        target_order = q(spec['integerPk']) if spec['integerPk'] else '`__rowid`' if spec['rowid'] else ','.join(q(n) for n in spec['pk'])
        cursor.execute('SELECT ' + ','.join(q(n) for n in names) + ' FROM ' + q(spec['mysql']) + ' ORDER BY ' + target_order)
        target = cursor.fetchall()
    if row_hash(rows, spec['columns']) != row_hash(target, spec['columns']):
        print(json.dumps({'table': spec['name'], 'sourceCount': len(rows), 'targetCount': len(target), 'columns': spec['columns']}))
        for index, (a, b) in enumerate(zip(rows, target)):
            if row_hash([a], spec['columns']) != row_hash([b], spec['columns']):
                print(json.dumps({'row': index, 'differences': [{'column': n, 'srcType': type(x).__name__, 'dstType': type(y).__name__, 'sourceLength': len(str(x)), 'targetLength': len(str(y))} for n, x, y in zip(names, a, b) if x != y]}))
                break
        break
else:
    print(json.dumps({'allVerified': True}))
