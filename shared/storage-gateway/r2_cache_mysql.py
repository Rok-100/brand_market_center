"""Native MySQL authority for the framework's recoverable R2 metadata cache.

Only this registered cache is restored before its worker starts. Every R2
mutation checkpoints native rows before the operation is acknowledged.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from common import quote_identifier as q,wire

def invoke(db,specs,method,args):
    configuration=json.loads(Path('/run/secrets/r2-cache.json').read_text())
    file=Path(configuration['path']);order=configuration['tables']
    if set(order)!=set(specs):raise ValueError('R2 cache schema differs')
    if method=='restoreR2Cache':
        memory=sqlite3.connect(':memory:')
        source=sqlite3.connect(file) if file.exists() else None
        if source:
            try:source.backup(memory)
            finally:source.close()
        else:
            for name in order:memory.execute(specs[name]['ddl'])
        memory.execute('PRAGMA foreign_keys=OFF')
        for name in reversed(order):memory.execute('DELETE FROM '+q(name))
        counts={}
        with db.cursor() as cursor:
            for name in order:
                spec=specs[name];columns=[c['name'] for c in spec['columns']]
                cursor.execute('SELECT '+','.join(q(c) for c in columns)+' FROM '+q(spec['mysql']))
                rows=cursor.fetchall();counts[name]=len(rows)
                memory.executemany('INSERT INTO '+q(name)+'('+','.join(q(c) for c in columns)+') VALUES('+','.join('?' for c in columns)+')',rows)
        memory.commit();assert memory.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        target=sqlite3.connect(file)
        try:memory.backup(target)
        finally:target.close();memory.close()
        os.chown(file,configuration['uid'],configuration['gid'])
        return {'restored':True,'counts':counts}
    if method!='checkpointR2Cache':raise ValueError('Unknown R2 cache operation')
    memory=sqlite3.connect(':memory:');source=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True)
    try:source.backup(memory)
    finally:source.close()
    try:
        snapshots={}
        for name in order:
            columns=[c['name'] for c in specs[name]['columns']]
            snapshots[name]=memory.execute('SELECT '+','.join(q(c) for c in columns)+' FROM '+q(name)).fetchall()
        with db.cursor() as cursor:
            for name in order:
                spec=specs[name];columns=[c['name'] for c in spec['columns']];rows=snapshots[name]
                if rows:cursor.executemany('INSERT INTO '+q(spec['mysql'])+'('+','.join(q(c) for c in columns)+') VALUES('+','.join('%s' for c in columns)+') ON DUPLICATE KEY UPDATE '+','.join(q(c)+'=VALUES('+q(c)+')' for c in columns),rows)
            for name in reversed(order):
                spec=specs[name];columns=[c['name'] for c in spec['columns']];pk=spec['pk'];indexes=[columns.index(c) for c in pk]
                if not pk:raise ValueError('R2 metadata needs explicit primary keys')
                present={tuple(row[i] for i in indexes) for row in snapshots[name]}
                cursor.execute('SELECT '+','.join(q(c) for c in pk)+' FROM '+q(spec['mysql']))
                removed=[row for row in cursor.fetchall() if row not in present]
                if removed:cursor.executemany('DELETE FROM '+q(spec['mysql'])+' WHERE '+' AND '.join(q(c)+'=%s' for c in pk),removed)
        sha=hashlib.sha256(json.dumps(wire(snapshots),sort_keys=True,separators=(',',':')).encode()).hexdigest()
        return {'checkpointed':True,'counts':{name:len(rows) for name,rows in snapshots.items()},'sha256':sha}
    finally:memory.close()
