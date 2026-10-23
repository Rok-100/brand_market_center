import os
from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase,sessionmaker
from .config import settings

if os.getenv('LOCAL_DEV_MODE') != '1':raise RuntimeError('Local database requires LOCAL_DEV_MODE=1')
Path('/data').mkdir(parents=True,exist_ok=True)
url=os.getenv('DATABASE_URL','sqlite:////data/cloud.sqlite')
if not url.startswith('sqlite:'):raise RuntimeError('Local edition only accepts a local SQLite database')
object.__setattr__(settings,'database_url',url)
engine=create_engine(url,connect_args={'check_same_thread':False,'timeout':30})
@event.listens_for(engine,'connect')
def configure(connection,_):
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('PRAGMA busy_timeout=30000')
    connection.execute('PRAGMA foreign_keys=ON')

class Base(DeclarativeBase):
    def __init_subclass__(cls,**kwargs):
        super().__init_subclass__(**kwargs)
        table=cls.__dict__.get('__table__')
        if table is not None:
            table.name='py_cloud_'+table.name
            table.fullname=table.name

SessionLocal=sessionmaker(bind=engine,autoflush=False,autocommit=False)
is_sqlite=True
def get_db():
    with SessionLocal() as db:yield db
def assert_database_available():
    with engine.connect() as c:c.execute(text('SELECT 1'))
def validate_database_startup(**kwargs):assert_database_available()
def database_allows_startup_seeds():return True
def finish_database_bootstrap():assert_database_available()
