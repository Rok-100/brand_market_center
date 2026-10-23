"""Standalone local edition; business API/UI come from the recorded source."""
import os
if os.getenv('LOCAL_DEV_MODE')!='1':raise RuntimeError('Use this entry only with LOCAL_DEV_MODE=1')
from fastapi import Depends,HTTPException,Response
from .main import app
from .auth import require_user,SESSION_COOKIE
from .local_identity import PROFILES,user_for
from .remix_business import RemixBusinessMiddleware
from .remix_library import build_router
from .remix_hall import build_hall_router
from .local_tasks import router

app.add_middleware(RemixBusinessMiddleware)
remix=build_router('remix');source=build_router('source')
# Same real upload/catalog/review routes as the migrated material release.
app.router.routes[0:0]=[*router.routes,*remix.routes,*source.routes,*build_hall_router(remix.serialize_asset,source.serialize_asset).routes]

@app.get('/api/local/health')
def health():
    from .database import assert_database_available
    assert_database_available()
    return {'ok':True,'mode':'standalone-local','database':'sqlite','external_services':'simulated'}

@app.get('/api/local/session')
def session(user=Depends(require_user)):
    return {'user':user,'local':True}

@app.post('/api/local/login/{role}')
def login(role:str,response:Response):
    if role not in PROFILES:raise HTTPException(404,'Unknown local role')
    response.set_cookie(SESSION_COOKIE,'local-dev-'+role,httponly=True,samesite='lax',path='/local-dev/')
    return {'user':user_for(role),'local':True}

# These routes must precede the existing frontend static mount.
routes=app.router.routes
routes[:]=[r for r in routes if getattr(r,'path','')!='']
from pathlib import Path
from fastapi.staticfiles import StaticFiles
frontend=Path(__file__).resolve().parents[2]/'frontend/dist'
if frontend.exists():app.mount('/',StaticFiles(directory=frontend,html=True),name='frontend-local')
