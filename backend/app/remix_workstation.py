"""Explicit workstation bridge for the migrated material library.

Source IDs belong to py_cloud_assets. Return IDs and all return business
records belong to py_cloud_remix_*; never look up a same-number legacy asset.
The legacy workstation interface remains available to other integrations.
"""
import json
import os
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from .remix_business import remix_scope
from .remix_library import BUCKET, CATEGORIES
from .oss_service import media_type_for, normalize_upload_filename

_return_storage = ContextVar("remix_workstation_return_storage", default=False)


def return_storage_active():
    return _return_storage.get()


def historical_namespace(suffix, payload=None):
    """Existing idempotency records keep their original physical namespace."""
    from urllib.parse import unquote
    from sqlalchemy import text
    from .database import SessionLocal
    payload = payload if isinstance(payload, dict) else {}
    kind, key = None, None
    if suffix.startswith("returns/"):
        kind = "workstation_returns"
        tail = suffix[len("returns/"):]
        key = payload.get("idempotency_key") if tail in ("presign", "complete") else unquote(tail.split("/")[0])
    elif suffix.startswith("qianchuan/deliveries/"):
        kind = "qianchuan_deliveries"
        key = unquote(suffix[len("qianchuan/deliveries/"):].split("/")[0])
    elif suffix == "qianchuan/push":
        kind, key = "qianchuan_deliveries", payload.get("idempotency_key")
    if not kind or not isinstance(key, str) or not key:
        return "remix"
    with SessionLocal() as db:
        found = []
        for namespace, prefix in (("legacy", "py_cloud_"), ("remix", "py_cloud_remix_")):
            if db.execute(text("SELECT idempotency_key FROM " + prefix + kind + " WHERE idempotency_key=:key LIMIT 1"), {"key":key}).first():
                found.append(namespace)
        if len(found)>1:
            raise ValueError("幂等键同时存在于两个素材库，需核对原记录")
        if found:
            return found[0]
        if suffix == "qianchuan/push":
            for namespace,prefix in (("legacy","py_cloud_"),("remix","py_cloud_remix_")):
                rows=db.execute(text("SELECT provenance FROM "+prefix+"workstation_returns WHERE asset_id=:id AND status='completed'"),{"id":payload.get("asset_id",0)}).all()
                for row in rows:
                    provenance=json.loads(row[0]) if isinstance(row[0],str) else row[0] or {}
                    expected="wis-remix:"+str(provenance.get("render_id",""))+":"+str(provenance.get("variant_id",""))+":"
                    if key.startswith(expected):
                        found.append(namespace)
            if len(set(found))>1:
                raise ValueError("投放来源同时匹配两个素材库，需核对原记录")
            if found:
                return found[0]
    return "remix"


class ReturnStorage:
    def __init__(self, previous, settings):
        self.previous = previous
        self.client = boto3.client("s3", endpoint_url=os.environ.get("REMIX_OSS_ENDPOINT", "https://oss.fandow.com"),
            aws_access_key_id=os.environ.get("REMIX_OSS_ACCESS_KEY") or settings.access_key,
            aws_secret_access_key=os.environ.get("REMIX_OSS_SECRET_KEY") or settings.secret_key,
            region_name="auto", config=Config(signature_version="s3v4", s3={"addressing_style":"path"},
                request_checksum_calculation="when_required", response_checksum_validation="when_required"))

    def __getattr__(self, name):
        return getattr(self.previous, name)

    def url_for(self, key, download=False, expires_in=3600):
        if not key.startswith("wis/remix/"):
            raise ValueError("混剪回传路径不属于新素材库")
        return self.client.generate_presigned_url("get_object", Params={"Bucket":BUCKET,"Key":key}, ExpiresIn=expires_in)

    def presign_upload(self, key, content_type):
        if not key.startswith("wis/remix/") or any(part in ("", ".", "..") for part in key.split("/")):
            raise ValueError("混剪回传路径不属于新素材库")
        return {"object_key":key, "upload_url":self.client.generate_presigned_url("put_object",
            Params={"Bucket":BUCKET,"Key":key,"ContentType":content_type}, ExpiresIn=3600),
            "public_url":self.url_for(key), "headers":{"Content-Type":content_type}, "expires_in":3600}

    def create_upload(self, filename, content_type, uploader, asset_scope="marketing_video", category="待分类"):
        if asset_scope != "marketing_video" or media_type_for(filename) != "video":
            raise ValueError("混剪工作台仅允许回传视频")
        code = CATEGORIES.get(category)
        if not code:
            raise ValueError("请选择新素材库中的产品分类")
        suffix = Path(normalize_upload_filename(filename)).suffix.lower()
        key = f"wis/remix/{code}/{datetime.utcnow():%Y/%m}/{uuid4()}/original{suffix}"
        return self.presign_upload(key, content_type)

    def head_asset(self, key):
        if not key.startswith("wis/remix/"):
            raise ValueError("混剪回传路径不属于新素材库")
        try:
            item = self.client.head_object(Bucket=BUCKET, Key=key)
        except ClientError as error:
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return None
            raise
        return {"object_key":key,"filename":Path(key).name,"media_type":media_type_for(key),
            "size":int(item["ContentLength"]),"etag":str(item.get("ETag", "")).strip('"'),
            "modified_at":item["LastModified"].replace(tzinfo=None)}


class ScopedStorage:
    def __init__(self, legacy, migrated):
        self.legacy, self.migrated = legacy, migrated

    def __getattr__(self, name):
        return getattr(self.migrated if return_storage_active() else self.legacy, name)


class WorkstationBridge:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        prefix = "/api/remix-workstation/"
        if scope["type"] != "http" or not scope["path"].startswith(prefix):
            return await self.app(scope, receive, send)
        from starlette.responses import JSONResponse
        suffix = scope["path"][len(prefix):]
        if suffix == "assets" or suffix.startswith("assets/"):
            path = "/api/workstation/migrated-assets" + suffix[len("assets"):]
            return await self.app(dict(scope,path=path,raw_path=path.encode()), receive, send)
        allowed = suffix.startswith(("returns/", "qianchuan/", "private-assets", "access/"))
        if not allowed:
            return await JSONResponse({"detail":"不支持的混剪工作台接口"}, status_code=404)(scope,receive,send)
        path = "/api/workstation/" + suffix
        mapped = dict(scope, path=path, raw_path=path.encode())
        migrated = suffix.startswith(("returns/", "qianchuan/"))
        if not migrated:
            return await self.app(mapped, receive, send)
        # Only these small JSON requests are buffered for identity routing.
        payload = None
        if suffix in ("returns/presign", "returns/complete", "qianchuan/push") and scope["method"] == "POST":
            messages, body = [], bytearray()
            while True:
                message = await receive()
                messages.append(message)
                if message["type"] != "http.request":
                    return
                body.extend(message.get("body", b""))
                if len(body) > 1024 * 1024:
                    return await JSONResponse({"detail":"请求过大"}, status_code=413)(scope,receive,send)
                if not message.get("more_body"):
                    break
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                payload = None
            if suffix == "returns/presign" and isinstance(payload, dict) and payload.get("workstation_type", "remix") != "remix":
                return await JSONResponse({"detail":"此接口仅用于混剪回传"}, status_code=422)(scope,receive,send)
            original_receive = receive
            async def replay():
                return messages.pop(0) if messages else await original_receive()
            receive = replay
        # Authenticate before looking up persistent record identities. The
        # mapped handlers retain their own existing service authentication too.
        from .workstation_auth import require_workstation
        from starlette.requests import Request
        from fastapi import HTTPException
        from starlette.concurrency import run_in_threadpool
        try:
            require_workstation(Request(mapped))
            namespace = await run_in_threadpool(historical_namespace, suffix, payload)
        except HTTPException as error:
            return await JSONResponse({"detail":error.detail},status_code=error.status_code)(scope,receive,send)
        except ValueError as error:
            return await JSONResponse({"detail":str(error)},status_code=409)(scope,receive,send)
        if namespace == "legacy":
            return await self.app(mapped, receive, send)
        token = _return_storage.set(True)
        try:
            with remix_scope():
                await self.app(mapped, receive, send)
        finally:
            _return_storage.reset(token)


def install(app):
    from . import main
    if isinstance(main.oss_service, ScopedStorage):
        return
    main.oss_service = ScopedStorage(main.oss_service, ReturnStorage(main.oss_service, main.settings))
    app.add_middleware(WorkstationBridge)
    from fastapi import APIRouter, Depends, HTTPException, Query
    from sqlalchemy import select, literal, union_all, func, or_, MetaData
    from contextlib import nullcontext
    from .database import SessionLocal
    from .models import Asset
    from .remix_library import RemixAsset
    router = APIRouter(prefix="/api/workstation", dependencies=[Depends(main.require_workstation)])

    @router.get("/migrated-assets")
    def assets(q: str="", category: str="", folder_name: str="", library_type: str="source",
               effective_only: bool=False, page: int=Query(1,ge=1), page_size: int=Query(24,ge=1,le=100)):
        if library_type not in ("source", "remix", "all"):
            raise HTTPException(422,"素材库无效")
        selections=[]
        for kind, table in (("source",Asset.__table__),("remix",RemixAsset.__table__)):
            if library_type not in (kind,"all"):
                continue
            c=table.c
            filters=[c.deleted_at.is_(None),c.purged_at.is_(None),c.asset_scope=="marketing_video",c.media_type=="video",c.library_type==kind]
            if q.strip():
                filters.append(or_(c.filename.contains(q.strip()),c.category.contains(q.strip()),c.folder_name.contains(q.strip()),c.asset_subtype.contains(q.strip())))
            if category.strip():
                filters.append(c.category==main.canonical_product_category(category))
            if folder_name.strip():
                filters.append(c.folder_name==main.normalize_asset_folder_name(folder_name))
            if effective_only:
                mark = main.AssetEffectiveMark.__table__ if kind=="source" else main.AssetEffectiveMark.__table__.to_metadata(MetaData(),name="py_cloud_remix_asset_effective_marks")
                filters.append(c.id.in_(select(mark.c.asset_id)))
            selections.append(select(c.id,c.modified_at,literal(kind).label("asset_library")).where(*filters))
        combined=union_all(*selections).subquery()
        with SessionLocal() as db:
            total=db.scalar(select(func.count()).select_from(combined))
            rows=db.execute(select(combined).order_by(combined.c.modified_at.desc(),combined.c.id.desc(),combined.c.asset_library)
                .offset((page-1)*page_size).limit(page_size)).all()
        items=[]
        for row in rows:
            with remix_scope() if row.asset_library=="remix" else nullcontext():
                with SessionLocal() as db:
                    asset=db.get(Asset,row.id)
                    item=main._workstation_asset_payload(asset,db.get(main.AssetEffectiveMark,row.id))
                    item["asset_library"]=row.asset_library
                    items.append(item)
        return {"items":items,"total":total,"page":page,"page_size":page_size,"library_type":library_type,"source":"migrated_material_libraries"}

    @router.get("/migrated-assets/{asset_id}")
    def asset_detail(asset_id:int,asset_library:str="source"):
        if asset_library not in ("source","remix"):
            raise HTTPException(422,"素材库无效")
        with remix_scope() if asset_library=="remix" else nullcontext():
            with SessionLocal() as db:
                item=main.workstation_asset_detail(asset_id,db,{"service":True})
                if item["library_type"]!=asset_library:
                    raise HTTPException(404,"素材不存在")
                item["asset_library"]=asset_library
                return item
    app.router.routes[0:0]=router.routes
