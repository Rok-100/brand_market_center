"""DB-API compatibility for explicitly registered legacy SQLite paths."""
import json
import os
from pathlib import Path
import re
import urllib.request
import urllib.error
from urllib.parse import urlsplit,unquote
import uuid


class Row:
    def __init__(self,names,values):self.names=names;self.values=values
    def __getitem__(self,key):return self.values[self.names.index(key)] if isinstance(key,str) else self.values[key]
    def __iter__(self):return iter(self.values)
    def __len__(self):return len(self.values)
    def keys(self):return self.names


class Cursor:
    def __init__(self,connection):self.connection=connection;self.rows=[];self.position=0;self.description=None;self.rowcount=-1;self.lastrowid=None
    def execute(self,sql,params=()):
        response=self.connection.query(sql,params)
        names=response.get('columns',[])
        self.description=[(name,None,None,None,None,None,None) for name in names] if names else None
        self.rows=response.get('raw',[]);self.position=0
        self.rowcount=response.get('meta',{}).get('changes',-1);self.lastrowid=response.get('meta',{}).get('last_row_id')
        return self
    def executemany(self,sql,rows):
        total=0
        for values in rows:self.execute(sql,values);total+=max(self.rowcount,0)
        self.rowcount=total;return self
    def fetchone(self):
        if self.position>=len(self.rows):return None
        row=self.rows[self.position];self.position+=1
        if self.connection.row_factory is not None:return Row([item[0] for item in self.description],row)
        return tuple(row)
    def fetchall(self):
        result=[]
        while self.position<len(self.rows):result.append(self.fetchone())
        return result
    def fetchmany(self,size=1):
        result=[]
        for _ in range(size):
            row=self.fetchone()
            if row is None:break
            result.append(row)
        return result
    def __iter__(self):
        while True:
            row=self.fetchone()
            if row is None:return
            yield row
    def close(self):self.rows=[]


class Connection:
    def __init__(self,configuration,isolation_level=''):
        self.configuration=configuration;self.row_factory=None;self.isolation_level=isolation_level;self.session=None;self.closed=False
    def rpc(self,route,payload):
        payload={'id':str(uuid.uuid4()),**payload}
        body=json.dumps(payload).encode()
        request=urllib.request.Request(self.configuration['url']+'/'+route+'/'+self.configuration['scope'],data=body,
                    headers={'Content-Type':'application/json','Authorization':'Bearer '+self.configuration['token']})
        failure=None
        for attempt in range(2):
            try:
                with urllib.request.urlopen(request,timeout=20) as response:return json.loads(response.read())
            except urllib.error.HTTPError as error:
                try:message=json.loads(error.read()).get('error','Database operation failed')
                except Exception:message='Database operation failed'
                if error.code<500:raise RuntimeError(message) from None
                failure=RuntimeError(message)
            except (OSError,TimeoutError) as error:failure=error
        raise failure
    def begin(self):
        if self.session:raise RuntimeError('Transaction already active')
        self.session=str(uuid.uuid4());self.rpc('session',{'session':self.session,'control':'begin'})
    def query(self,sql,params=()):
        command=sql.strip().rstrip(';')
        if re.fullmatch(r'BEGIN(?:\s+IMMEDIATE)?',command,re.I):self.begin();return {'results':[],'meta':{}}
        if command.upper()=='COMMIT':self.commit();return {'results':[],'meta':{}}
        if command.upper()=='ROLLBACK':self.rollback();return {'results':[],'meta':{}}
        if isinstance(params,dict):
            # Preserve named SQLite parameter order without interpolation of values.
            ordered=[]
            def placeholder(match):ordered.append(params[match[1]]);return '?'
            command=re.sub(r':([A-Za-z_][A-Za-z0-9_]*)',placeholder,command);params=ordered
        if not self.session and self.isolation_level is not None and re.match(r'(INSERT|UPDATE|DELETE|REPLACE)\b',command,re.I):self.begin()
        if self.session:return self.rpc('session',{'session':self.session,'control':'query','sql':command,'params':list(params)})
        return self.rpc('sql',{'queries':[{'sql':command,'params':list(params)}]})[0]
    def cursor(self):return Cursor(self)
    def execute(self,sql,params=()):return self.cursor().execute(sql,params)
    def executemany(self,sql,rows):return self.cursor().executemany(sql,rows)
    def executescript(self,sql):
        for statement in sql.split(';'):
            if statement.strip():self.execute(statement)
        return self.cursor()
    def commit(self):
        if self.session:self.rpc('session',{'session':self.session,'control':'commit'});self.session=None
    def rollback(self):
        if self.session:self.rpc('session',{'session':self.session,'control':'rollback'});self.session=None
    def close(self):
        if not self.closed:self.rollback();self.closed=True
    def __enter__(self):return self
    def __exit__(self,kind,*args):self.rollback() if kind else self.commit()
    @property
    def in_transaction(self):return self.session is not None


def install():
    import sqlite3
    filename=os.getenv('PINYING_PYTHON_SQLITE_CONFIG_FILE')
    if not filename:return
    mapping=json.loads(Path(filename).read_text())
    original=sqlite3.connect
    def connect(database,*args,**kwargs):
        raw=str(database)
        path=str(Path(unquote(urlsplit(raw).path) if raw.startswith('file:') else raw).resolve())
        configuration=mapping.get(path)
        if not configuration:return original(database,*args,**kwargs)
        return Connection(configuration,kwargs.get('isolation_level',''))
    sqlite3.connect=connect
