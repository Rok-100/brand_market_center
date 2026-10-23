"""Local-only upload integration entry point; does not switch the production UI."""
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

if os.getenv("LOCAL_SIMULATION") != "1":
    raise RuntimeError("This entry point is only for local integration testing")

from .main import app
from .remix_business import install as install_remix_business
install_remix_business(app)
from .remix_library import build_router
from .remix_hall import build_hall_router


@app.middleware("http")
async def prevent_legacy_material_uploads(request, call_next):
    # Keep product-image workflows independent; future footage and remix
    # uploads must enter the two explicit namespaces, even from stale clients.
    if request.method == "POST" and request.url.path in {
        "/api/uploads/presign", "/api/uploads/multipart/sessions",
    }:
        try:
            payload = await request.json()
        except (ValueError, UnicodeDecodeError):
            return await call_next(request)
        if isinstance(payload, dict) and payload.get("asset_scope", "marketing_video") != "product_image":
            return JSONResponse(status_code=409, content={"detail": "素材上传入口已更新，请刷新页面后继续上传；新素材将保存到新的素材目录"})
    if request.method == "POST" and request.url.path == "/api/uploads/complete":
        try:
            payload = await request.json()
        except (ValueError, UnicodeDecodeError):
            return await call_next(request)
        if isinstance(payload, dict) and payload.get("library_type") == "remix":
            return JSONResponse(status_code=409, content={"detail": "旧混剪素材库已停用，请刷新页面后通过新混剪入口上传"})
    return await call_next(request)

# Insert before the existing catch-all frontend mount.
remix_router = build_router("remix")
source_router = build_router("source")
app.router.routes[0:0] = [*remix_router.routes, *source_router.routes,
    *build_hall_router(remix_router.serialize_asset, source_router.serialize_asset).routes]

frontend = Path(__file__).resolve().parents[2] / "frontend" / "remix-hall-local"
if frontend.is_dir():
    app.router.routes[:] = [route for route in app.router.routes if getattr(route, "name", None) != "frontend"]
    app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
