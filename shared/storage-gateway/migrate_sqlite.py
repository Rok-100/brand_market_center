"""Versioned, resumable SQLite-to-MySQL import preserving IDs and row ordering.

Only py_<scope>_* tables owned by this migration are created or updated. Existing
tables in the supplied database are never dropped, truncated or repurposed.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
import pymysql

from common import canonical, mysql_connection, quote_identifier as q, table_name


def sqlite_quote(value):
    return '"' + value.replace('"', '""') + '"'


def describe(source, scope):
    tables = {}
    for name, ddl in source.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        if name.startswith(('_cf_', '_pinying_')):
            continue  # Workerd bookkeeping, not application records.
        if not ddl or 'VIRTUAL TABLE' in ddl.upper():
            raise ValueError('Virtual tables require an explicit mapping: ' + name)
        columns = [dict(zip(['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], row))
                   for row in source.execute('PRAGMA table_info(' + sqlite_quote(name) + ')')]
        pk = sorted([column for column in columns if column['pk']], key=lambda column: column['pk'])
        integer_pk = pk[0]['name'] if len(pk) == 1 and pk[0]['type'].upper() == 'INTEGER' else None
        indexes = []
        for index in source.execute('PRAGMA index_list(' + sqlite_quote(name) + ')'):
            indexed = [row[2] for row in source.execute('PRAGMA index_info(' + sqlite_quote(index[1]) + ')')]
            if index[3] != 'pk' and indexed and all(indexed):
                condition = None
                if index[4]:
                    index_sql = source.execute('SELECT sql FROM sqlite_master WHERE name=?', (index[1],)).fetchone()[0]
                    condition = re.split(r'\bWHERE\b', index_sql, flags=re.I, maxsplit=1)[1].strip()
                    # The verified partial index in this application is an enum
                    # membership constraint, with identical syntax in both DBs.
                    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*\s+IN\s*\(\s*'[^']+'(?:\s*,\s*'[^']+')*\s*\)", condition, re.I):
                        raise ValueError('Partial index requires an explicit mapping: ' + name + '.' + index[1])
                indexes.append({'name': index[1], 'unique': bool(index[2]), 'columns': indexed, 'partial': bool(index[4]), 'condition': condition})
        foreign = [dict(zip(['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'], row))
                   for row in source.execute('PRAGMA foreign_key_list(' + sqlite_quote(name) + ')')]
        for column in columns:
            kind = column['type'].upper()
            unique_member = any(index['unique'] and column['name'] in index['columns'] for index in indexes)
            declared_varchar = re.fullmatch(r'VARCHAR\((\d+)\)', kind)
            bounded_unique = unique_member and declared_varchar and int(declared_varchar[1]) <= 768
            if column['pk'] or any(key['from'] == column['name'] for key in foreign) or bounded_unique:
                if not any(word in kind for word in ['INT', 'BOOL']):
                    length = source.execute('SELECT MAX(length(' + sqlite_quote(column['name']) + ')) FROM ' + sqlite_quote(name)).fetchone()[0] or 0
                    assert length <= 768, 'Text primary/foreign key exceeds the verified MySQL index limit'
                    column['mysql_key_length'] = max(191, length, int(declared_varchar[1]) if bounded_unique else 0)
        tables[name] = {'name': name, 'mysql': table_name(scope, name), 'ddl': ddl, 'columns': columns,
                        'pk': [column['name'] for column in pk], 'integerPk': integer_pk,
                        'rowid': 'WITHOUT ROWID' not in ddl.upper(), 'indexes': indexes, 'foreignKeys': foreign}
    return tables


def mysql_type(column):
    kind = column['type'].upper()
    if 'BOOL' in kind:
        return 'TINYINT(1)'
    if 'INT' in kind:
        return 'BIGINT'
    if any(word in kind for word in ['REAL', 'FLOA', 'DOUB', 'NUMERIC', 'DECIMAL']):
        return 'DOUBLE'
    if 'BLOB' in kind or 'BINARY' in kind or not kind:
        return 'LONGBLOB'
    if 'DATETIME' in kind or 'TIMESTAMP' in kind:
        return 'DATETIME(6)'
    if kind == 'DATE':
        return 'DATE'
    if kind == 'TIME':
        return 'TIME(6)'
    if column.get('mysql_key_length'):
        return 'VARCHAR(' + str(column['mysql_key_length']) + ')'
    return 'LONGTEXT'


def create_table(db, spec):
    pieces = []
    partial_columns = []
    native_unique_indexes = []
    for column in spec['columns']:
        definition = q(column['name']) + ' ' + mysql_type(column)
        if column['notnull'] or column['pk']:
            definition += ' NOT NULL'
        if spec['integerPk'] == column['name']:
            definition += ' AUTO_INCREMENT'
        default = column['dflt_value']
        if default is not None and spec['integerPk'] != column['name']:
            if str(default).upper() == 'CURRENT_TIMESTAMP' and mysql_type(column) == 'LONGTEXT':
                definition += ' DEFAULT (CURRENT_TIMESTAMP)'
            elif mysql_type(column) in {'LONGTEXT', 'LONGBLOB'}:
                definition += ' DEFAULT (' + str(default) + ')'
            else:
                definition += ' DEFAULT ' + str(default)
        pieces.append(definition)
    if spec['pk']:
        pieces.append('PRIMARY KEY (' + ','.join(q(name) for name in spec['pk']) + ')')
    if spec['rowid']:
        if not spec['integerPk']:
            pieces.append('`__rowid` BIGINT NOT NULL AUTO_INCREMENT UNIQUE')
    for position, index in enumerate(spec['indexes']):
        label = 'i_' + str(position)
        column_map = {column['name']: column for column in spec['columns']}
        if index['unique']:
            key_types = [mysql_type(column_map[name]) for name in index['columns']]
            native_bytes = sum(int(kind[8:-1]) * 4 if kind.startswith('VARCHAR(') else 8 for kind in key_types)
            native = not index.get('condition') and all(kind in {'BIGINT','TINYINT(1)','DOUBLE','DATE','DATETIME(6)','TIME(6)'} or kind.startswith('VARCHAR(') for kind in key_types) and native_bytes <= 3072
            if native:
                keys = ','.join(q(name) for name in index['columns'])
                pieces.append('UNIQUE KEY ' + q(label) + ' (' + keys + ')')
                native_unique_indexes.append((label, '__unique_' + str(position), keys))
                continue
            # Full-text uniqueness uses a generated digest, avoiding truncation of
            # long OSS keys while retaining SQLite's multiple-NULL behavior.
            value = 'JSON_ARRAY(' + ','.join(q(name) for name in index['columns']) + ')'
            nullable = ' OR '.join(q(name) + ' IS NULL' for name in index['columns'])
            if index.get('condition'):
                nullable += ' OR NOT (' + index['condition'] + ')'
            generated = q('__unique_' + str(position)) + ' BINARY(32) GENERATED ALWAYS AS (IF(' + nullable + ',NULL,UNHEX(SHA2(' + value + ',256)))) STORED'
            pieces.append(generated)
            if index.get('condition'):
                partial_columns.append(generated)
            pieces.append('UNIQUE KEY ' + q(label) + ' (' + q('__unique_' + str(position)) + ')')
        else:
            keys = [q(name) + ('(191)' if mysql_type(column_map[name]) in {'LONGTEXT', 'LONGBLOB'} else '') for name in index['columns']]
            pieces.append('KEY ' + q(label) + ' (' + ','.join(keys) + ')')
    with db.cursor() as cursor:
        cursor.execute('CREATE TABLE IF NOT EXISTS ' + q(spec['mysql']) + ' (' + ','.join(pieces) + ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin')
        for column in spec['columns']:
            if not column.get('mysql_key_length'):
                continue
            cursor.execute('SELECT data_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=%s AND column_name=%s', (spec['mysql'], column['name']))
            if cursor.fetchone()[0] == 'longtext':
                definition = q(column['name']) + ' ' + mysql_type(column) + (' NOT NULL' if column['notnull'] or column['pk'] else ' NULL')
                if column['dflt_value'] is not None:
                    definition += ' DEFAULT ' + str(column['dflt_value'])
                cursor.execute('ALTER TABLE ' + q(spec['mysql']) + ' MODIFY COLUMN ' + definition)
        for label, generated_name, keys in native_unique_indexes:
            cursor.execute('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=%s AND column_name=%s', (spec['mysql'], generated_name))
            if cursor.fetchone()[0]:
                # Native indexes allow MySQL to preserve cascading foreign keys.
                # Stored generated digests cannot reference a cascading FK base.
                cursor.execute('ALTER TABLE ' + q(spec['mysql']) + ' DROP INDEX ' + q(label) + ',DROP COLUMN ' + q(generated_name) + ',ADD UNIQUE KEY ' + q(label) + ' (' + keys + ')')
        for generated in partial_columns:
            # Resume an earlier import that had created this owned table before
            # partial-index support was introduced. No shared tables are changed.
            cursor.execute('ALTER TABLE ' + q(spec['mysql']) + ' MODIFY COLUMN ' + generated)


def row_hash(rows, columns):
    digest = hashlib.sha256()
    for row in rows:
        values = []
        for value, column in zip(row, columns):
            kind = column['type'].upper()
            if value is not None and ('DATETIME' in kind or 'TIMESTAMP' in kind):
                if isinstance(value, str):
                    value = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
                value = value.strftime('%Y-%m-%d %H:%M:%S.%f')
            values.append(canonical(value))
        digest.update(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode())
        digest.update(b'\n')
    return digest.hexdigest()


def migrate(scope, source_file, state):
    state.mkdir(parents=True, exist_ok=True)
    backup = state / (scope + '-source.sqlite')
    source = sqlite3.connect('file:' + str(source_file) + '?mode=ro', uri=True, timeout=30)
    snapshot = sqlite3.connect(backup)
    source.backup(snapshot)
    source.close()
    assert snapshot.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
    specs = describe(snapshot, scope)
    db = mysql_connection()
    evidence = []
    try:
        with db.cursor() as cursor:
            cursor.execute('CREATE TABLE IF NOT EXISTS pinying_storage_schemas (scope VARCHAR(32) PRIMARY KEY,source_path LONGTEXT NOT NULL,schema_json JSON NOT NULL,updated_at DATETIME(6) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin')
            cursor.execute('SELECT schema_json FROM pinying_storage_schemas WHERE scope=%s', (scope,))
            old = cursor.fetchone()
            if old:
                old_specs = json.loads(old[0])
                assert set(old_specs) == set(specs), 'Schema changed; add a versioned migration before reimport'
        for spec in specs.values():
            create_table(db, spec)
        for spec in specs.values():
            names = [column['name'] for column in spec['columns']]
            include_rowid = spec['rowid'] and not spec['integerPk']
            source_names = (['rowid'] if include_rowid else []) + [sqlite_quote(name) for name in names]
            target_names = (['__rowid'] if include_rowid else []) + names
            selected = ','.join(source_names)
            order = 'rowid' if spec['rowid'] else ','.join(sqlite_quote(name) for name in spec['pk'])
            query = 'SELECT ' + selected + ' FROM ' + sqlite_quote(spec['name']) + ' ORDER BY ' + order
            source_cursor = snapshot.execute(query)
            count = 0
            insert = 'INSERT INTO ' + q(spec['mysql']) + ' (' + ','.join(q(name) for name in target_names) + ') VALUES (' + ','.join(['%s'] * len(target_names)) + ') ON DUPLICATE KEY UPDATE ' + ','.join(q(name) + '=VALUES(' + q(name) + ')' for name in names)
            while True:
                rows = source_cursor.fetchmany(500)
                if not rows:
                    break
                with db.cursor() as cursor:
                    cursor.executemany(insert, rows)
                count += len(rows)
            source_count = snapshot.execute('SELECT COUNT(*) FROM ' + sqlite_quote(spec['name'])).fetchone()[0]
            with db.cursor() as cursor:
                cursor.execute('SELECT COUNT(*) FROM ' + q(spec['mysql']))
                target_count = cursor.fetchone()[0]
            assert source_count == target_count, 'Row count differs; no application switched'
            source_columns = [sqlite_quote(name) for name in names]
            source_digest = row_hash(snapshot.execute('SELECT ' + ','.join(source_columns) + ' FROM ' + sqlite_quote(spec['name']) + ' ORDER BY ' + order), spec['columns'])
            with db.cursor(pymysql.cursors.SSCursor) as cursor:
                target_order = q(spec['integerPk']) if spec['integerPk'] else '`__rowid`' if spec['rowid'] else ','.join(q(name) for name in spec['pk'])
                cursor.execute('SELECT ' + ','.join(q(name) for name in names) + ' FROM ' + q(spec['mysql']) + ' ORDER BY ' + target_order)
                target_digest = row_hash(cursor, spec['columns'])
            assert source_digest == target_digest, 'Row digest differs; no application switched'
            evidence.append({'table': spec['name'], 'rows': count, 'sha256': source_digest, 'verified': True})
            print(json.dumps({'scope': scope, **evidence[-1]}), flush=True)
        for spec in specs.values():
            grouped = {}
            for foreign in spec['foreignKeys']:
                grouped.setdefault(foreign['id'], []).append(foreign)
            for identity, keys in grouped.items():
                keys.sort(key=lambda key: key['seq'])
                parent = specs[keys[0]['table']]
                constraint = 'f_' + hashlib.sha256((scope + spec['name'] + str(identity)).encode()).hexdigest()[:24]
                with db.cursor() as cursor:
                    cursor.execute('SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_name=%s', (constraint,))
                    present = cursor.fetchone()[0]
                    if not present:
                        target = [key['to'] or parent['pk'][key['seq']] for key in keys]
                        cursor.execute('ALTER TABLE ' + q(spec['mysql']) + ' ADD CONSTRAINT ' + q(constraint) + ' FOREIGN KEY (' + ','.join(q(key['from']) for key in keys) + ') REFERENCES ' + q(parent['mysql']) + ' (' + ','.join(q(name) for name in target) + ') ON DELETE ' + keys[0]['on_delete'] + ' ON UPDATE ' + keys[0]['on_update'])
        with db.cursor() as cursor:
            cursor.execute('INSERT INTO pinying_storage_schemas VALUES(%s,%s,%s,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE schema_json=VALUES(schema_json),updated_at=VALUES(updated_at)',
                           (scope, str(source_file), json.dumps(specs, ensure_ascii=False)))
        result = {'scope': scope, 'sourceIntegrity': 'ok', 'tables': evidence, 'finishedAt': int(time.time())}
        (state / (scope + '-verified.json')).write_text(json.dumps(result, indent=2))
        return result
    finally:
        snapshot.close()
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--state', default='/state')
    args = parser.parse_args()
    migrate(args.scope, Path(args.source), Path(args.state))
