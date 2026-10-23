"""Native MySQL persistence for the existing SQLAlchemy business model.

Model names and foreign-key declarations remain compatible with the application's
Python interface. Physical tables are resolved only from the verified migration.
The private connection file is mounted server-side; credentials are not baked in.
"""
import json
import os
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import QueuePool
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import GenericFunction
from .config import settings


class json_each(GenericFunction):
    name = 'json_each'
    inherit_cache = True


@compiles(json_each, 'mysql')
def mysql_json_each(element, compiler, **kwargs):
    arguments = list(element.clauses)
    if len(arguments) != 1:
        raise ValueError('JSON array expansion requires exactly one expression')
    # The existing queries expand scalar tag/ID arrays. MySQL compares the
    # returned scalar text to tags or integer IDs using their column types.
    return "JSON_TABLE(" + compiler.process(arguments[0], **kwargs) + ", '$[*]' COLUMNS(value VARCHAR(4096) PATH '$' ERROR ON ERROR))"

configuration = json.loads(Path('/run/secrets/pinying-mysql.json').read_text())
connection_url = URL.create('mysql+pymysql', username=configuration['user'], password=configuration['password'],
                            host=configuration['host'], port=configuration['port'], database=configuration['database'])
# The existing frozen settings instance is shared by modules imported before
# database.py. Initialize its storage URL once, before any engine or lifespan.
object.__setattr__(settings, 'database_url', connection_url.render_as_string(hide_password=False))
engine = create_engine(connection_url, pool_pre_ping=True, poolclass=QueuePool,
                       pool_size=min(24, max(4, int(os.getenv('CLOUD_DB_POOL_SIZE','12')))),
                       max_overflow=min(12, max(0, int(os.getenv('CLOUD_DB_POOL_OVERFLOW','6')))),
                       pool_timeout=min(15, max(3, int(os.getenv('CLOUD_DB_POOL_TIMEOUT','8')))), pool_recycle=300,
                       pool_use_lifo=True,
                       connect_args={'charset':'utf8mb4','connect_timeout':10,'read_timeout':120,'write_timeout':120,
                                     'ssl_disabled':not configuration.get('tls'),
                                     'init_command':"SET SESSION time_zone='+00:00'"})


class DatabaseUnavailable(RuntimeError):
    """The existing dataset is unavailable; never seed a replacement dataset."""


@event.listens_for(engine, 'connect')
def verify_existing_instance(dbapi_connection, _record):
    expected = configuration.get('expectedApplicationInstanceId')
    if not expected:
        raise DatabaseUnavailable('database_identity_not_configured')
    with dbapi_connection.cursor() as cursor:
        cursor.execute("SELECT value FROM py_cloud_app_meta WHERE `key`=%s", ('database.instance_id',))
        identity = cursor.fetchone()
        if not identity or identity[0] != expected:
            raise DatabaseUnavailable('database_instance_id_missing_or_mismatched')
        cursor.execute('SELECT @@server_uuid')
        if cursor.fetchone()[0] != configuration.get('expectedMysqlServerUuid'):
            raise DatabaseUnavailable('database_server_identity_changed')


def assert_database_available():
    with engine.connect() as connection:
        connection.execute(text('SELECT 1')).scalar_one()


def validate_database_startup(*, allow_bootstrap=False):
    assert_database_available()
    with engine.connect() as connection:
        columns = connection.execute(text('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name LIKE :prefix'), {'prefix':'py_cloud_%'}).all()
    actual = {}
    for table,column in columns:
        actual.setdefault(table,set()).add(column)
    for spec in schemas.values():
        if not {column['name'] for column in spec['columns']}.issubset(actual.get(spec['mysql'],set())):
            raise DatabaseUnavailable('database_core_columns_missing')


def database_allows_startup_seeds():
    return False


def finish_database_bootstrap():
    assert_database_available()


with engine.connect() as connection:
    schema = connection.execute(text('SELECT schema_json FROM pinying_storage_schemas WHERE scope=:scope'),
                                {'scope':'cloud'}).scalar_one()
    schemas = json.loads(schema) if isinstance(schema, str) else schema

validate_database_startup()


class Base(DeclarativeBase):
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        table = cls.__dict__.get('__table__')
        if table is None:
            return
        name = table.name
        if name not in schemas:
            raise RuntimeError('Business model requires a versioned migration: ' + name)
        known = {column['name'] for column in schemas[name]['columns']}
        if not set(table.columns.keys()).issubset(known):
            raise RuntimeError('Business model columns require a versioned migration: ' + name)
        table.name = schemas[name]['mysql']
        table.fullname = table.name
        # Keep the declaration key used by ForeignKey("assets.id"). SQLAlchemy
        # compiles the resolved target's physical name into the actual SQL.


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
is_sqlite = False


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
