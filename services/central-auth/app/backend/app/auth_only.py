"""Lightweight WIS central-auth surface for dependent workbenches.

This process deliberately does not serve the video-center FastAPI app, so the
video scanning, cover generation, delivery, and metrics background loops are not
started.  It reuses the same live OA verification and permission database.
"""

import logging
import os
import time
from uuid import uuid4
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

import asyncio
from fastapi.responses import JSONResponse
from .database import DatabaseUnavailable, assert_database_available, validate_database_startup, finish_database_bootstrap
from contextlib import asynccontextmanager

from .auth import _organization_from_user, require_user
from .main import module_access_for_user, user_permissions
from .main import workstation_access_authorize, workstation_access_authorize_identity
from .workstation_auth import require_workstation


app = FastAPI(title="WIS Central Auth Sidecar", version="1.0.0")
logger = logging.getLogger("uvicorn.error")


async def verified_workstation(request: Request):
    try:
        return require_workstation(request)
    except HTTPException as error:
        # Do not confuse the trusted service credential with a colleague's session.
        raise HTTPException(error.status_code, {"code": "CENTRAL_SERVICE_CREDENTIAL_INVALID", "message": "平台集成凭据校验失败"}) from error


app.dependency_overrides[require_workstation] = verified_workstation
# Exact current business-policy functions, same database; no copied grants,
# video/push/generation routes, or heavy application's background lifespan.
app.add_api_route("/api/workstation/access-authorize", workstation_access_authorize, methods=["GET"])
app.add_api_route("/api/workstation/access-authorize-identity", workstation_access_authorize_identity, methods=["POST"])


@app.exception_handler(HTTPException)
async def classified_error(request: Request, error: HTTPException):
    detail = error.detail
    code = detail.get("code") if isinstance(detail, dict) else None
    if not code:
        code = "OA_SESSION_EXPIRED" if error.status_code == 401 else "CENTRAL_MODULE_DENIED" if error.status_code == 403 else "CENTRAL_ACCESS_UNAVAILABLE"
    return JSONResponse({"detail": detail, "code": code}, status_code=error.status_code, headers={"Cache-Control": "no-store"})


@app.middleware("http")
async def access_telemetry(request: Request, call_next):
    start = time.monotonic()
    request_id = str(uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["Cache-Control"] = "no-store"
    elapsed = round((time.monotonic() - start) * 1000)
    if response.status_code >= 400 or elapsed > 2000:
        logger.info("central_auth request_id=%s path=%s status=%s elapsed_ms=%s", request_id, request.url.path, response.status_code, elapsed)
    return response


@app.get("/api/live")
def live() -> dict:
    return {"ok": True, "service": "wis-central-auth", "release": os.getenv("RELEASE_ID", "auth-assets-20260907"), "capabilities": ["central-me", "workstation-oa", "workstation-identity"]}


@app.get("/api/central-auth/me")
def central_auth_me(user: dict = Depends(require_user)) -> dict:
    department, center = _organization_from_user(user)

    def first_text(*fields: str) -> str:
        for field in fields:
            value = user.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    def avatar_url() -> str:
        for field in (
            "avatarUrl",
            "avatar_url",
            "headImg",
            "head_img",
            "photo",
            "photoUrl",
            "profilePhotoUrl",
            "picture",
        ):
            value = user.get(field)
            if isinstance(value, str) and value.strip().startswith("https://"):
                return value.strip()
        avatar = user.get("avatar")
        if isinstance(avatar, str) and avatar.strip().startswith("https://"):
            return avatar.strip()
        if isinstance(avatar, dict):
            for field in ("avatar_origin", "avatar_640", "avatar_240", "avatar_72", "url"):
                value = avatar.get(field)
                if isinstance(value, str) and value.strip().startswith("https://"):
                    return value.strip()
        return ""

    safe_user = {
        field: user.get(field)
        for field in (
            "number",
            "userId",
            "id",
            "realName",
            "name",
            "groupName",
            "parentDept",
            "deptName",
            "status",
        )
        if user.get(field) is not None
    }
    safe_user["department"] = department
    safe_user["center"] = center
    safe_user["jobTitle"] = first_text(
        "jobTitle",
        "job_title",
        "positionName",
        "position_name",
        "position",
        "postName",
        "post_name",
        "jobName",
        "title",
    )
    safe_user["avatarUrl"] = avatar_url()
    return {
        "user": safe_user,
        "permissions": user_permissions(user),
        "access": module_access_for_user(user),
    }


@asynccontextmanager
async def _identity_startup(application):
    validate_database_startup()
    yield

app.router.lifespan_context = _identity_startup


# Database identity is checked before authentication can use a fallback path.
def _identity_maintenance_response():
    return JSONResponse(status_code=503, content={
        "detail": "数据库不可用，服务维护中；历史数据不会被重新初始化，请联系管理员恢复。",
        "code": "database_unavailable",
    })


@app.exception_handler(DatabaseUnavailable)
async def _identity_database_error(_request, _error):
    return _identity_maintenance_response()


@app.middleware("http")
async def _identity_database_boundary(request, call_next):
    try:
        await asyncio.to_thread(assert_database_available)
        return await call_next(request)
    except DatabaseUnavailable:
        return _identity_maintenance_response()
