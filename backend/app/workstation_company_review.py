"""Read-only, least-data company result for an already owner-bound return.

This is evidence for locating a rejection, NOT an approval or dispatch gate.
No worker tick, request, flush, enqueue, callback, or result mutation occurs here.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone


def _sha(value):
    return value.lower() if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value) else ""


def _text(value, limit=8000):
    if not isinstance(value, str):
        return ""
    # Never expose a signed evidence URL, callback capability, or credential.
    value = re.sub(r"(?:https?://|data:)[^\s<>\"']+", "[链接已隐藏]", value, flags=re.I)
    value = re.sub(r"(?i)bearer\s+[^\s,;]+", "Bearer [已隐藏]", value)
    value = re.sub(r"(?i)(?:token|secret|signature|authorization|api[_-]?key|password|credential|capability)\s*[:=]\s*[^\s,;]+", "[凭据已隐藏]", value)
    return value[:limit]


def _number(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def _finding(value):
    result = {key: _text(value[key]) for key in ("rule_code", "rule_name", "tier", "severity", "evidence") if isinstance(value.get(key), str)}
    for key in ("time_start_ms", "time_end_ms", "confidence"):
        if key in value:
            result[key] = _number(value[key])
    # Preserve shadow observations. They must never become actionable findings.
    result["shadow"] = value.get("shadow") if type(value.get("shadow")) is bool else None
    return result


def _positive_int(value):
    return type(value) is int and value > 0


def project_company_review(record, asset, submission, job, *, actor_number, render_id, variant_id,
                           snapshot_matches, complete_poll_seconds, gate_allowed=None, now=None):
    """Pure projection of persisted rows; absence/staleness is never a pass."""
    provenance = record.provenance if record and isinstance(record.provenance, dict) else {}
    if not record or not asset or not submission or not job:
        return None
    if not actor_number or not render_id or not variant_id or any(
        provenance.get(key) != expected for key, expected in (
            ("maker_id", actor_number), ("render_id", render_id), ("variant_id", variant_id)
        )
    ):
        return None
    if (record.asset_id != asset.id or submission.asset_id != asset.id or job.asset_id != asset.id
            or job.submission_id != submission.id or job.version != submission.version
            or asset.deleted_at is not None or asset.purged_at is not None):
        return None
    if record.status != "completed" or record.object_key != asset.object_key or record.file_size != asset.size:
        # An old return owner must not receive findings for replacement asset bytes.
        return None
    task = job.remote_task
    raw = task.raw_result if task and isinstance(task.raw_result, dict) else {}
    findings = raw.get("findings")
    complete = isinstance(findings, list) and len(findings) <= 1000 and all(isinstance(item, dict) for item in findings) and raw.get("findings_truncated") is not True
    projected = [_finding(item) for item in findings[:1000] if isinstance(item, dict)] if isinstance(findings, list) else []
    file_hash = _sha(raw.get("file_hash"))
    return_sha = _sha(record.sha256)
    current_time = now or datetime.utcnow()
    checked = task.last_verified_at if task else None
    if isinstance(checked, datetime) and checked.tzinfo is not None:
        checked = checked.astimezone(timezone.utc).replace(tzinfo=None)
    if current_time.tzinfo is not None:
        current_time = current_time.astimezone(timezone.utc).replace(tzinfo=None)
    fresh = bool(isinstance(checked, datetime) and timedelta(0) <= current_time - checked <= timedelta(seconds=complete_poll_seconds * 2))
    error = (task.error_code if task else "") or job.error_code or ""
    bound = bool(record.status == "completed" and record.object_key == asset.object_key
                 and record.file_size == asset.size and return_sha and file_hash == return_sha)
    current = bool(task and bound and snapshot_matches is True and fresh and not error
                   and job.task_id == task.task_id == raw.get("task_id")
                   and _positive_int(task.requested_revision) and task.requested_revision == task.verified_revision
                   and _positive_int(task.result_revision)
                   and task.status == raw.get("status") == "success" and task.ready is True and raw.get("ready") is True
                   and task.verdict == raw.get("verdict") and task.verdict in {"pass", "reject", "manual_required", "unknown"}
                   and (not raw.get("product_id") or raw.get("product_id") == job.product_id)
                   and (not task.latest_feedback_status or task.latest_feedback_status == "confirmed")
                   and (task.verdict != "pass" or gate_allowed is True)
                   and complete)
    return {
        "asset_id": asset.id, "return_sha256": return_sha,
        "actor_number": actor_number, "render_id": render_id, "variant_id": variant_id,
        "submission_id": submission.id, "job_id": job.id,
        "task_id": _text(task.task_id, 160) if task else None,
        "status": _text(task.status if task else job.status, 30),
        "ready": task.ready is True if task else False,
        "verdict": _text(task.verdict, 30) if task else "unknown",
        "error_code": _text(error, 60),
        "requested_revision": task.requested_revision if task else None,
        "verified_revision": task.verified_revision if task else None,
        "result_revision": task.result_revision if task else None,
        "last_verified_at": checked.isoformat() + "Z" if isinstance(checked, datetime) else None,
        "snapshot_matches": snapshot_matches is True,
        "current_verified": current,
        "gate_allowed": gate_allowed is True,
        "file_hash": file_hash, "duration_ms": _number(raw.get("duration_ms")),
        "rule_version": _text(raw.get("rule_version"), 160),
        "findings_complete": complete, "findings": projected,
    }


def read_company_review(db, record, asset, *, actor_number, render_id, variant_id):
    # Local imports keep the pure projection independently testable. The existing
    # get_for_submission() flushes; this read endpoint deliberately does not call it.
    from sqlalchemy import select
    from .models import AssetReviewSubmission
    from .company_audit import CompanyAuditJob, COMPLETE_POLL_SECONDS, _snapshot_matches, _gate_job
    with db.no_autoflush:
        latest = db.scalar(select(AssetReviewSubmission)
                           .where(AssetReviewSubmission.asset_id == asset.id)
                           .order_by(AssetReviewSubmission.version.desc()).limit(1)
                           .execution_options(populate_existing=True))
        if latest is None:
            return None
        job = db.scalar(select(CompanyAuditJob)
                        .where(CompanyAuditJob.submission_id == latest.id,
                               CompanyAuditJob.asset_id == asset.id,
                               CompanyAuditJob.version == latest.version)
                        .execution_options(populate_existing=True))
        if job is None:
            return None
        return project_company_review(record, asset, latest, job, actor_number=actor_number,
                                      render_id=render_id, variant_id=variant_id,
                                      snapshot_matches=_snapshot_matches(job),
                                      gate_allowed=_gate_job(job)[0],
                                      complete_poll_seconds=COMPLETE_POLL_SECONDS)
