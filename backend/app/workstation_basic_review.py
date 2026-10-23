"""Basic technical approval for service-verified automatic remix returns only.

The company's original audit rows remain unchanged and visible. This policy is
not an override verdict: it selects a different workflow for authenticated
workstation returns whose current file and technical receipt still match.
"""
from __future__ import annotations

import math
import re


POLICY = "automatic_remix_basic_v1"
REQUIRED_CHECKS = frozenset({
    "文件可播放", "竖版规格", "音轨", "时长完整", "黑屏占比", "目标时长",
    "静音占比", "框架完整度", "重复成片", "切片不重复", "产品分类一致",
})


def _sha(value):
    return value.lower() if isinstance(value, str) and re.fullmatch(r"[a-fA-F0-9]{64}", value) else ""


def technical_assessment_passed(provenance):
    """Accept the worker's complete technical receipt, never a client flag."""
    if not isinstance(provenance, dict) or provenance.get("automatic_review_enabled") is not True:
        return False
    if provenance.get("workstation_type", "remix") != "remix" or provenance.get("review_status") != "approved":
        return False
    assessment = provenance.get("automatic_assessment")
    if not isinstance(assessment, dict):
        return False
    score = assessment.get("score")
    checks = assessment.get("checks")
    if (assessment.get("status") != "passed" or assessment.get("recommendation") != "approve"
            or assessment.get("autoApproved") is not True or type(score) not in (int, float)
            or not math.isfinite(score) or score < 90 or score > 100
            or not isinstance(checks, list) or not checks
            or any(not isinstance(check, dict) or not isinstance(check.get("name"), str) for check in checks)):
        return False
    by_name = {check["name"]: check for check in checks}
    if len(by_name) != len(checks) or any(by_name.get(name, {}).get("passed") is not True for name in REQUIRED_CHECKS):
        return False
    policy = provenance.get("review_policy")
    if policy not in (None, "", POLICY):
        return False
    if policy == POLICY:
        return bool(assessment.get("mode") == "basic_rules" and assessment.get("ruleVersion") == POLICY
                    and _sha(assessment.get("outputSha256"))
                    and _sha(assessment.get("outputSha256")) == _sha(provenance.get("sha256"))
                    and all(check.get("passed") is True for check in checks))
    # Prior server-created returns predate this field. They already passed the
    # full automatic technical review before their immutable OSS return.
    return bool(all(check.get("passed") is True for check in checks)
                and assessment.get("mode") in {"rules", "rules_and_visual"})


def automatic_return_scope(record, asset):
    provenance = record.provenance if record and isinstance(record.provenance, dict) else {}
    return bool(record and asset and asset.source == "wis_remix_workstation"
                and asset.library_type == "remix" and asset.media_type == "video"
                and provenance.get("workstation_type", "remix") == "remix"
                and provenance.get("automatic_review_enabled") is True)


def completed_return_matches(record, asset):
    if not automatic_return_scope(record, asset):
        return False
    provenance = record.provenance
    maker = str(provenance.get("maker_id") or "").strip()
    render = str(provenance.get("render_id") or "").strip()
    variant = str(provenance.get("variant_id") or "").strip()
    file_hash = _sha(record.sha256)
    return bool(maker and render and variant and file_hash
                and record.status == "completed" and record.completed_at is not None
                and record.asset_id == asset.id and asset.deleted_at is None and asset.purged_at is None
                and record.object_key == asset.object_key and record.filename == asset.filename
                and "自动混剪" in asset.filename and record.file_size == asset.size and asset.size > 0
                and provenance.get("size") == asset.size and _sha(provenance.get("sha256")) == file_hash
                and provenance.get("category") == asset.category
                and maker == asset.uploaded_by_number
                and record.idempotency_key == f"wis-remix:{render}:{variant}:{file_hash[:16]}"
                and asset.reference_url == f"wis-remix://render/{render}/variant/{variant}")


def project_basic_review(record, asset, submission):
    """Pure policy projection. Failed technical/current binding never approves."""
    if not automatic_return_scope(record, asset):
        return None
    provenance = record.provenance
    approved = bool(completed_return_matches(record, asset) and technical_assessment_passed(provenance)
                    and submission and submission.asset_id == asset.id
                    and submission.assignment_mode == "automatic_workstation"
                    and submission.status in {"approved", "pending"}
                    and submission.filename_snapshot == asset.filename
                    and submission.submitted_by_number == provenance.get("maker_id"))
    return {
        "policy": POLICY, "status": "approved" if approved else "blocked",
        "current_verified": approved, "dispatch_allowed": approved,
        "manual_review_required": False, "company_review_required": False,
        "asset_id": asset.id, "return_sha256": _sha(record.sha256),
        "actor_number": str(provenance.get("maker_id") or ""),
        "render_id": str(provenance.get("render_id") or ""),
        "variant_id": str(provenance.get("variant_id") or ""),
        "submission_id": submission.id if submission else None,
        "message": "自动混剪基础技术审核通过，无需人工复核。" if approved else "自动混剪基础技术审核或当前文件核验未通过，等待系统修复。",
    }


def read_basic_review(db, asset, submission=None, record=None):
    from sqlalchemy import select
    from .models import AssetReviewSubmission, WorkstationReturn
    if not asset or asset.source != "wis_remix_workstation" or asset.library_type != "remix":
        return None
    with db.no_autoflush:
        if record is None:
            record = db.scalar(select(WorkstationReturn).where(WorkstationReturn.asset_id == asset.id)
                               .order_by(WorkstationReturn.created_at.desc()).limit(1)
                               .execution_options(populate_existing=True))
        latest = db.scalar(select(AssetReviewSubmission).where(AssetReviewSubmission.asset_id == asset.id)
                           .order_by(AssetReviewSubmission.version.desc()).limit(1)
                           .execution_options(populate_existing=True))
        if submission is not None and (latest is None or latest.id != submission.id):
            return project_basic_review(record, asset, None)
        submission = latest
        return project_basic_review(record, asset, submission)
