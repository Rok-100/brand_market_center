"""Run the actual entry point against the private test database socket only."""
import json
import os
from pathlib import Path
import runpy
import tempfile
import pymysql
from pymysql.constants import CLIENT
import common

tokens = Path(tempfile.mkdtemp()) / 'tokens.json'
tokens.write_text(json.dumps({'iso_remix': 'isolated-test-token', 'iso_business': 'isolated-test-token'}))
os.environ['PINYING_TOKENS'] = str(tokens)
os.environ['PINYING_STORAGE_PROJECT'] = 'FD-026222'
os.environ['PINYING_GROWTH_MAINTENANCE_ENABLED'] = 'true'
os.environ['PINYING_GROWTH_CUTOVER_UTC'] = '2026-10-07T10:00:00Z'
os.environ['PINYING_HISTORY_PATHS_JSON'] = json.dumps({'iso_remix': ['/isolated/history.json']})
os.environ['PINYING_HISTORY_PRUNE_MIN_VERSIONS_JSON'] = json.dumps({'iso_remix': {'/isolated/history.json': 201}})
os.environ['PINYING_HISTORY_CHECKPOINTS_JSON'] = json.dumps({'iso_remix': {'/isolated/history.json': [201]}})

def connect(autocommit=True):
    db = pymysql.connect(unix_socket='/mysql/mysqld.sock', user='root', password='', database='storage_test',
                         charset='utf8mb4', autocommit=autocommit, connect_timeout=5, read_timeout=10,
                         write_timeout=10, client_flag=CLIENT.FOUND_ROWS)
    with db.cursor() as cursor: cursor.execute("SET SESSION time_zone='+00:00'")
    return db

class Cache:
    def ping(self): return True
    def close(self): pass
    def pipeline(self, **kwargs): return self
    def setex(self, *args): return self
    def incr(self, *args): return self
    def expire(self, *args): return self
    def execute(self): return []

common.mysql_connection = connect
common.redis_connection = Cache
runpy.run_path('/opt/storage/sql_gateway.py', run_name='__main__')
