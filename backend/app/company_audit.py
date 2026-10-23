"""Durable integration for the company-owned material audit service.

Import this module before Base.metadata.create_all().  Request handlers call
enqueue/queue_feedback/accept_callback inside their existing DB transaction and
commit before returning. A background loop calls worker_tick(SessionLocal); one
tick makes at most one short network request, outside any database transaction.

COMPANY_AUDIT_TOKEN or COMPANY_AUDIT_TOKEN_FILE configures server credentials.
COMPANY_AUDIT_BASE_URL defaults to the documented HTTPS service. Optional
COMPANY_AUDIT_CALLBACK_BASE_URL is the full HTTPS callback route prefix; mount
POST <prefix>/{capability}, persist via accept_callback, commit, then return 2xx.
Callbacks are untrusted wakeups, never verdicts. No credentials, download URLs,
callback capabilities, or upstream exception strings enter the public response.
Trusted company evidence-frame URLs are exposed only by the authenticated
review projection; callers must never put that response in access/error logs.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import requests
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .models import Asset, AppMeta


DEFAULT_BASE = "https://cloud.fandow.com/material-security-check"
LEASE_SECONDS = 90
POLL_SECONDS = 15
COMPLETE_POLL_SECONDS = 300
VALID_VERDICTS = {"pass", "reject", "manual_required", "unknown"}
VALID_STATUSES = {"pending", "processing", "success", "failed"}


class CompanyAuditWorkerState(Base):
    """Durable round-robin capacity between submissions and remote operations."""
    __tablename__ = "company_audit_worker_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    preferred_kind: Mapped[str] = mapped_column(String(10), default="submit")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CompanyAuditRemoteTask(Base):
    """One authoritative state and one network lease per upstream task."""
    __tablename__ = "company_audit_remote_tasks"

    task_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    verdict: Mapped[str] = mapped_column(String(30), default="unknown")
    ready: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_result: Mapped[dict] = mapped_column(JSON, default=dict)
    requested_revision: Mapped[int] = mapped_column(Integer, default=1)
    verified_revision: Mapped[int] = mapped_column(Integer, default=0)
    result_revision: Mapped[int] = mapped_column(Integer, default=0)
    latest_feedback_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latest_feedback_status: Mapped[str] = mapped_column(String(30), default="")
    latest_feedback_verdict: Mapped[str] = mapped_column(String(30), default="")
    latest_feedback_has_reason: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(60), default="")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    lease_token: Mapped[str] = mapped_column(String(64), default="")
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CompanyAuditJob(Base):
    __tablename__ = "company_audit_jobs"
    __table_args__ = (UniqueConstraint("submission_id", name="uq_company_audit_submission"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    submission_id: Mapped[str] = mapped_column(ForeignKey("asset_review_submissions.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    object_key_snapshot: Mapped[str] = mapped_column(Text, default="")
    etag_snapshot: Mapped[str] = mapped_column(String(255), default="")
    size_snapshot: Mapped[int] = mapped_column(Integer, default=0)
    category_snapshot: Mapped[str] = mapped_column(String(100), default="")
    asset: Mapped[Asset] = relationship(lazy="selectin")
    video_url: Mapped[str] = mapped_column(Text)
    product_id: Mapped[str] = mapped_column(String(160), default="")
    channel: Mapped[str] = mapped_column(String(100), default="")
    callback_capability: Mapped[str] = mapped_column(String(64), unique=True, default=lambda: secrets.token_urlsafe(32))
    task_id: Mapped[str | None] = mapped_column(ForeignKey("company_audit_remote_tasks.task_id"), nullable=True, index=True)
    # Multiple submissions may deliberately reference one reused upstream task.
    remote_task: Mapped[CompanyAuditRemoteTask | None] = relationship(lazy="selectin")
    status: Mapped[str] = mapped_column(String(30), default="queued")
    pending_feedback_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(60), default="")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    lease_token: Mapped[str] = mapped_column(String(64), default="")
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CompanyAuditCallbackReceipt(Base):
    __tablename__ = "company_audit_callback_receipts"
    __table_args__ = (UniqueConstraint("job_id", "payload_sha256", name="uq_company_callback_payload"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("company_audit_jobs.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str] = mapped_column(String(160), default="")
    payload_sha256: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CompanyAuditFeedback(Base):
    __tablename__ = "company_audit_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("company_audit_jobs.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("company_audit_remote_tasks.task_id"), index=True, nullable=True)
    verdict: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(30), default="queued")
    base_result_revision: Mapped[int] = mapped_column(Integer)
    basis_hash: Mapped[str] = mapped_column(String(64), default="")
    expected_request_revision: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(60), default="")
    response: Mapped[dict] = mapped_column(JSON, default=dict)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def _https_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError
        if parsed.port not in (None, 443):
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("公司审核服务地址必须是无凭据的 HTTPS 地址") from None
    return value.rstrip("/")


def _configuration() -> tuple[str, str, str]:
    token = os.getenv("COMPANY_AUDIT_TOKEN", "").strip()
    if not token:
        filename = os.getenv("COMPANY_AUDIT_TOKEN_FILE", "").strip()
        if filename:
            try:
                with Path(filename).open("r", encoding="utf-8") as handle:
                    token = handle.read(16385).strip()
            except (OSError, UnicodeError):
                raise ValueError("公司审核凭据不可读取") from None
    if not token or len(token) > 16384 or "\n" in token or "\r" in token:
        raise ValueError("公司审核服务端凭据未配置")
    base = _https_url(os.getenv("COMPANY_AUDIT_BASE_URL", DEFAULT_BASE).strip())
    callback = os.getenv("COMPANY_AUDIT_CALLBACK_BASE_URL", "").strip()
    return base, token, _https_url(callback) if callback else ""


def configured() -> bool:
    try:
        _configuration()
        return True
    except ValueError:
        return False


CONTROL_KEY = "company_audit.control"


def control(db) -> dict:
    # Read through on every request/worker tick; credentials never override OFF.
    row = db.scalar(select(AppMeta).where(AppMeta.key == CONTROL_KEY).execution_options(populate_existing=True))
    if row:
        value = json.loads(row.value)
        if not isinstance(value, dict) or type(value.get("enabled")) is not bool:
            raise ValueError("公司审核开关配置无效，请管理员修复")
        return value
    raw = os.getenv("COMPANY_AUDIT_ENABLED", "").strip().lower()
    # Preserve legacy default only until the first explicit server-side setting.
    default = raw in {"1", "true", "yes"} if raw else configured()
    return {"enabled": default, "source": "environment_default"}


def enabled(db) -> bool:
    return control(db)["enabled"]


def public_for_submission(db, submission_id: str) -> dict | None:
    result = to_public(get_for_submission(db, submission_id))
    if result:
        from . import review_takeover
        job = get_for_submission(db, submission_id)
        takeover_gate = review_takeover.gate(db, job)
        if takeover_gate is not None:
            result.update(takeover_active=True, takeover_dispatch_allowed=takeover_gate[0],
                dispatch_allowed=takeover_gate[0], blocking=not takeover_gate[0], gate_reason=takeover_gate[1])
    if result and not enabled(db):
        result.update(enabled=False, dispatch_allowed=True, blocking=False,
                      gate_reason="公司审核已关闭；历史结果仅供查看，内部审核照常执行")
    return result


def get_for_submission(db, submission_id: str) -> CompanyAuditJob | None:
    db.flush()
    return db.scalar(select(CompanyAuditJob).where(CompanyAuditJob.submission_id == submission_id).execution_options(populate_existing=True))


def enqueue(db, submission, asset, video_url: str, product_id: str = "", channel: str = "") -> CompanyAuditJob:
    """Persist the exact URL once; retries never regenerate a signed URL.

    A job is created even without credentials, so new submissions cannot fall
    through the legacy no-job gate. Configuration recovery resumes this job.
    """
    if not enabled(db):
        return None
    existing = get_for_submission(db, submission.id)
    if existing:
        if existing.asset_id != asset.id or existing.version != submission.version:
            raise ValueError("公司审核送审版本不一致")
        return existing
    if channel and channel not in {"抖音", "视频号"}:
        raise ValueError("公司审核渠道只支持抖音或视频号")
    try:
        parsed = urlsplit(video_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("公司审核需要有效的视频下载地址") from None
    db.flush()
    job = CompanyAuditJob(submission_id=submission.id, asset_id=asset.id, version=submission.version,
                          video_url=video_url, object_key_snapshot=asset.object_key,
                          etag_snapshot=getattr(asset, "etag", "") or "", size_snapshot=getattr(asset, "size", 0) or 0,
                          category_snapshot=getattr(asset, "category", "") or "",
                          product_id=product_id or "", channel=channel or "")
    db.add(job)
    db.flush()
    return job


def _findings(task: CompanyAuditRemoteTask) -> list[dict]:
    findings = task.raw_result.get("findings", [])
    return [f for f in findings if isinstance(f, dict) and f.get("shadow") is not True] if isinstance(findings, list) else []


def _has_red(task: CompanyAuditRemoteTask) -> bool:
    count = task.raw_result.get("reject_count", 0)
    return task.verdict == "reject" or (isinstance(count, (int, float)) and count > 0) or any(f.get("tier") == "red" for f in _findings(task))


def _snapshot_matches(job: CompanyAuditJob) -> bool:
    asset = job.asset
    return bool(asset and asset.object_key == job.object_key_snapshot and (asset.etag or "") == job.etag_snapshot
                and (asset.size or 0) == job.size_snapshot and (asset.category or "") == job.category_snapshot)


def _gate_job(job: CompanyAuditJob | None, channel: str = "") -> tuple[bool, str]:
    if job is None:
        return True, "历史送审沿用原审核流程"
    if channel and job.channel and channel != job.channel:
        return False, "公司审核渠道与实际投放渠道不一致，须按实际渠道重新送审"
    if not _snapshot_matches(job):
        return False, "素材已变更，须为当前版本重新送审"
    task = job.remote_task
    if not task:
        return False, "公司审核等待提交或恢复连接"
    returned_product = task.raw_result.get("product_id")
    if returned_product and returned_product != job.product_id:
        return False, "公司审核产品编码与本次送审不一致，须核对产品映射后重新送审"
    if task.error_code:
        return False, "公司审核连接或结果校验异常，等待恢复"
    if task.last_verified_at and datetime.utcnow() - task.last_verified_at > timedelta(seconds=COMPLETE_POLL_SECONDS * 2):
        return False, "公司审核结论已超出核验有效期，等待重新核验"
    if task.requested_revision != task.verified_revision:
        return False, "公司审核结论等待服务端核验"
    if task.status != "success" or not task.ready:
        return False, "公司审核尚未成功完成"
    if task.latest_feedback_status and task.latest_feedback_status != "confirmed":
        return False, "人工复核结论等待公司审核回传确认"
    if task.verdict != "pass":
        return False, "公司审核未通过" if task.verdict == "reject" else "公司审核需要人工复核"
    if _has_red(task) and not (task.latest_feedback_status == "confirmed" and task.latest_feedback_verdict == "pass" and task.latest_feedback_has_reason):
        return False, "公司审核存在红线，需有理由的人工复核及回传确认"
    return True, "公司审核已通过"


def gate(db, submission_id: str, channel: str = "") -> tuple[bool, str]:
    if not enabled(db):
        return True, "公司审核已关闭，沿用内部审核流程"
    job = get_for_submission(db, submission_id)
    from . import review_takeover
    takeover_gate = review_takeover.gate(db, job, channel)
    return takeover_gate if takeover_gate is not None else _gate_job(job, channel)


def _safe_text(value, limit=8000) -> str:
    # Findings are company-supplied free text. Render as text in the UI, never
    # HTML, and redact URLs/authorization strings rather than leaking secrets.
    text = str(value or "")[:limit]
    text = re.sub(r"https?://[^\s<>\"']+", "[链接已隐藏]", text, flags=re.I)
    text = re.sub(r"(?i)bearer\s+[^\s,;]+", "Bearer [已隐藏]", text)
    return re.sub(r"(?i)(token|secret|signature|authorization)\s*[:=]\s*[^\s,;]+", r"\1=[已隐藏]", text)


def _public_finding(finding: dict) -> dict:
    allowed = ("time_start_ms", "time_end_ms", "time_range", "rule_code", "rule_name", "rule_remark", "tier", "severity", "evidence", "confidence")
    result = {key: (_safe_text(finding[key]) if isinstance(finding[key], str) else finding[key]) for key in allowed if key in finding and isinstance(finding[key], (str, int, float, bool, type(None)))}
    result = {key: value for key, value in result.items() if not isinstance(value, float) or math.isfinite(value)}
    result["frame_available"] = bool(finding.get("frame_url"))
    # This projection is for an authenticated review response only. Evidence
    # signed URLs are usable only on company-controlled explicitly trusted hosts.
    frame = finding.get("frame_url", "")
    result["frame_url"] = ""
    if isinstance(frame, str):
        try:
            parsed = urlsplit(frame)
            trusted = {"oss.fandow.com"} | {host.strip().lower() for host in os.getenv("COMPANY_AUDIT_EVIDENCE_HOSTS", "").split(",") if host.strip()}
            if parsed.scheme == "https" and parsed.hostname in trusted and parsed.port in (None, 443) and not (parsed.fragment or parsed.username or parsed.password):
                result["frame_url"] = frame
        except ValueError:
            pass
    return result


def to_public(job: CompanyAuditJob | None) -> dict | None:
    if job is None:
        return None
    task = job.remote_task
    allowed, reason = _gate_job(job)
    coverage = []
    if not job.product_id:
        coverage.append("未配置公司产品编码，本次不覆盖该产品的明星授权核验")
    if not job.channel:
        coverage.append("未指定投放渠道，本次仅作基础内容审核，不代表渠道授权已核验")
    return {"id": job.id, "submission_id": job.submission_id, "provider": "company_audit", "enabled": True,
            "product_id": job.product_id, "channel": job.channel,
            "task_id": job.task_id or "", "status": task.status if task else job.status,
            "verdict": task.verdict if task else "unknown", "ready": bool(task and task.ready),
            "stage": _safe_text(task.raw_result.get("stage", ""), 100) if task else "",
            "summary": _safe_text(task.raw_result.get("summary", "")) if task else "公司审核等待提交",
            "findings": [_public_finding(f) for f in _findings(task)] if task else [],
            "error_code": task.error_code if task else job.error_code,
            "error_message": _safe_text(task.raw_result.get("error_message", "")) if task else "",
            "feedback_status": task.latest_feedback_status if task else ("waiting_result" if job.pending_feedback_id else ""),
            "feedback_verdict": task.latest_feedback_verdict if task else "",
            "product_mapping_missing": not bool(job.product_id),
            "coverage_warning": "；".join(coverage),
            "channel_mapping_missing": not bool(job.channel),
            "verification_pending": bool(task and task.requested_revision != task.verified_revision),
            "revision": task.result_revision if task else 0,
            "dispatch_allowed": allowed, "blocking": not allowed, "gate_reason": reason,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "last_verified_at": task.last_verified_at.isoformat() if task and task.last_verified_at else None,
            "last_checked_at": task.last_verified_at.isoformat() if task and task.last_verified_at else None}


def _basis(data: dict) -> str:
    # Exclude progress/message/timestamps; only a changed verdict or evidence
    # invalidates an operator's decision. Local GET revision alone always grows.
    value = {key: data.get(key) for key in ("status", "ready", "verdict", "findings", "reject_count", "manual_count")}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def queue_feedback(db, submission_id: str, verdict: str, reason: str, actor,
                   expected_result_revision: int | None = None) -> CompanyAuditFeedback | None:
    """Write the manual decision outbox in the caller's transaction, no HTTP.

    Approval requires a completed company result. Rejection can be queued while
    pending/failed and waits for the company result. Legacy submissions return
    None. All local submissions
    sharing task_id share this decision and remain blocked until GET confirms it.
    """
    if not enabled(db):
        raise ValueError("公司审核已关闭，不新增人工复核回传")
    if verdict not in VALID_VERDICTS - {"unknown"}:
        raise ValueError("公司审核人工结论无效")
    job = get_for_submission(db, submission_id)
    if job is None:
        return None
    task = job.remote_task
    observed_revision = task.result_revision if task else 0
    if expected_result_revision is not None and expected_result_revision != observed_revision:
        raise ValueError("公司审核结论已变化，请刷新后重新复核")
    expected_revision = observed_revision if expected_result_revision is None else expected_result_revision
    reason = str(reason or "").strip()
    if verdict != "reject" and not _snapshot_matches(job):
        raise ValueError("素材或品类已变更，请为当前版本重新送审")
    if verdict != "reject" and task and task.raw_result.get("product_id") and task.raw_result["product_id"] != job.product_id:
        raise ValueError("公司审核产品编码与本次送审不一致，请核对映射")
    actor_value = (actor.get("user_number") or actor.get("number") or actor.get("real_name") or "") if isinstance(actor, dict) else str(actor or "")
    previous_id = task.latest_feedback_id if task else job.pending_feedback_id
    previous = db.get(CompanyAuditFeedback, previous_id) if previous_id else None
    if previous and previous.verdict == verdict and previous.reason == reason and previous.actor == actor_value and previous.status not in {"conflict", "superseded"}:
        return previous
    trustworthy = bool(task and task.status == "success" and task.ready and not task.error_code and task.requested_revision == task.verified_revision)
    if verdict != "reject" and not trustworthy:
        raise ValueError("公司审核尚未形成可信结论，请等待核验完成后复核")
    if verdict == "pass" and (_has_red(task) or task.verdict == "manual_required" or any(f.get("tier") == "yellow" for f in _findings(task))) and not reason:
        raise ValueError("红黄线改判必须填写人工复核理由")
    feedback = CompanyAuditFeedback(job_id=job.id, task_id=task.task_id if task else None, verdict=verdict, reason=reason,
                                    actor=actor_value[:160], base_result_revision=task.result_revision if trustworthy else 0,
                                    basis_hash=_basis(task.raw_result) if trustworthy else "",
                                    status="verify_before_send" if trustworthy else "waiting_result")
    db.add(feedback)
    db.flush()
    if previous and previous.status not in {"confirmed", "sending"}:
        previous.status = "superseded"
    job.pending_feedback_id = feedback.id
    if not task:
        db.flush()
        return feedback
    # Atomic increment also fences a GET already in flight. It cannot make the
    # gate green after a newer manual decision has been committed.
    conditions = [CompanyAuditRemoteTask.task_id == task.task_id,
                  CompanyAuditRemoteTask.result_revision == expected_revision]
    if verdict != "reject":
        conditions.append(CompanyAuditRemoteTask.requested_revision == CompanyAuditRemoteTask.verified_revision)
    changed = db.execute(update(CompanyAuditRemoteTask).where(*conditions).values(
        latest_feedback_id=feedback.id, latest_feedback_status=feedback.status, latest_feedback_verdict=verdict,
        latest_feedback_has_reason=bool(reason), requested_revision=CompanyAuditRemoteTask.requested_revision + 1,
        next_attempt_at=datetime.utcnow(), updated_at=datetime.utcnow()))
    if changed.rowcount != 1:
        raise ValueError("公司审核结论已变化，请刷新后重新复核")
    db.flush()
    return feedback


def accept_callback(db, capability: str, payload: dict) -> CompanyAuditCallbackReceipt:
    """Persist a wakeup. Do not call the network or trust any verdict field."""
    if not isinstance(payload, dict):
        raise ValueError("无效的公司审核回调")
    job = db.scalar(select(CompanyAuditJob).where(CompanyAuditJob.callback_capability == capability)) if isinstance(capability, str) and 32 <= len(capability) <= 64 else None
    if not job:
        raise ValueError("无效的公司审核回调")
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 262144:
        raise ValueError("公司审核回调超过大小限制")
    task_id = str(payload.get("task_id") or "")
    if len(task_id) > 160 or (job.task_id and task_id != job.task_id):
        raise ValueError("公司审核回调任务不匹配")
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    receipt = db.scalar(select(CompanyAuditCallbackReceipt).where(CompanyAuditCallbackReceipt.job_id == job.id, CompanyAuditCallbackReceipt.payload_sha256 == digest))
    if receipt:
        receipt.duplicate_count += 1
        receipt.last_received_at = datetime.utcnow()
    else:
        try:
            with db.begin_nested():
                receipt = CompanyAuditCallbackReceipt(job_id=job.id, task_id=task_id, payload_sha256=digest, payload=payload)
                db.add(receipt)
                db.flush()
        except IntegrityError:
            # Concurrent delivery of the same receipt is still a successful
            # durable wakeup, not a 500 that the upstream will never retry.
            receipt = db.scalar(select(CompanyAuditCallbackReceipt).where(CompanyAuditCallbackReceipt.job_id == job.id, CompanyAuditCallbackReceipt.payload_sha256 == digest))
            if receipt is None:
                raise
            receipt.duplicate_count += 1
            receipt.last_received_at = datetime.utcnow()
    if job.task_id:
        db.execute(update(CompanyAuditRemoteTask).where(CompanyAuditRemoteTask.task_id == job.task_id).values(
            requested_revision=CompanyAuditRemoteTask.requested_revision + 1, next_attempt_at=datetime.utcnow(), updated_at=datetime.utcnow()))
    # A callback may race the submit response. Do not learn task_id from it;
    # /submit's authoritative response links the already persisted receipt job.
    db.flush()
    return receipt


def _claim(session_factory) -> dict | None:
    now = datetime.utcnow()
    token = secrets.token_hex(16)
    with session_factory() as db:
        state = db.get(CompanyAuditWorkerState, 1)
        if not state:
            try:
                with db.begin_nested():
                    state = CompanyAuditWorkerState(id=1)
                    db.add(state)
                    db.flush()
            except IntegrityError:
                state = db.get(CompanyAuditWorkerState, 1)
        # Lock only while choosing/claiming. Persist the round-robin turn so a
        # large due poll backlog or process restart cannot starve new submits.
        db.execute(update(CompanyAuditWorkerState).where(CompanyAuditWorkerState.id == 1).values(updated_at=now))
        db.refresh(state)
        sources = ([(CompanyAuditJob, "id")] if enabled(db) else []) + [(CompanyAuditRemoteTask, "task_id")]
        if state.preferred_kind == "remote":
            sources.reverse()
        for model, key in sources:
            eligible = [model.next_attempt_at <= now, or_(model.lease_until.is_(None), model.lease_until < now)]
            if model is CompanyAuditJob:
                eligible.append(CompanyAuditJob.task_id.is_(None))
            query = select(model).where(*eligible)
            row = db.scalar(query.order_by(model.next_attempt_at, getattr(model, key)).limit(1))
            if not row:
                continue
            identity = getattr(row, key)
            claimed = db.execute(update(model).where(getattr(model, key) == identity, *eligible).values(lease_token=token, lease_until=now + timedelta(seconds=LEASE_SECONDS)))
            if claimed.rowcount != 1:
                continue
            db.refresh(row)
            if model is CompanyAuditJob:
                work = {"kind": "submit", "key": identity, "lease": token, "video_url": row.video_url,
                        "product_id": row.product_id, "channel": row.channel, "capability": row.callback_capability}
            else:
                feedback = db.get(CompanyAuditFeedback, row.latest_feedback_id) if row.latest_feedback_id else None
                # A recovered sending lease represents an uncertain request.
                # Read authority first; never automatically replay a stale choice.
                if feedback and feedback.status == "sending":
                    feedback.status = "verify_after_uncertain"
                    row.latest_feedback_status = feedback.status
                send_feedback = bool(feedback and feedback.status == "ready_to_send" and row.status == "success" and row.ready
                                     and feedback.base_result_revision == row.result_revision
                                     and feedback.expected_request_revision == row.requested_revision == row.verified_revision)
                if feedback and feedback.status == "ready_to_send" and not send_feedback:
                    feedback.status = "verify_before_send"
                    row.latest_feedback_status = feedback.status
                work = {"kind": "feedback" if send_feedback else "result", "key": identity,
                        "lease": token, "revision": row.requested_revision,
                        "feedback_id": feedback.id if send_feedback else None}
                if send_feedback:
                    work.update(verdict=feedback.verdict, reason=feedback.reason)
                    feedback.status = "sending"
                    row.latest_feedback_status = "sending"
            state.preferred_kind = "remote" if model is CompanyAuditJob else "submit"
            db.commit()
            return work
        db.commit()
    return None


def _request(work: dict) -> tuple[dict | None, str, int]:
    try:
        base, token, callback = _configuration()
    except ValueError:
        return None, "configuration_required", 300
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json", "X-System": "wis-video-center"}
    kwargs = {"headers": headers, "timeout": (3.05, 12), "allow_redirects": False}
    try:
        if work["kind"] == "submit":
            body = {"video_url": work["video_url"], "product_id": work["product_id"], "channel": work["channel"],
                    "brand": "WIS", "business_unit": "品牌营销部"}
            if callback:
                body["callback_url"] = callback + "/" + work["capability"]
            response = requests.post(base + "/audit/submit", json=body, **kwargs)
        elif work["kind"] == "feedback":
            response = requests.post(base + "/audit/feedback", json={"task_id": work["key"], "verdict": work["verdict"], "reason": work["reason"], "source": "wis-video-center"}, **kwargs)
        else:
            response = requests.get(base + "/audit/result", params={"task_id": work["key"]}, **kwargs)
        status = response.status_code
        if status == 429:
            try:
                retry_after = max(30, min(3600, int(response.headers.get("Retry-After", "30"))))
            except (ValueError, TypeError):
                retry_after = 30
            return None, "rate_limited", retry_after
        if status in {401, 403}:
            return None, "authorization_failed", 300
        if status == 404:
            return None, "remote_task_not_found", 300
        if status == 400:
            return None, "validation_failed", 300
        if status not in ({200, 202} if work["kind"] == "submit" else {200}):
            return None, "remote_unavailable", 30
        envelope = response.json()
        data = envelope.get("data") if isinstance(envelope, dict) and envelope.get("ok") is True else None
        if not isinstance(data, dict):
            return None, "invalid_response", 30
        task_id = data.get("task_id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", task_id):
            return None, "invalid_response", 30
        if work["kind"] != "submit" and task_id != work["key"]:
            return None, "task_mismatch", 30
        if work["kind"] == "result":
            if data.get("status") == "failed":
                data = {**data, "ready": False}
            if data.get("status") not in VALID_STATUSES or data.get("verdict", "unknown") not in VALID_VERDICTS or not isinstance(data.get("ready"), bool):
                return None, "invalid_response", 30
            if data["ready"] and (not isinstance(data.get("findings"), list) or data.get("findings_truncated") is True):
                return None, "incomplete_result", 30
            if data["ready"] and any(not isinstance(finding, dict) for finding in data["findings"]):
                return None, "invalid_response", 30
        if work["kind"] == "feedback" and data.get("verdict") != work["verdict"]:
            return None, "invalid_feedback_response", 30
        return data, "", 0
    except requests.Timeout:
        return None, "network_timeout", 30
    except (requests.RequestException, ValueError, TypeError):
        # Exception messages may contain a bearer token or presigned URL.
        return None, "network_or_protocol_error", 30


def _store(session_factory, work: dict, data: dict | None, error: str, retry_after: int) -> None:
    now = datetime.utcnow()
    with session_factory() as db:
        model = CompanyAuditJob if work["kind"] == "submit" else CompanyAuditRemoteTask
        key_column = CompanyAuditJob.id if model is CompanyAuditJob else CompanyAuditRemoteTask.task_id
        # Acquire a write lock using the lease token before reading mutable
        # revisions. This fences expired leases and concurrent callback writes.
        fenced = db.execute(update(model).where(key_column == work["key"], model.lease_token == work["lease"]).values(updated_at=now))
        if fenced.rowcount != 1:
            db.rollback()
            return
        row = db.get(model, work["key"])
        if not row or row.lease_token != work["lease"]:
            return  # An expired/stolen lease cannot overwrite a newer result.
        if error:
            row.attempts += 1
            row.error_code = error
            delay = max(retry_after, min(3600, 30 * 2 ** min(row.attempts - 1, 7)))
            row.next_attempt_at = now + timedelta(seconds=delay)
            if work["kind"] == "feedback":
                feedback = db.get(CompanyAuditFeedback, work["feedback_id"])
                if feedback:
                    feedback.attempts += 1
                    feedback.error_code = error
                    feedback.status = "verify_after_uncertain" if row.latest_feedback_id == feedback.id else "superseded"
                    if row.latest_feedback_id == feedback.id:
                        row.latest_feedback_status = feedback.status
            elif work["kind"] == "submit":
                row.status = "retry_wait"
        elif work["kind"] == "submit":
            remote = db.get(CompanyAuditRemoteTask, data["task_id"])
            if not remote:
                try:
                    with db.begin_nested():
                        remote = CompanyAuditRemoteTask(task_id=data["task_id"])
                        db.add(remote)
                        db.flush()
                except IntegrityError:
                    remote = db.get(CompanyAuditRemoteTask, data["task_id"])
            # Even duplicated=true never trusts /submit as a full result.
            row.task_id = data["task_id"]
            row.status = "submitted"
            row.error_code = ""
            row.attempts = 0
            db.execute(update(CompanyAuditRemoteTask).where(CompanyAuditRemoteTask.task_id == remote.task_id).values(
                requested_revision=CompanyAuditRemoteTask.requested_revision + 1, next_attempt_at=now))
            if row.pending_feedback_id:
                feedback = db.get(CompanyAuditFeedback, row.pending_feedback_id)
                feedback.task_id = remote.task_id
                # A task may already have a newer decision from another linked
                # submission. Never overwrite it with an older deferred intent.
                if not remote.latest_feedback_id or feedback.id > remote.latest_feedback_id:
                    remote.latest_feedback_id = feedback.id
                    remote.latest_feedback_status = feedback.status
                    remote.latest_feedback_verdict = feedback.verdict
                    remote.latest_feedback_has_reason = bool(feedback.reason)
                else:
                    feedback.status = "superseded"
        elif work["kind"] == "feedback":
            feedback = db.get(CompanyAuditFeedback, work["feedback_id"])
            feedback.response = data
            feedback.acknowledged_at = now
            feedback.error_code = ""
            feedback.status = "awaiting_readback" if row.latest_feedback_id == feedback.id else "superseded"
            if row.latest_feedback_id == feedback.id:
                row.latest_feedback_status = "awaiting_readback"
            row.error_code = ""
            row.attempts = 0
            row.next_attempt_at = now
        else:
            row.status = data["status"]
            row.verdict = data.get("verdict", "unknown")
            row.ready = data["ready"]
            row.raw_result = data  # Full original evidence, including shadow and signed frame URLs.
            row.result_revision += 1
            row.verified_revision = work["revision"]
            row.last_verified_at = now
            row.error_code = ""
            row.attempts = 0
            feedback = db.get(CompanyAuditFeedback, row.latest_feedback_id) if row.latest_feedback_id else None
            if feedback and feedback.status in {"awaiting_readback", "verify_after_uncertain"} and row.ready and row.status == "success" and row.verdict == feedback.verdict:
                feedback.status = "confirmed"
                feedback.confirmed_at = now
                row.latest_feedback_status = "confirmed"
            elif feedback and feedback.status in {"waiting_result", "verify_before_send", "verify_after_uncertain", "ready_to_send"} and row.ready and row.status == "success":
                if feedback.basis_hash and feedback.basis_hash != _basis(data):
                    feedback.status = "conflict"
                    feedback.error_code = "authority_changed_before_feedback"
                else:
                    feedback.basis_hash = _basis(data)
                    feedback.base_result_revision = row.result_revision
                    feedback.expected_request_revision = work["revision"]
                    feedback.status = "ready_to_send"
                row.latest_feedback_status = feedback.status
            elif feedback and feedback.status == "awaiting_readback" and row.ready and row.status == "success" and feedback.basis_hash != _basis(data):
                feedback.status = "conflict"
                feedback.error_code = "authority_changed_after_feedback"
                row.latest_feedback_status = "conflict"
            elif feedback and feedback.status == "confirmed" and row.verdict != feedback.verdict:
                feedback.status = "conflict"
                row.latest_feedback_status = "conflict"
            interval = COMPLETE_POLL_SECONDS if row.ready and row.status == "success" else POLL_SECONDS
            if feedback and feedback.status == "awaiting_readback":
                interval = POLL_SECONDS
            if feedback and feedback.status == "ready_to_send":
                interval = 0
            row.next_attempt_at = now if row.requested_revision != work["revision"] else now + timedelta(seconds=interval)
        row.lease_token = ""
        row.lease_until = None
        row.updated_at = now
        db.commit()


def worker_tick(session_factory) -> bool:
    """Claim at most one request, close DB, use network, then fence/store result.

    Returns whether work was claimed, for a caller-controlled background loop.
    Crashes after submit are safe: the same saved URL reuses the company task.
    Crashes after feedback retry the same desired verdict, followed by GET.
    """
    work = _claim(session_factory)
    if not work:
        return False
    if work["kind"] == "submit":
        with session_factory() as db:
            if not enabled(db):
                db.execute(update(CompanyAuditJob).where(CompanyAuditJob.id == work["key"],
                    CompanyAuditJob.lease_token == work["lease"]).values(lease_token="", lease_until=None))
                db.commit()
                return False
    data, error, retry_after = _request(work)
    _store(session_factory, work, data, error, retry_after)
    return True
