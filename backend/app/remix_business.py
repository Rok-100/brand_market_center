"""Reuse the existing business rules with explicitly isolated physical tables.

Request and durable-worker scopes are context-local, including thread-pool work.
Only SQL identifiers from the fixed mapping are translated; bound values and
shared authentication, account authorization and review configuration stay intact.
No material is mirrored into the source table. Schema is provisioned separately.
"""
import asyncio
from contextlib import contextmanager, asynccontextmanager
from contextvars import ContextVar
import re
import json

from sqlalchemy import event
from .database import engine

_namespace = ContextVar("material_business_namespace", default="source")
RELATIONS = (
    "asset_favorites", "asset_effective_marks", "asset_audit_logs", "workstation_returns",
    "asset_review_submissions", "asset_review_ai_results", "asset_review_decisions",
    "qianchuan_deliveries", "qianchuan_metric_daily", "adq_deliveries", "adq_metric_daily",
    "channels_deliveries", "channels_metric_daily", "channels_promotion_orders",
    "channels_promotion_payment_sessions", "company_audit_jobs", "company_audit_remote_tasks",
    "company_audit_callback_receipts", "company_audit_feedback", "company_audit_worker_state",
)
TABLES = {"py_cloud_assets": "py_cloud_remix_assets", **{
    "py_cloud_" + name: "py_cloud_remix_" + name for name in RELATIONS}}
_identifiers = re.compile(r"(?<![\w])(" + "|".join(map(re.escape, TABLES)) + r")(?![\w])")


@contextmanager
def remix_scope():
    token = _namespace.set("remix")
    try:
        yield
    finally:
        _namespace.reset(token)


@event.listens_for(engine, "before_cursor_execute", retval=True)
def scoped_tables(connection, cursor, statement, parameters, context, executemany):
    if _namespace.get() == "remix":
        # SQLAlchemy binds application values separately. Skip SQL quoted string
        # literals, identifiers inside them must never be rewritten.
        pieces = re.split(r"('(?:''|\\.|[^'\\])*')", statement)
        statement = "".join(part if i % 2 else _identifiers.sub(lambda m: TABLES[m[0]], part)
                            for i, part in enumerate(pieces))
    return statement, parameters


class RemixBusinessMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/remix-business/"):
            return await self.app(scope, receive, send)
        path = "/api/" + scope["path"][len("/api/remix-business/"):]
        allowed = path.startswith(("/api/reviews/", "/api/qianchuan/", "/api/adq/", "/api/channels/"))
        allowed = allowed or bool(re.fullmatch(r"/api/assets/\d+/(favorite|effective|performance)", path))
        if not allowed:
            from starlette.responses import JSONResponse
            return await JSONResponse({"detail": "不支持的新混剪业务入口"}, status_code=404)(scope, receive, send)
        scope = dict(scope, path=path, raw_path=path.encode())
        prefix = dict(scope.get('headers', [])).get(b'x-forwarded-prefix', b'').decode().rstrip('/')
        start, chunks = None, []
        async def browser_response(message):
            nonlocal start
            if message['type'] == 'http.response.start':
                content_type = dict(message.get('headers', [])).get(b'content-type', b'')
                if b'application/json' in content_type:
                    start = message
                    return
            if start is not None and message['type'] == 'http.response.body':
                chunks.append(message.get('body', b''))
                if message.get('more_body'):
                    return
                def decorate(value):
                    if isinstance(value, list):
                        return [decorate(item) for item in value]
                    if not isinstance(value, dict):
                        return value
                    value = {key:decorate(item) for key,item in value.items()}
                    identity = value.get('asset_id') or (value.get('id') if value.get('object_key') else None)
                    if identity and ('preview_url' in value or 'asset_preview_url' in value):
                        for key in ('preview_url', 'asset_preview_url', 'download_url'):
                            if key in value:
                                value[key] = f'{prefix}/api/remix-library/assets/{identity}/content' + ('?download=true' if key == 'download_url' else '')
                        value['asset_library'] = 'remix'
                    return value
                data = json.dumps(decorate(json.loads(b''.join(chunks))), ensure_ascii=False).encode()
                start = dict(start, headers=[(key,value) for key,value in start.get('headers', [])
                                             if key not in (b'content-length', b'etag')])
                await send(start)
                await send(dict(message, body=data))
                return
            await send(message)
        with remix_scope():
            await self.app(scope, receive, browser_response)


def install(app):
    from . import main
    from .remix_library import BUCKET
    from .config import settings
    import os
    import boto3
    from botocore.config import Config
    # Read URLs for new objects must use the selected bucket, for both new
    # source footage and remixes. Never fall back to the legacy bucket.
    client = boto3.client("s3", endpoint_url=os.getenv("REMIX_OSS_ENDPOINT", "https://oss.fandow.com"),
        aws_access_key_id=os.getenv("REMIX_OSS_ACCESS_KEY") or settings.access_key,
        aws_secret_access_key=os.getenv("REMIX_OSS_SECRET_KEY") or settings.secret_key,
        region_name="auto", config=Config(signature_version="s3v4", s3={"addressing_style":"path"}))
    original_url = main.oss_service.url_for
    def url_for(key, download=False, expires_in=3600):
        if key.startswith(("wis/source/", "wis/remix/")):
            return client.generate_presigned_url("get_object", Params={"Bucket":BUCKET,"Key":key}, ExpiresIn=expires_in)
        return original_url(key, download=download, expires_in=expires_in)
    main.oss_service.url_for = url_for
    app.add_middleware(RemixBusinessMiddleware)
    previous = app.router.lifespan_context
    @asynccontextmanager
    async def lifespan(application):
        async with previous(application):
            with remix_scope():
                workers = [asyncio.create_task(getattr(main, name)()) for name in (
                    "review_ai_loop", "company_audit_loop", "qianchuan_delivery_loop",
                    "adq_delivery_loop", "channels_delivery_loop", "qianchuan_metrics_loop",
                    "adq_metrics_loop", "channels_metrics_loop")]
            try:
                yield
            finally:
                for worker in workers:
                    worker.cancel()
                await asyncio.gather(*workers, return_exceptions=True)
    app.router.lifespan_context = lifespan
