"""Private MySQL/Redis connections and stable SQLite-compatible value encoding."""
import base64
import datetime
import decimal
import hashlib
import json
from pathlib import Path
import re

import pymysql
from pymysql.constants import CLIENT
import redis

_redis_pool = None


def config():
    return json.loads(Path('/run/secrets/data-connection.json').read_text())


def mysql_connection(autocommit=True):
    c = config()['mysql']
    db = pymysql.connect(host=c['host'], port=c['port'], user=c['user'], password=c['password'],
                         database=c['database'], charset='utf8mb4', autocommit=autocommit,
                         connect_timeout=10, read_timeout=120, write_timeout=120,
                         ssl_disabled=not c.get('tls'), client_flag=CLIENT.FOUND_ROWS)
    with db.cursor() as cursor:
        cursor.execute("SET SESSION time_zone='+00:00'")
    return db


def redis_connection():
    global _redis_pool
    c = config()['redis']
    if _redis_pool is None:
        _redis_pool = redis.ConnectionPool(host=c['host'], port=c['port'], db=c['db'], password=c['password'],
                                          socket_connect_timeout=2, socket_timeout=2, max_connections=64,
                                          decode_responses=True)
    return redis.Redis(connection_pool=_redis_pool)


def quote_identifier(value):
    return '`' + value.replace('`', '``') + '`'


def table_name(scope, original):
    assert re.fullmatch(r'[a-z0-9_]+', scope)
    clean = re.sub(r'[^a-zA-Z0-9_]', '_', original)
    name = 'py_' + scope + '_' + clean
    return name if len(name) <= 64 else name[:55] + '_' + hashlib.sha256(name.encode()).hexdigest()[:8]


def wire(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {'__pinying_bytes__': base64.b64encode(bytes(value)).decode()}
    if isinstance(value, datetime.datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S.%f')
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [wire(item) for item in value]
    return value


def unwire(value):
    if isinstance(value, dict) and set(value) == {'__pinying_bytes__'}:
        return base64.b64decode(value['__pinying_bytes__'])
    if isinstance(value, list):
        return [unwire(item) for item in value]
    if isinstance(value, dict):
        return {key: unwire(item) for key, item in value.items()}
    return value


def canonical(value):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, (tuple, list)):
        return [canonical(item) for item in value]
    return wire(value)
