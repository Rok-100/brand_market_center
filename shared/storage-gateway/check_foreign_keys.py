"""Identify an import FK incompatibility, without logging row values."""
import json
import sqlite3
import sys
from common import mysql_connection, quote_identifier as q
from migrate_sqlite import describe

scope = sys.argv[1]
source = sqlite3.connect('file:/state/' + scope + '-source.sqlite?mode=ro&immutable=1', uri=True)
specs = describe(source, scope)
db = mysql_connection()
with db.cursor() as cursor:
    for spec in specs.values():
        for fk in spec['foreignKeys']:
            parent = specs[fk['table']]
            parent_column = fk['to'] or parent['pk'][fk['seq']]
            names = [(spec['mysql'], fk['from']), (parent['mysql'], parent_column)]
            information = []
            for table, column in names:
                cursor.execute('SELECT column_type,collation_name,column_key FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=%s AND column_name=%s',(table,column))
                information.append(cursor.fetchone())
            cursor.execute('SELECT COUNT(*) FROM '+q(spec['mysql'])+' c LEFT JOIN '+q(parent['mysql'])+' p ON c.'+q(fk['from'])+'=p.'+q(parent_column)+' WHERE c.'+q(fk['from'])+' IS NOT NULL AND p.'+q(parent_column)+' IS NULL')
            orphans = cursor.fetchone()[0]
            if information[0][:2] != information[1][:2] or information[1][2] not in {'PRI','UNI'} or orphans:
                print(json.dumps({'table':spec['name'],'column':fk['from'],'parent':fk['table'],'parentColumn':parent_column,'types':information,'orphans':orphans}))
db.close()
