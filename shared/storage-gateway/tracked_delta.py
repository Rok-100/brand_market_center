"""Track online SQLite writes so a large, verified import can cut over quickly.

An initial snapshot-to-snapshot diff covers writes since the bulk import. Small
key-only triggers then capture subsequent inserts, updates and deletes. Their
table and trigger names are isolated and removed after cutover or rollback.
"""
import argparse
import json
from pathlib import Path
import sqlite3
import time
from common import mysql_connection, quote_identifier as q, wire
from migrate_sqlite import describe, sqlite_quote as sq, row_hash


def source_connection(path, readonly=False):
    db = sqlite3.connect('file:' + str(path) + ('?mode=ro' if readonly else ''), uri=True, timeout=30)
    db.execute('PRAGMA busy_timeout=30000')
    return db


def prepare(source, specs, scope):
    tracker = '_pinying_track_' + scope
    with source:
        source.execute('CREATE TABLE IF NOT EXISTS ' + sq(tracker) + '(seq INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT NOT NULL,row_key TEXT NOT NULL)')
        for name, spec in specs.items():
            keys = ['rowid'] if spec['rowid'] else spec['pk']
            for operation in ['INSERT','UPDATE','DELETE']:
                trigger = '_pinying_' + scope + '_' + name + '_' + operation.lower()
                prefixes = ['OLD','NEW'] if operation == 'UPDATE' else ['OLD'] if operation == 'DELETE' else ['NEW']
                inserts = []
                for prefix in prefixes:
                    key_json = 'json_array(' + ','.join(prefix + '.' + sq(key) for key in keys) + ')'
                    inserts.append('INSERT INTO ' + sq(tracker) + '(table_name,row_key) VALUES(' + "'" + name.replace("'","''") + "'," + key_json + ');')
                source.execute('CREATE TRIGGER IF NOT EXISTS ' + sq(trigger) + ' AFTER ' + operation + ' ON ' + sq(name) + ' BEGIN ' + ''.join(inserts) + ' END')
    return tracker


def coordinates(spec):
    return (['rowid'], [spec['integerPk'] or '__rowid']) if spec['rowid'] else (spec['pk'],spec['pk'])


def insert_rows(db, spec, rows):
    columns = [column['name'] for column in spec['columns']]
    if spec['rowid'] and not spec['integerPk']: columns = ['__rowid'] + columns
    sql = 'INSERT INTO ' + q(spec['mysql']) + ' (' + ','.join(q(name) for name in columns) + ') VALUES (' + ','.join(['%s'] * len(columns)) + ') ON DUPLICATE KEY UPDATE ' + ','.join(q(name) + '=VALUES(' + q(name) + ')' for name in columns)
    with db.cursor() as cursor:
        cursor.executemany(sql, rows)


def compare(scope, source_path, state):
    old_path = state / (scope + '-source.sqlite')
    old = sqlite3.connect('file:' + str(old_path) + '?mode=ro&immutable=1', uri=True)
    specs = describe(old, scope)
    old.close()
    source = source_connection(source_path)
    tracker = prepare(source, specs, scope)
    new_path = state / (scope + '-delta.sqlite')
    snapshot = sqlite3.connect(new_path)
    source.backup(snapshot)
    source.close()
    snapshot.execute('ATTACH DATABASE ? AS imported', (str(old_path),))
    db = mysql_connection(autocommit=False)
    evidence = []
    try:
        with db.cursor() as cursor: cursor.execute('SET SESSION foreign_key_checks=0')
        for name,spec in specs.items():
            keys,target_keys = coordinates(spec)
            names = [column['name'] for column in spec['columns']]
            selected = (['rowid'] if spec['rowid'] and not spec['integerPk'] else []) + names
            join = ' AND '.join('n.' + sq(key) + '=o.' + sq(key) for key in keys)
            differs = ' OR '.join('n.' + sq(name) + ' IS NOT o.' + sq(name) for name in names)
            rows = snapshot.execute('SELECT ' + ','.join('n.' + sq(column) for column in selected) + ' FROM main.' + sq(name) + ' n LEFT JOIN imported.' + sq(name) + ' o ON ' + join + ' WHERE o.' + sq(keys[0]) + ' IS NULL OR ' + differs)
            changed = 0
            while True:
                batch = rows.fetchmany(500)
                if not batch: break
                insert_rows(db,spec,batch)
                changed += len(batch)
            deleted = snapshot.execute('SELECT ' + ','.join('o.' + sq(key) for key in keys) + ' FROM imported.' + sq(name) + ' o LEFT JOIN main.' + sq(name) + ' n ON ' + join + ' WHERE n.' + sq(keys[0]) + ' IS NULL').fetchall()
            if deleted:
                with db.cursor() as cursor:
                    cursor.executemany('DELETE FROM ' + q(spec['mysql']) + ' WHERE ' + ' AND '.join(q(key) + '=%s' for key in target_keys), deleted)
            db.commit()
            item = {'table':name,'changedRows':changed,'deletedRows':len(deleted)}
            evidence.append(item)
            print(json.dumps(item),flush=True)
        with db.cursor() as cursor: cursor.execute('SET SESSION foreign_key_checks=1')
        (state / (scope + '-delta-ready.json')).write_text(json.dumps({'scope':scope,'tracker':tracker,'tables':evidence,'capturedAt':int(time.time())},indent=2))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        snapshot.close()


def apply(scope, source_path, state):
    ready = json.loads((state / (scope + '-delta-ready.json')).read_text())
    source = source_connection(source_path, readonly=True)
    old = sqlite3.connect('file:' + str(state / (scope + '-source.sqlite')) + '?mode=ro&immutable=1', uri=True)
    specs = describe(old,scope)
    old.close()
    changes = source.execute('SELECT DISTINCT table_name,row_key FROM ' + sq(ready['tracker'])).fetchall()
    db = mysql_connection(autocommit=False)
    try:
        with db.cursor() as cursor:
            cursor.execute('CREATE TABLE IF NOT EXISTS pinying_migration_row_history(scope VARCHAR(32) NOT NULL,table_name VARCHAR(64) NOT NULL,row_key JSON NOT NULL,previous_row JSON NOT NULL,replacement_row JSON NOT NULL,captured_at DATETIME(6) NOT NULL,KEY lookup(scope,table_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin')
            cursor.execute('SET SESSION foreign_key_checks=0')
        for name,key_json in changes:
            spec = specs[name]
            keys, target_keys = coordinates(spec)
            key = json.loads(key_json)
            names = [column['name'] for column in spec['columns']]
            selected = (['rowid'] if spec['rowid'] and not spec['integerPk'] else []) + names
            row = source.execute('SELECT ' + ','.join(sq(column) for column in selected) + ' FROM ' + sq(name) + ' WHERE ' + ' AND '.join(sq(column) + '=?' for column in keys),key).fetchone()
            if row:
                expected = row[1:] if spec['rowid'] and not spec['integerPk'] else row
                with db.cursor() as cursor:
                    cursor.execute('SELECT ' + ','.join(q(column) for column in names) + ' FROM ' + q(spec['mysql']) + ' WHERE ' + ' AND '.join(q(column) + '=%s' for column in target_keys),key)
                    previous = cursor.fetchone()
                    if previous is not None and row_hash([expected],spec['columns']) != row_hash([previous],spec['columns']):
                        cursor.execute('INSERT INTO pinying_migration_row_history VALUES(%s,%s,%s,%s,%s,UTC_TIMESTAMP(6))',
                                       (scope,name,key_json,json.dumps(wire(dict(zip(names,previous)))),json.dumps(wire(dict(zip(names,expected))))))
                insert_rows(db,spec,[row])
                with db.cursor() as cursor:
                    cursor.execute('SELECT ' + ','.join(q(column) for column in names) + ' FROM ' + q(spec['mysql']) + ' WHERE ' + ' AND '.join(q(column) + '=%s' for column in target_keys),key)
                    target = cursor.fetchone()
                assert target is not None and row_hash([expected],spec['columns']) == row_hash([target],spec['columns']), 'Changed row digest differs: ' + name
            else:
                with db.cursor() as cursor: cursor.execute('DELETE FROM ' + q(spec['mysql']) + ' WHERE ' + ' AND '.join(q(column) + '=%s' for column in target_keys),key)
        db.commit()
        counts = []
        for name,spec in specs.items():
            expected = source.execute('SELECT COUNT(*) FROM ' + sq(name)).fetchone()[0]
            with db.cursor() as cursor:
                cursor.execute('SELECT COUNT(*) FROM ' + q(spec['mysql']))
                actual = cursor.fetchone()[0]
            assert expected == actual, 'Final row count differs: ' + name
            counts.append({'table':name,'rows':actual})
            for foreign in spec['foreignKeys']:
                parent = specs[foreign['table']]
                column = foreign['to'] or parent['pk'][foreign['seq']]
                with db.cursor() as cursor:
                    cursor.execute('SELECT COUNT(*) FROM ' + q(spec['mysql']) + ' c LEFT JOIN ' + q(parent['mysql']) + ' p ON c.' + q(foreign['from']) + '=p.' + q(column) + ' WHERE c.' + q(foreign['from']) + ' IS NOT NULL AND p.' + q(column) + ' IS NULL')
                    assert cursor.fetchone()[0] == 0, 'Foreign key differs: ' + name
        with db.cursor() as cursor: cursor.execute('SET SESSION foreign_key_checks=1')
        result = {'scope':scope,'changesApplied':len(changes),'counts':counts,'foreignKeysVerified':True,'changedRowHashesVerified':True}
        (state / (scope + '-final-delta.json')).write_text(json.dumps(result,indent=2))
        print(json.dumps({'scope':scope,'changesApplied':len(changes),'finalCountsVerified':True,'foreignKeysVerified':True}),flush=True)
    except Exception:
        db.rollback()
        raise
    finally:
        source.close()
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode',choices=['compare','apply'])
    parser.add_argument('--scope',required=True)
    parser.add_argument('--source',required=True)
    parser.add_argument('--state',default='/state')
    args = parser.parse_args()
    globals()[args.mode](args.scope,Path(args.source),Path(args.state))
