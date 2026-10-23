"""Local media orchestration and external-delivery adapter.

FFmpeg, storage and database writes execute for real. Only the external platform
receipt is simulated; original material review gates remain mandatory.
"""
import asyncio,hashlib,json,os,subprocess
from datetime import datetime
from pathlib import Path
from uuid import uuid4
import boto3
from botocore.config import Config
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import String,Integer,Text,JSON,DateTime,select
from sqlalchemy.orm import Mapped,mapped_column
from .auth import require_user
from .database import Base,SessionLocal
from .models import Asset,WorkstationReturn
from .remix_library import RemixAsset,BUCKET
from .remix_business import remix_scope

class LocalJob(Base):
    __tablename__='local_jobs'
    id:Mapped[str]=mapped_column(String(36),primary_key=True)
    idempotency_key:Mapped[str]=mapped_column(String(120),unique=True)
    kind:Mapped[str]=mapped_column(String(20))
    owner:Mapped[str]=mapped_column(String(80))
    status:Mapped[str]=mapped_column(String(20),default='pending')
    payload:Mapped[dict]=mapped_column(JSON)
    result:Mapped[dict]=mapped_column(JSON,default=dict)
    error:Mapped[str]=mapped_column(Text,default='')
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
    updated_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

def storage():
    return boto3.client('s3',endpoint_url=os.environ['REMIX_OSS_ENDPOINT'],aws_access_key_id='local-simulation',aws_secret_access_key='local-simulation',region_name='auto',config=Config(signature_version='s3v4',s3={'addressing_style':'path'},request_checksum_calculation='when_required',response_checksum_validation='when_required'))
def output(job):
    return {'id':job.id,'kind':job.kind,'owner':job.owner,'status':job.status,'payload':job.payload,'result':job.result,'error':job.error,'created_at':job.created_at.isoformat(),'updated_at':job.updated_at.isoformat()}
def require_access(user=Depends(require_user)):
    from .main import require_module_access
    require_module_access(user,'cloud-manager')
    return user
router=APIRouter(prefix='/api/local',dependencies=[Depends(require_access)])
class RenderInput(BaseModel):
    source_asset_id:int=Field(gt=0)
    seconds:float=Field(default=3,gt=0,le=30)
    idempotency_key:str=Field(min_length=8,max_length=120)
class DeliveryInput(BaseModel):
    asset_id:int=Field(gt=0)
    library:str=Field(default='remix',pattern='^(source|remix)$')
    outcome:str=Field(default='success',pattern='^(success|failure|timeout)$')
    idempotency_key:str=Field(min_length=8,max_length=120)
def create_job(kind,payload,user):
    from .main import is_permission_manager
    with SessionLocal() as db:
        key=user['number']+':'+payload['idempotency_key']
        old=db.scalar(select(LocalJob).where(LocalJob.idempotency_key==key))
        if old:
            if old.kind!=kind or old.payload!=payload:raise HTTPException(409,'幂等编号已用于不同内容')
            return output(old)
        row=LocalJob(id=str(uuid4()),idempotency_key=key,kind=kind,owner=user['number'],payload=payload)
        db.add(row);db.commit();db.refresh(row);return output(row)
@router.get('/jobs')
def jobs(user=Depends(require_access)):
    from .main import is_permission_manager
    with SessionLocal() as db:
        q=select(LocalJob).order_by(LocalJob.created_at.desc()).limit(100)
        if not is_permission_manager(user):q=q.where(LocalJob.owner==user['number'])
        return {'items':[output(j) for j in db.scalars(q)],'external_delivery':'simulated','media_processing':'ffmpeg'}
@router.post('/renders')
def render(body:RenderInput,user=Depends(require_access)):
    with SessionLocal() as db:
        asset=db.get(Asset,body.source_asset_id)
        if not asset or asset.deleted_at or asset.purged_at:raise HTTPException(404,'原片不存在')
        if asset.media_type!='video':raise HTTPException(422,'请选择视频原片')
    return create_job('render',body.model_dump(),user)
@router.post('/deliveries')
def deliver(body:DeliveryInput,user=Depends(require_access)):
    from .main import _require_assets_review_approved
    from contextlib import nullcontext
    with (remix_scope() if body.library=='remix' else nullcontext()):
        with SessionLocal() as db:
            asset=db.get(Asset,body.asset_id)
            if not asset or asset.deleted_at or asset.purged_at:raise HTTPException(404,'素材不存在')
            _require_assets_review_approved(db,[asset],'local-mock')
    return create_job('delivery',body.model_dump(),user)

def recover_jobs():
    with SessionLocal() as db:
        for job in db.scalars(select(LocalJob).where(LocalJob.status=='running')):
            job.status='pending';job.error='服务重启，已恢复持久化任务'
        db.commit()

def process(job_id):
    with SessionLocal() as db:
        job=db.get(LocalJob,job_id)
        if not job or job.status!='pending':return
        job.status='running';job.updated_at=datetime.utcnow();db.commit()
        try:
            if job.kind=='delivery':
                # Recheck review state at execution time, as the queue may wait.
                from .main import _require_assets_review_approved
                from contextlib import nullcontext
                with (remix_scope() if job.payload['library']=='remix' else nullcontext()):
                    asset=db.get(Asset,job.payload['asset_id'])
                    if not asset or asset.deleted_at or asset.purged_at:raise ValueError('素材已失效')
                    _require_assets_review_approved(db,[asset],'local-mock')
                outcome=job.payload['outcome']
                if outcome!='success':raise ValueError('模拟外部平台'+('超时' if outcome=='timeout' else '拒绝'))
                job.result={'simulated':True,'receipt_id':'local-receipt-'+job.id,'asset_id':job.payload['asset_id'],'notification':'本地投递回执已保存，未调用真实平台'}
            else:
                asset=db.get(Asset,job.payload['source_asset_id'])
                if not asset or asset.deleted_at or asset.purged_at:raise ValueError('原片已失效')
                client=storage();work=Path('/data/jobs')/job.id;work.mkdir(parents=True,exist_ok=True)
                incoming=work/'input.mp4';outgoing=work/'output.mp4'
                with incoming.open('wb') as f:client.download_fileobj(BUCKET,asset.object_key,f)
                cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(incoming),'-t',str(job.payload['seconds']),'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(outgoing)]
                p=subprocess.run(cmd,capture_output=True,timeout=120)
                if p.returncode:raise ValueError('视频处理失败：'+p.stderr.decode(errors='replace')[-500:])
                content=outgoing.read_bytes();digest=hashlib.sha256(content).hexdigest();key='wis/remix/local/'+job.id+'/original.mp4'
                client.put_object(Bucket=BUCKET,Key=key,Body=content,ContentType='video/mp4')
                result=db.scalar(select(RemixAsset).where(RemixAsset.object_key==key))
                if not result:
                    result=RemixAsset(object_key=key,filename='本地混剪-'+job.id[:8]+'.mp4',media_type='video',size=len(content),category=asset.category,library_type='remix',ingest_source='oa_upload',uploaded_by_number=job.owner,uploaded_by_name=job.owner,tags=['本地FFmpeg'],asset_scope='marketing_video',asset_subtype='其他混剪成片')
                    db.add(result);db.flush()
                with remix_scope():
                    record=db.get(WorkstationReturn,'local:'+job.id)
                    if not record:
                        db.add(WorkstationReturn(idempotency_key='local:'+job.id,object_key=key,asset_id=result.id,filename=result.filename,file_size=len(content),sha256=digest,status='completed',completed_at=datetime.utcnow(),provenance={'source_asset_id':asset.id,'render_id':job.id,'local_ffmpeg':True}))
                job.result={'asset_id':result.id,'asset_library':'remix','sha256':digest,'bytes':len(content),'simulated':False,'media_processing':'ffmpeg'}
            job.status='completed';job.error='';job.updated_at=datetime.utcnow();db.commit()
        except Exception as error:
            db.rollback();job=db.get(LocalJob,job_id);job.status='failed';job.error=str(getattr(error,'detail',error))[:1000];job.updated_at=datetime.utcnow();db.commit()

async def worker():
    while True:
        with SessionLocal() as db:job_id=db.scalar(select(LocalJob.id).where(LocalJob.status=='pending').order_by(LocalJob.created_at).limit(1))
        if job_id:await asyncio.to_thread(process,job_id)
        await asyncio.sleep(1)
