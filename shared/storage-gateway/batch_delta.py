"""Batch online change replay, retaining native FK enforcement and row hashes."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import sqlite3
import time
from common import mysql_connection, quote_identifier as q, wire
from migrate_sqlite import row_hash, sqlite_quote as sq
from tracked_delta import coordinates, insert_rows


def ordered_tables(specs):
    result=[]
    pending=set(specs)
    while pending:
        ready=sorted(name for name in pending if not {fk['table'] for fk in specs[name]['foreignKeys'] if fk['table']!=name}&pending)
        if not ready:raise ValueError('Cyclic FK graph requires an explicit replay order')
        result.extend(ready)
        pending.difference_update(ready)
    return result


def selection(keys,values,quote,placeholder):
    if len(keys)==1:
        return quote(keys[0])+' IN ('+','.join([placeholder]*len(values))+')',[value[0] for value in values]
    expression=' OR '.join('('+' AND '.join(quote(key)+'='+placeholder for key in keys)+')' for _ in values)
    return expression,[item for value in values for item in value]


def replay(source_path,state,scope,final=False):
    source=sqlite3.connect('file:'+str(source_path)+'?mode=rw',uri=True,timeout=30)
    source.execute('PRAGMA busy_timeout=30000')
    source.execute('BEGIN')
    tracker='_pinying_track_'+scope
    watermark=source.execute('SELECT COALESCE(MAX(seq),0) FROM '+sq(tracker)).fetchone()[0]
    changes=defaultdict(list)
    for name,key in source.execute('SELECT DISTINCT table_name,row_key FROM '+sq(tracker)+' WHERE seq<=?',(watermark,)):
        changes[name].append(tuple(json.loads(key)))
    db=mysql_connection(autocommit=False)
    with db.cursor() as cursor:
        cursor.execute('SELECT schema_json FROM pinying_storage_schemas WHERE scope=%s',(scope,))
        specs=json.loads(cursor.fetchone()[0])
        cursor.execute('CREATE TABLE IF NOT EXISTS pinying_migration_row_history(scope VARCHAR(32) NOT NULL,table_name VARCHAR(64) NOT NULL,row_key JSON NOT NULL,previous_row JSON NOT NULL,replacement_row JSON NOT NULL,captured_at DATETIME(6) NOT NULL,KEY lookup(scope,table_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin')
        cursor.execute('SET SESSION foreign_key_checks=1')
    order=ordered_tables(specs)
    deletes=defaultdict(list)
    evidence=[]
    total_changed=0
    try:
        for name in order:
            if name not in changes:continue
            spec=specs[name]
            keys,target_keys=coordinates(spec)
            names=[column['name'] for column in spec['columns']]
            selected=(['rowid'] if spec['rowid'] and not spec['integerPk'] else [])+names
            changed_count=0
            for start in range(0,len(changes[name]),300):
                batch=changes[name][start:start+300]
                predicate,values=selection(keys,batch,sq,'?')
                rows=source.execute('SELECT '+','.join(sq(column) for column in selected)+' FROM '+sq(name)+' WHERE '+predicate,values).fetchall()
                name_indexes={column:index for index,column in enumerate(selected)}
                row_keys=lambda row:tuple(row[name_indexes[key]] for key in keys)
                if keys==['rowid'] and spec['integerPk']:
                    row_keys=lambda row:tuple([row[name_indexes[spec['integerPk']]]])
                incoming={row_keys(row):row for row in rows}
                deletes[name].extend(key for key in batch if key not in incoming)
                predicate,values=selection(target_keys,batch,q,'%s')
                with db.cursor() as cursor:
                    cursor.execute('SELECT '+','.join(q(column) for column in target_keys+names)+' FROM '+q(spec['mysql'])+' WHERE '+predicate,values)
                    existing={tuple(row[:len(keys)]):row[len(keys):] for row in cursor.fetchall()}
                changed=[]
                history=[]
                for key,row in incoming.items():
                    expected=row[1:] if spec['rowid'] and not spec['integerPk'] else row
                    previous=existing.get(key)
                    if previous is not None and row_hash([expected],spec['columns'])==row_hash([previous],spec['columns']):continue
                    changed.append(row)
                    if previous is not None:
                        history.append((scope,name,json.dumps(key),json.dumps(wire(dict(zip(names,previous)))),json.dumps(wire(dict(zip(names,expected))))))
                if history:
                    with db.cursor() as cursor:cursor.executemany('INSERT INTO pinying_migration_row_history VALUES(%s,%s,%s,%s,%s,UTC_TIMESTAMP(6))',history)
                if changed:
                    insert_rows(db,spec,changed)
                    changed_keys=[row_keys(row) for row in changed]
                    predicate,values=selection(target_keys,changed_keys,q,'%s')
                    with db.cursor() as cursor:
                        cursor.execute('SELECT '+','.join(q(column) for column in target_keys+names)+' FROM '+q(spec['mysql'])+' WHERE '+predicate,values)
                        verified={tuple(row[:len(keys)]):row[len(keys):] for row in cursor.fetchall()}
                    for row in changed:
                        expected=row[1:] if spec['rowid'] and not spec['integerPk'] else row
                        assert row_hash([expected],spec['columns'])==row_hash([verified[row_keys(row)]],spec['columns']), 'Changed row differs: '+name
                changed_count+=len(changed)
                if start%3000==0:print(json.dumps({'table':name,'processed':min(start+300,len(changes[name])),'total':len(changes[name]),'changed':changed_count}),flush=True)
            total_changed+=changed_count
            evidence.append({'table':name,'observed':len(changes[name]),'changed':changed_count,'deleted':len(deletes[name]),'rowHashesVerified':True})
        for name in reversed(order):
            if not deletes[name]:continue
            _,target_keys=coordinates(specs[name])
            with db.cursor() as cursor:
                cursor.executemany('DELETE FROM '+q(specs[name]['mysql'])+' WHERE '+' AND '.join(q(key)+'=%s' for key in target_keys),deletes[name])
        db.commit()
        source.rollback()
        with source:source.execute('DELETE FROM '+sq(tracker)+' WHERE seq<=?',(watermark,))
        remaining=source.execute('SELECT COUNT(*) FROM '+sq(tracker)).fetchone()[0]
        if final:
            assert remaining==0,'A source writer is still active'
            with db.cursor() as cursor:
                for name in changes:
                    expected=source.execute('SELECT COUNT(*) FROM '+sq(name)).fetchone()[0]
                    cursor.execute('SELECT COUNT(*) FROM '+q(specs[name]['mysql']))
                    assert cursor.fetchone()[0]==expected,'Final table count differs: '+name
        result={'scope':scope,'watermark':watermark,'tables':evidence,'remainingEvents':remaining,'changedRows':total_changed,'nativeForeignKeysEnforced':True,'final':final,'finishedAt':int(time.time())}
        (state/(scope+'-batch-delta-'+str(watermark)+'.json')).write_text(json.dumps(result,indent=2))
        (state/(scope+'-batch-delta-latest.json')).write_text(json.dumps(result,indent=2))
        print(json.dumps({key:result[key] for key in ['scope','remainingEvents','changedRows','nativeForeignKeysEnforced','final']}),flush=True)
    except Exception:
        db.rollback()
        source.rollback()
        raise
    finally:
        db.close()
        source.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',required=True)
    parser.add_argument('--scope',required=True)
    parser.add_argument('--state',default='/state')
    parser.add_argument('--final',action='store_true')
    args=parser.parse_args()
    replay(Path(args.source),Path(args.state),args.scope,args.final)
