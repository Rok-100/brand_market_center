"""Independent remix upload API. Legacy assets and upload sessions stay intact.

The namespace is part of the asset identity: IDs here are never passed to the
legacy asset/favorite/review endpoints. Provision the table with the migration
before enabling this router. This module never creates schema at startup.
"""
import hashlib
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import MetaData, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, registry
from starlette.concurrency import run_in_threadpool

from .auth import require_user
from .config import settings
from .database import get_db
from .models import Asset, UploadSession
from .schemas import AssetOut, AssetUpdate
from .oss_service import ALLOWED_EXTENSIONS, VIDEO_EXTENSIONS, normalize_upload_filename

logger = logging.getLogger(__name__)

PREFIX = "wis/remix/"
BUCKET = settings.bucket if os.getenv("LOCAL_SIMULATION") == "1" else "marketing-video-dashboard"
PART_BYTES = 32 * 1024 * 1024
CATEGORIES = {
    "其他 WIS 素材": "other-wis", "黑晶面膜": "black-crystal-mask",
    "肌活蛋白喷雾": "protein-spray", "晶润眼膜": "eye-mask",
    "隐形水润面膜": "hydrating-mask", "深海次抛": "deep-sea-ampoule",
    "燕窝面膜": "birds-nest-mask", "美白针": "whitening-ampoule",
    "通用": "general", "黄金面膜": "gold-mask", "凝颜洁面": "ningyan-cleanser",
    "极润洁面": "jrun-cleanser", "颈膜": "neck-mask",
    "WIS隐形水润面膜": "wis-hydrating-mask",
}

# Copy the ORM column types/defaults, while using a separate mapper/identity map.
# The physical MySQL table is cloned by the explicit migration, including its
# generated uniqueness column and actual indexes.
_registry = registry()
_table = Asset.__table__.to_metadata(MetaData(), name="py_cloud_remix_assets")


class RemixAsset:
    pass


_registry.map_imperatively(RemixAsset, _table)


class UploadCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="video/mp4", max_length=150)
    size: int = Field(gt=0, le=5 * 1024 * 1024 * 1024)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    category: str = Field(min_length=1, max_length=100)
    asset_scope: str = Field(default="marketing_video", pattern="^(marketing_video|reference_video)$")


class PartReceipt(BaseModel):
    part_number: int = Field(ge=1)
    etag: str = Field(min_length=1, max_length=255)


class Complete(BaseModel):
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    parts: list[PartReceipt] = Field(min_length=1, max_length=10000)


class Register(BaseModel):
    session_id: str = Field(min_length=1, max_length=36)
    category: str | None = None
    content_type: str = Field(default="其他", max_length=100)
    asset_subtype: str = Field(default="其他混剪成片", max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=30)
    reference_url: str = Field(default="", max_length=2048)
    reference_video_key: str = Field(default="", max_length=1024)
    reference_video_name: str = Field(default="", max_length=512)
    folder_name: str = Field(default="", max_length=160)
    material_description: str = Field(default="", max_length=10000)
    performance_screenshots: list[dict[str, str]] = Field(default_factory=list, max_length=9)


def owner(user):
    value = str(user.get("number") or user.get("userId") or user.get("id") or "").strip()
    if not value:
        raise HTTPException(403, "OA 账号缺少稳定工号")
    return value[:80]


def missing(error):
    return isinstance(error, ClientError) and str(error.response.get("Error", {}).get("Code")) in {
        "404", "NoSuchKey", "NotFound", "NoSuchUpload",
    }


def build_router(kind="remix"):
    if kind not in {"source", "remix"}:
        raise ValueError("Unknown material library")
    object_prefix = f"wis/{kind}/"
    session_scope = "remix_output" if kind == "remix" else "source_upload"
    TargetAsset = RemixAsset if kind == "remix" else Asset

    def invalidate_catalog():
        from .main import _invalidate_catalog_cache
        _invalidate_catalog_cache()

    from .main import require_module_access

    def require_remix_access(user=Depends(require_user)):
        require_module_access(user, "cloud-manager")
        return user

    router = APIRouter(prefix=f"/api/{kind}-library", dependencies=[Depends(require_remix_access)])
    local = os.getenv("LOCAL_SIMULATION") == "1"
    endpoint = os.getenv("REMIX_OSS_ENDPOINT", settings.endpoint if local else "https://oss.fandow.com").rstrip("/")
    if local and endpoint not in {"http://remix-object-store:9000", "http://object-store:9000"}:
        raise RuntimeError("Local remix validation must use its isolated object fixture")
    # Do not use the legacy RoutingClient: this bucket has no legacy fallback.
    client = boto3.client(
        "s3", endpoint_url=endpoint,
        aws_access_key_id=os.getenv("REMIX_OSS_ACCESS_KEY") or settings.access_key,
        aws_secret_access_key=os.getenv("REMIX_OSS_SECRET_KEY") or settings.secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                      request_checksum_calculation="when_required",
                      response_checksum_validation="when_required",
                      retries={"mode": "standard", "max_attempts": 3}),
    )

    def head(key):
        try:
            return client.head_object(Bucket=BUCKET, Key=key)
        except ClientError as error:
            if missing(error):
                return None
            raise HTTPException(503, "新素材存储暂时无法核验，已保留上传进度") from error

    def get_session(db, sid, user, *, lock=False):
        stmt = select(UploadSession).where(
            UploadSession.id == sid, UploadSession.owner_number == owner(user),
            UploadSession.asset_scope.in_([session_scope, "source_reference"] if kind == "source" else [session_scope]),
            UploadSession.object_key.startswith(object_prefix),
        )
        if lock:
            stmt = stmt.with_for_update()
        item = db.scalar(stmt)
        if not item:
            raise HTTPException(404, "混剪上传会话不存在")
        return item

    def remote_parts(item):
        rows = []
        try:
            for page in client.get_paginator("list_parts").paginate(
                Bucket=BUCKET, Key=item.object_key, UploadId=item.multipart_upload_id,
            ):
                rows.extend({"part_number": int(p["PartNumber"]), "etag": p["ETag"],
                             "size": int(p["Size"])} for p in page.get("Parts", []))
        except ClientError as error:
            if missing(error):
                raise HTTPException(409, "原分片会话已不存在，请先核对完整文件") from error
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            code = str(error.response.get("Error", {}).get("Code", ""))
            if status in {403, 429, 501} or code in {"AccessDenied", "NotImplemented", "SlowDown", "TooManyRequests"}:
                # As in the legacy uploader, ListParts is optional. OSS still
                # verifies each supplied ETag at merge; HEAD verifies final size.
                logger.warning("Material part inventory unavailable session=%s code=%s", item.id, code)
                return None
            raise HTTPException(503, "分片暂时无法核验，已保留原上传进度") from error
        return sorted(rows, key=lambda row: row["part_number"])

    def session_out(item, parts=None):
        return {"session_id": item.id, "object_key": item.object_key,
                "filename": item.filename, "category": item.category,
                "file_size": item.file_size, "part_size": item.part_size,
                "total_parts": (item.file_size + item.part_size - 1) // item.part_size,
                "status": item.status, "uploaded_parts": parts or [],
                "bucket": BUCKET, "library_type": kind,
                "expires_at": item.expires_at.isoformat() + "Z", "public_url": ""}

    def reconcile(db, item):
        if item.status not in {"active", "completed"}:
            raise HTTPException(409, "该上传会话已取消或停用")
        obj = head(item.object_key)
        if obj:
            if obj["ContentLength"] != item.file_size:
                raise HTTPException(409, "完整文件大小与上传会话不一致")
            if item.status != "completed":
                item.status = "completed"
                item.completed_at = item.updated_at = datetime.utcnow()
                db.commit()
            return obj
        if item.status == "completed":
            raise HTTPException(409, "原完成文件未找到，已保留会话，请核对存储")
        return None

    def asset_out(item, request, favorite_info=None, review_info=None):
        from .main import can_manage_asset, can_delete_asset
        prefix = request.headers.get("x-forwarded-prefix", "").rstrip("/")
        if prefix and (not prefix.startswith("/") or ".." in prefix):
            raise HTTPException(400, "入口路径无效")
        url = f"{prefix}/api/{kind}-library/assets/{item.id}/content"
        user = getattr(request.state, "user", {})
        values = {column.key: getattr(item, column.key) for column in _table.columns}
        values.update(preview_url=url, download_url=url + "?download=true",
                      can_manage=can_manage_asset(user, item), can_delete=can_delete_asset(user, item))
        if kind in {"source", "remix"}:
            if favorite_info is None:
                from .main import favorite_asset_ids, favorite_counts_for_assets
                from .database import SessionLocal
                from contextlib import nullcontext
                from .remix_business import remix_scope
                with (remix_scope() if kind == "remix" else nullcontext()), SessionLocal() as personal:
                    favorite_info = {"favorite": item.id in favorite_asset_ids(personal, user, [item.id]),
                                     "favorite_count": favorite_counts_for_assets(personal, [item.id]).get(item.id, 0)}
            values.update(favorite_info)
        data = AssetOut(**values).model_dump()
        if kind == "remix":
            from . import main
            from .database import SessionLocal
            from .remix_business import remix_scope
            if review_info is None:
                with remix_scope(), SessionLocal() as business:
                    review_info = main._review_latest_summaries(business, [item.id]).get(item.id)
            enriched = main.to_asset_out(item, values.get("favorite", False), values.get("favorite_count", 0),
                    can_manage=values["can_manage"], can_delete=values["can_delete"],
                    review_summary=review_info).model_dump()
            enriched.update({k:data[k] for k in ["preview_url", "download_url"]})
            data = enriched
        if item.reference_video_key:
            data["reference_video_url"] = f"{prefix}/api/{kind}-library/assets/{item.id}/reference"
        data["performance_screenshots"] = [{**entry, "url": f"{prefix}/api/{kind}-library/assets/{item.id}/screenshots/{index}"}
                                             for index, entry in enumerate(item.performance_screenshots or [])]
        return {**data, "asset_library": kind, "bucket": BUCKET}

    @router.get("/categories")
    def categories(db: Session = Depends(get_db)):
        counts = dict(db.execute(select(TargetAsset.category, func.count()).where(
            TargetAsset.deleted_at.is_(None), TargetAsset.purged_at.is_(None),
        ).group_by(TargetAsset.category)).all())
        return {"items": [{"name": name, "code": code, "count": counts.get(name, 0)}
                          for name, code in CATEGORIES.items()], "bucket": BUCKET, "prefix": object_prefix}

    def find_session(db, payload, user):
        return db.scalar(select(UploadSession).where(
            UploadSession.owner_number == owner(user),
            UploadSession.asset_scope == ("source_reference" if kind == "source" and payload.asset_scope == "reference_video" else session_scope),
            UploadSession.sha256 == payload.sha256.lower(),
            UploadSession.file_size == payload.size,
            UploadSession.category == payload.category,
            UploadSession.object_key.startswith(object_prefix),
            UploadSession.status.in_({"active", "completed"}),
        ).order_by(UploadSession.created_at.desc()).limit(1))

    @router.post("/uploads/lookup")
    def lookup(payload: UploadCreate, db: Session = Depends(get_db), user=Depends(require_user)):
        item = find_session(db, payload, user)
        if not item:
            return {"session": None}
        obj = reconcile(db, item)
        return {"session": session_out(item, [] if obj else remote_parts(item))}

    @router.post("/uploads/sessions")
    def create(payload: UploadCreate, db: Session = Depends(get_db), user=Depends(require_user)):
        if kind == "remix" and (payload.category not in CATEGORIES or payload.asset_scope != "marketing_video"):
            raise HTTPException(400, "请选择混剪成片的现有产品分类")
        filename = normalize_upload_filename(payload.filename)
        suffix = Path(filename).suffix.lower()
        reference = kind == "source" and payload.asset_scope == "reference_video"
        if suffix not in (ALLOWED_EXTENSIONS if kind == "source" else VIDEO_EXTENSIONS) or not (
            payload.content_type.startswith("video/") or kind == "source" and payload.content_type.startswith("image/")):
            raise HTTPException(400, "混剪成片仅支持视频文件")
        item = find_session(db, payload, user)
        if item:
            obj = reconcile(db, item)
            return session_out(item, [] if obj else remote_parts(item))
        now = datetime.utcnow()
        code = CATEGORIES.get(payload.category, "category-" + hashlib.sha256(payload.category.encode()).hexdigest()[:12])
        key = f"{object_prefix}{'references/' if reference else ''}{code}/{now:%Y/%m}/{uuid4().hex}/original{suffix}"
        try:
            ticket = client.create_multipart_upload(Bucket=BUCKET, Key=key, ContentType=payload.content_type)
        except ClientError as error:
            raise HTTPException(503, "无法创建新混剪上传会话") from error
        item = UploadSession(
            id=str(uuid4()), owner_number=owner(user),
            owner_name=str(user.get("realName") or user.get("name") or owner(user))[:120],
            sha256=payload.sha256.lower(), file_size=payload.size, filename=filename,
            content_type=payload.content_type, asset_scope="source_reference" if reference else session_scope, category=payload.category,
            object_key=key, multipart_upload_id=ticket["UploadId"], part_size=PART_BYTES,
            status="active", expires_at=now + timedelta(hours=24), created_at=now, updated_at=now,
        )
        db.add(item)
        try:
            db.commit()
        except Exception:
            db.rollback()
            client.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=ticket["UploadId"])
            raise
        return session_out(item)

    @router.get("/uploads/sessions/{sid}")
    def status(sid: str, db: Session = Depends(get_db), user=Depends(require_user)):
        item = get_session(db, sid, user)
        if item.status == "cancelled":
            # An aborted multipart ID no longer has parts to list. Its persisted
            # cancellation is still a valid result for recovery/cleanup checks.
            return session_out(item)
        obj = reconcile(db, item)
        return session_out(item, [] if obj else remote_parts(item))

    @router.put("/uploads/sessions/{sid}/parts/{number}")
    async def put_part(sid: str, number: int, request: Request,
                       db: Session = Depends(get_db), user=Depends(require_user)):
        item = get_session(db, sid, user)
        total = (item.file_size + item.part_size - 1) // item.part_size
        if item.status != "active" or not 1 <= number <= total:
            raise HTTPException(409, "会话状态或分片编号不正确")
        expected = min(item.part_size, item.file_size - (number - 1) * item.part_size)
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > expected:
                raise HTTPException(413, "分片超过会话约定大小")
        if len(content) != expected or hashlib.md5(content).hexdigest() != request.headers.get("x-upload-part-md5", "").lower():
            raise HTTPException(409, "分片大小或 MD5 校验失败")
        try:
            result = await run_in_threadpool(client.upload_part, Bucket=BUCKET, Key=item.object_key,
                UploadId=item.multipart_upload_id, PartNumber=number, Body=bytes(content))
        except ClientError as error:
            raise HTTPException(503, "分片写入失败，请恢复原上传会话") from error
        return {"part_number": number, "etag": result["ETag"], "size": len(content)}

    @router.post("/uploads/sessions/{sid}/complete")
    def complete(sid: str, payload: Complete, db: Session = Depends(get_db), user=Depends(require_user)):
        item = get_session(db, sid, user, lock=True)
        if payload.sha256.lower() != item.sha256:
            raise HTTPException(409, "文件标识与上传会话不一致")
        if reconcile(db, item):
            return session_out(item)
        total = (item.file_size + item.part_size - 1) // item.part_size
        parts = sorted([{"part_number": p.part_number, "etag": p.etag.strip()} for p in payload.parts],
                       key=lambda part: part["part_number"])
        if [p["part_number"] for p in parts] != list(range(1, total + 1)):
            raise HTTPException(409, "分片回执不完整或存在重复编号")
        if any(not p["etag"].strip('"') or "\r" in p["etag"] or "\n" in p["etag"] for p in parts):
            raise HTTPException(400, "分片回执格式不正确")
        inventory = remote_parts(item)
        if inventory is not None:
            if [p["part_number"] for p in inventory] != list(range(1, total + 1)):
                raise HTTPException(409, "分片尚未完整上传")
            if any(p["size"] != min(item.part_size, item.file_size - (p["part_number"] - 1) * item.part_size) for p in inventory):
                raise HTTPException(409, "分片大小与会话不一致")
            receipts = [(p["part_number"], p["etag"].strip('"')) for p in parts]
            expected = [(p["part_number"], p["etag"].strip('"')) for p in inventory]
            if receipts != expected:
                raise HTTPException(409, "分片回执与存储不一致")
        try:
            client.complete_multipart_upload(Bucket=BUCKET, Key=item.object_key,
                UploadId=item.multipart_upload_id, MultipartUpload={"Parts": [
                    {"PartNumber": p["part_number"], "ETag": p["etag"]} for p in parts]})
        except ClientError as error:
            raise HTTPException(503, "合并结果暂未确认，请恢复原会话") from error
        if not reconcile(db, item):
            raise HTTPException(503, "完整文件尚未确认，请恢复原会话")
        return session_out(item)

    @router.delete("/uploads/sessions/{sid}")
    def cancel(sid: str, db: Session = Depends(get_db), user=Depends(require_user)):
        item = get_session(db, sid, user, lock=True)
        if item.status == "completed":
            raise HTTPException(409, "已完成文件不能作为未完成分片取消")
        if item.status != "cancelled":
            try:
                client.abort_multipart_upload(Bucket=BUCKET, Key=item.object_key, UploadId=item.multipart_upload_id)
            except ClientError as error:
                if not missing(error):
                    raise HTTPException(503, "分片取消结果尚未确认") from error
            item.status = "cancelled"
            item.updated_at = datetime.utcnow()
            db.commit()
        return {"session_id": sid, "status": item.status}

    @router.post("/assets")
    def register(payload: Register, request: Request, db: Session = Depends(get_db), user=Depends(require_user)):
        item = get_session(db, payload.session_id, user, lock=True)
        if item.asset_scope != session_scope:
            raise HTTPException(409, "参考文件不能作为独立素材登记")
        obj = reconcile(db, item)
        if item.status != "completed" or not obj:
            raise HTTPException(409, "请先完整上传并合并文件")
        if payload.category is not None and payload.category != item.category:
            raise HTTPException(409, "登记产品与原上传会话不一致")
        asset = db.scalar(select(TargetAsset).where(TargetAsset.object_key == item.object_key))
        if not asset:
            from .main import _normalized_reference_url, _validated_reference_video, _validated_performance_screenshots

            def validate_reference(key, filename):
                if not key.startswith("wis/source/"):
                    return _validated_reference_video(key, filename)
                proof = db.scalar(select(UploadSession).where(UploadSession.object_key == key,
                    UploadSession.asset_scope == "source_reference", UploadSession.owner_number == owner(user),
                    UploadSession.status == "completed"))
                if not proof:
                    raise HTTPException(409, "参考文件缺少本人的完整上传回执")
                remote = head(key)
                if not remote or remote["ContentLength"] != proof.file_size:
                    raise HTTPException(409, "参考文件尚未完整上传")
                return key, proof.filename

            reference_key, reference_name = validate_reference(payload.reference_video_key, payload.reference_video_name)
            screenshots = []
            for entry in payload.performance_screenshots:
                if str(entry.get("object_key") or "").startswith("wis/source/"):
                    key, name = validate_reference(entry["object_key"], entry.get("filename", ""))
                    screenshots.append({"object_key": key, "filename": name})
                else:
                    screenshots.extend(_validated_performance_screenshots([entry]))
            asset = TargetAsset()
            for key, value in dict(
                object_key=item.object_key, filename=item.filename,
                media_type="image" if item.content_type.startswith("image/") else "video", size=item.file_size,
                etag=str(obj["ETag"]).strip('"'), modified_at=obj["LastModified"].replace(tzinfo=None),
                category=item.category, content_type=payload.content_type, status="待整理", asset_scope="marketing_video",
                library_type=kind, asset_subtype=payload.asset_subtype,
                folder_name=payload.folder_name if kind == "source" else "",
                material_description=payload.material_description, performance_screenshots=screenshots,
                tags=list(dict.fromkeys([tag.strip() for tag in payload.tags if tag.strip()] + ["上传素材"])),
                reference_url=_normalized_reference_url(payload.reference_url),
                reference_video_key=reference_key, reference_video_name=reference_name,
                source="oa_upload", ingest_source="oa_upload", account_name=item.owner_name,
                uploaded_by_number=item.owner_number, uploaded_by_name=item.owner_name,
            ).items():
                setattr(asset, key, value)
            db.add(asset)
            try:
                db.commit()
                invalidate_catalog()
            except IntegrityError:
                db.rollback()
                asset = db.scalar(select(TargetAsset).where(TargetAsset.object_key == item.object_key))
                if asset is None:
                    raise
        if asset.uploaded_by_number != owner(user):
            raise HTTPException(403, "素材归属与当前账号不一致")
        if asset.deleted_at or asset.purged_at:
            raise HTTPException(409, "该素材已删除，不能通过重试重新登记")
        return asset_out(asset, request)

    def get_asset(db, asset_id):
        stmt = select(TargetAsset).where(TargetAsset.id == asset_id, TargetAsset.library_type == kind)
        if kind == "source":
            from .main import _recovery_asset_allowed
            stmt = stmt.where(_recovery_asset_allowed(db, TargetAsset.id, "visibility"))
        item = db.scalar(stmt)
        if not item or item.library_type != kind or item.deleted_at or item.purged_at:
            raise HTTPException(404, "混剪素材不存在")
        return item

    @router.get("/assets/{asset_id}")
    def asset_detail(asset_id: int, request: Request, db: Session = Depends(get_db)):
        return asset_out(get_asset(db, asset_id), request)

    @router.patch("/assets/{asset_id}")
    def update_asset(asset_id: int, payload: AssetUpdate, request: Request,
                     db: Session = Depends(get_db), user=Depends(require_user)):
        from .main import require_asset_manager, _normalized_reference_url
        item = get_asset(db, asset_id)
        require_asset_manager(user, item)
        changes = payload.model_dump(exclude_unset=True)
        if changes.get("library_type", kind) != kind:
            raise HTTPException(409, "新混剪素材不能通过编辑转入旧视频素材库")
        if kind == "remix" and "category" in changes and changes["category"] not in CATEGORIES:
            raise HTTPException(400, "请选择现有产品分类")
        allowed = {"filename", "category", "content_type", "status", "asset_subtype", "tags", "reference_url", "folder_name", "material_description"}
        for key, value in changes.items():
            if key not in allowed or value is None:
                continue
            if key == "filename":
                value = normalize_upload_filename(value)
            if key == "reference_url":
                value = _normalized_reference_url(value)
            setattr(item, key, value)
        db.commit()
        invalidate_catalog()
        return asset_out(item, request)

    @router.delete("/assets/{asset_id}")
    def delete_asset(asset_id: int, request: Request, db: Session = Depends(get_db), user=Depends(require_user)):
        from .main import require_asset_deleter
        item = get_asset(db, asset_id)
        require_asset_deleter(user, item)
        item.deleted_at = datetime.utcnow()
        item.deleted_by_number = owner(user)
        item.deleted_by_name = str(user.get("realName") or user.get("name") or owner(user))[:120]
        db.commit()
        invalidate_catalog()
        return asset_out(item, request)

    @router.post("/assets/{asset_id}/restore")
    def restore_asset(asset_id: int, request: Request, db: Session = Depends(get_db), user=Depends(require_user)):
        from .main import require_asset_deleter
        item = db.get(TargetAsset, asset_id)
        if not item or item.library_type != kind or item.purged_at:
            raise HTTPException(404, "原素材不存在或已清理")
        require_asset_deleter(user, item)
        item.deleted_at = None
        item.deleted_by_number = item.deleted_by_name = ""
        db.commit()
        invalidate_catalog()
        return asset_out(item, request)

    @router.get("/assets")
    def assets(request: Request, category: str = "", page: int = 1, page_size: int = 24,
               db: Session = Depends(get_db)):
        if page < 1 or not 1 <= page_size <= 100:
            raise HTTPException(400, "分页参数无效")
        conditions = [TargetAsset.deleted_at.is_(None), TargetAsset.purged_at.is_(None), TargetAsset.library_type == kind]
        if category:
            conditions.append(TargetAsset.category == category)
        total = db.scalar(select(func.count()).select_from(TargetAsset).where(*conditions))
        rows = db.scalars(select(TargetAsset).where(*conditions).order_by(TargetAsset.id.desc())
                          .offset((page - 1) * page_size).limit(page_size)).all()
        return {"items": [asset_out(row, request) for row in rows], "total": total,
                "page": page, "page_size": page_size, "source": "新混剪素材库"}

    @router.get("/assets/{asset_id}/content")
    def content(asset_id: int, request: Request, download: bool = False,
                db: Session = Depends(get_db)):
        item = get_asset(db, asset_id)
        return read_content(item.object_key, item.filename, request, download)

    def read_content(key, filename, request, download=False):
        read_client, read_bucket = client, BUCKET
        if not key.startswith(("wis/source/", "wis/remix/")):
            from .oss_service import oss_service
            read_client, read_bucket = oss_service.client, settings.bucket
        kwargs = {"Bucket": read_bucket, "Key": key}
        if request.headers.get("range"):
            kwargs["Range"] = request.headers["range"]
        try:
            obj = read_client.get_object(**kwargs)
        except ClientError as error:
            code = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            raise HTTPException(416 if code == 416 else 503, "素材文件暂时不可读取") from error
        body = obj["Body"]

        def chunks():
            try:
                yield from body.iter_chunks(1024 * 1024)
            finally:
                body.close()

        headers = {"Content-Length": str(obj["ContentLength"]), "Accept-Ranges": "bytes"}
        if obj.get("ContentRange"):
            headers["Content-Range"] = obj["ContentRange"]
        if download:
            from urllib.parse import quote
            headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(filename)
        return StreamingResponse(chunks(), status_code=206 if obj.get("ContentRange") else 200,
                                 media_type=obj.get("ContentType", "video/mp4"), headers=headers)

    @router.get("/assets/{asset_id}/reference")
    def reference_content(asset_id: int, request: Request, db: Session = Depends(get_db)):
        item = get_asset(db, asset_id)
        if not item.reference_video_key:
            raise HTTPException(404, "素材没有参考文件")
        return read_content(item.reference_video_key, item.reference_video_name, request)

    @router.get("/assets/{asset_id}/screenshots/{index}")
    def screenshot_content(asset_id: int, index: int, request: Request, db: Session = Depends(get_db)):
        item = get_asset(db, asset_id)
        screenshots = item.performance_screenshots or []
        if index < 0 or index >= len(screenshots):
            raise HTTPException(404, "数据截图不存在")
        return read_content(screenshots[index]["object_key"], screenshots[index].get("filename", "screenshot"), request)

    if local and kind == "remix":
        @router.get("/check", response_class=HTMLResponse)
        def check():
            return Path(__file__).with_name("remix_upload_check.html").read_text(encoding="utf-8")

    router.serialize_asset = asset_out

    return router


def validate_channels_cover(db, user, object_key, filename):
    """Require the caller's completed reference upload before using a new cover."""
    if not object_key.startswith("wis/source/references/"):
        raise HTTPException(400, "视频封面不在受管参考文件目录内")
    proof = db.scalar(select(UploadSession).where(
        UploadSession.object_key == object_key,
        UploadSession.asset_scope == "source_reference",
        UploadSession.owner_number == owner(user),
        UploadSession.status == "completed",
    ))
    if not proof or not proof.content_type.startswith("image/") or not 0 < proof.file_size <= 20 * 1024 * 1024:
        raise HTTPException(409, "视频封面缺少本人的完整图片上传回执，或超过 20MB")
    client = boto3.client("s3", endpoint_url=os.getenv("REMIX_OSS_ENDPOINT", "https://oss.fandow.com"),
        aws_access_key_id=os.getenv("REMIX_OSS_ACCESS_KEY") or settings.access_key,
        aws_secret_access_key=os.getenv("REMIX_OSS_SECRET_KEY") or settings.secret_key,
        region_name="auto", config=Config(signature_version="s3v4", s3={"addressing_style":"path"}))
    try:
        remote = client.head_object(Bucket=BUCKET, Key=object_key)
    except ClientError as error:
        raise HTTPException(409, "视频封面尚未完整上传") from error
    if remote.get("ContentLength") != proof.file_size or not str(remote.get("ContentType", "")).startswith("image/"):
        raise HTTPException(409, "视频封面文件与上传回执不一致")
    return {"object_key": object_key, "filename": proof.filename}
