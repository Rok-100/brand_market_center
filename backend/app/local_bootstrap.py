import asyncio
from contextlib import asynccontextmanager
from sqlalchemy import select,text
from .database import Base,SessionLocal,engine
from .local_identity import PROFILES,user_for

def initialize():
    from . import main,company_audit
    from .models import AppMeta,OaAccessGrant,ModuleAccessGrant,AdminGrant,ReviewRoleAssignment,ReviewWorkflowConfig
    from .remix_business import TABLES
    from .local_tasks import LocalJob
    Base.metadata.create_all(engine)
    # Clone the real business schema, including PKs/defaults/FKs and indexes,
    # into the same separate remix namespace used by the production middleware.
    with engine.begin() as c:
        for original,target in TABLES.items():
            ddl=c.execute(text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:name"),{'name':original}).scalar()
            exists=c.execute(text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name"),{'name':target}).scalar()
            if ddl and not exists:
                for old,new in TABLES.items():ddl=ddl.replace(old,new)
                c.execute(text(ddl))
                indexes=c.execute(text("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=:name AND sql IS NOT NULL"),{'name':original}).all()
                for name,sql in indexes:
                    sql=sql.replace(name,name+'_remix').replace(original,target)
                    c.execute(text(sql))
    with SessionLocal() as db:
        if db.get(AppMeta,'local.schema.v1'):return
        for role,p in PROFILES.items():
            u=user_for(role);key='number:'+p['number']
            db.add(OaAccessGrant(identifier=key,identifier_type='number',user_number=p['number'],real_name=p['name'],department='品牌营销部',center='AI营销中心',active=role!='denied',source='local-seed'))
            db.add(ModuleAccessGrant(identifier=key,identifier_type='number',user_number=p['number'],real_name=p['name'],department='品牌营销部',center='AI营销中心',access_mode='all' if role!='denied' else 'selected',modules=[]))
            if role=='admin':db.add(AdminGrant(identifier=key,identifier_type='number',user_number=p['number'],real_name=p['name'],role='permission_manager',active=True,department='品牌营销部',center='AI营销中心'))
            if role in {'manager','admin'}:
                for code in ['team_lead','supervisor']:
                    db.add(ReviewRoleAssignment(role_code=code,identifier=key,user_number=p['number'],user_name=p['name'],department='品牌营销部',center='AI营销中心',group_name='本地创作组',source='local-seed',active=True))
        db.add(ReviewWorkflowConfig(id=1,enabled=True,naming_enabled=False,ai_redline_enabled=False,required_roles=['supervisor']))
        db.add(AppMeta(key='local.schema.v1',value='initialized'))
        db.commit()

@asynccontextmanager
async def local_lifespan():
    initialize()
    from .local_tasks import recover_jobs,worker
    recover_jobs()
    task=asyncio.create_task(worker())
    try:yield
    finally:
        task.cancel()
        await asyncio.gather(task,return_exceptions=True)
