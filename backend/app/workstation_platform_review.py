"""Bounded native GET readback for already-bound automatic remix videos.

This refresh never uploads, retries a delivery, changes a plan or its budget.
The original binding receipt is retained. Current native audit eligibility is
stored separately so a historical binding is not counted as a current delivery.
"""
from datetime import datetime, timedelta

from sqlalchemy import or_, select

from .models import Asset, QianchuanDelivery, WorkstationReturn
from .platform_audit import material_audit_receipt
from .workstation_basic_review import read_basic_review


SOURCE = "qianchuan/uni_promotion/ad/material/get"
PENDING_SECONDS = 120
PASS_SECONDS = 6 * 60 * 60
TERMINAL_SECONDS = 24 * 60 * 60


def _stamp(value):
    return value.isoformat() + "Z"


def _receipt(evidence, task, now):
    if (not isinstance(evidence, dict) or evidence.get("query_complete") is not True
            or evidence.get("readback_source") != SOURCE
            or any(str(evidence.get(key) or "") != str(getattr(task, field) or "")
                   for key, field in (("advertiser_id", "advertiser_id"), ("plan_id", "plan_id"), ("video_id", "platform_asset_id")))):
        return None
    matches = evidence.get("matches")
    if not isinstance(matches, list) or not matches or any(not isinstance(row, dict) or str(row.get("video_id") or "") != str(task.platform_asset_id) for row in matches):
        return None
    receipt = material_audit_receipt(matches, task.platform_asset_id, str(evidence.get("request_id") or ""))
    if not receipt:
        return None
    return {**receipt, "read_at": _stamp(now), "advertiser_id": str(task.advertiser_id),
            "plan_id": str(task.plan_id), "current_verified": True}


def refresh_workstation_platform_reviews(sessions, service, *, now=None, limit=4):
    """Run under the caller's existing metrics lane; at most four native reads."""
    current = now or datetime.utcnow()
    maximum = max(1, min(int(limit), 4))
    result = {"status": "completed", "reads": 0, "updated": 0, "not_eligible": 0}
    with sessions() as db:
        due = QianchuanDelivery.binding_evidence["workstation_platform_review"]["next_check_at"].as_string()
        rows = list(db.scalars(select(QianchuanDelivery)
            .join(Asset, QianchuanDelivery.asset_id == Asset.id)
            .join(WorkstationReturn, WorkstationReturn.asset_id == Asset.id)
            .where(QianchuanDelivery.deleted_at.is_(None), QianchuanDelivery.binding_verified_at.is_not(None),
                   QianchuanDelivery.platform_asset_id != "", QianchuanDelivery.plan_id != "",
                   QianchuanDelivery.plan_type.in_(["multiplication", "full_domain"]),
                   QianchuanDelivery.status.in_(["success", "partial"]),
                   QianchuanDelivery.idempotency_key.like("wis-remix:%"),
                   Asset.source == "wis_remix_workstation", Asset.library_type == "remix",
                   WorkstationReturn.status == "completed",
                   WorkstationReturn.provenance["automatic_review_enabled"].as_boolean().is_(True),
                   or_(due.is_(None), due <= _stamp(current)))
            .order_by(QianchuanDelivery.updated_at.asc(), QianchuanDelivery.id).limit(100)).unique())
        for task in rows:
            if result["reads"] >= maximum:
                break
            asset = db.get(Asset, task.asset_id)
            basic = read_basic_review(db, asset)
            old = dict(task.binding_evidence or {})
            state = dict(old.get("workstation_platform_review") or {})
            if not basic or not basic.get("dispatch_allowed") or basic.get("actor_number") != task.created_by_number:
                task.binding_evidence = {**old, "workstation_platform_review": {
                    "status": "not_eligible", "checked_at": _stamp(current),
                    "next_check_at": _stamp(current + timedelta(seconds=PASS_SECONDS)),
                    "message": "当前成片基础技术审核或制作人绑定未通过，未请求平台。"}}
                db.commit()
                result["not_eligible"] += 1
                continue
            # Persist a bounded read lease before GET; a process restart waits
            # the same interval rather than immediately duplicating a request.
            task.binding_evidence = {**old, "workstation_platform_review": {
                **state, "status": "checking", "checked_at": _stamp(current),
                "next_check_at": _stamp(current + timedelta(seconds=PENDING_SECONDS))}}
            identity = (task.asset_id, task.created_by_number, task.advertiser_id, task.plan_id, task.platform_asset_id)
            db.commit()
            result["reads"] += 1
            receipt = None
            error_code = ""
            try:
                evidence = service.plan_video_evidence(db, advertiser_id=identity[2],
                    plan_id=identity[3], video_id=identity[4])
                receipt = _receipt(evidence, task, current)
            except Exception as error:
                error_code = str(getattr(error, "category", "readback_unavailable"))[:80]
            # Re-read after native IO, preserving concurrent cancellation and
            # never applying another asset/plan/video's result to this task.
            db.refresh(task)
            if task.deleted_at is not None or task.status not in {"success", "partial"} or identity != (
                    task.asset_id, task.created_by_number, task.advertiser_id, task.plan_id, task.platform_asset_id):
                continue
            previous = (task.binding_evidence or {}).get("platform_audit")
            attempts = int(state.get("attempts") or 0) + 1
            if receipt is None:
                receipt = {"status": "UNKNOWN", "material_status": "UNKNOWN", "raw_statuses": [],
                    "material_statuses": [], "reasons": [], "video_id": task.platform_asset_id,
                    "advertiser_id": task.advertiser_id, "plan_id": task.plan_id,
                    "source": SOURCE, "read_at": _stamp(current), "current_verified": False,
                    "localization": "not_provided", "segments": []}
            deleted = receipt.get("material_status") == "DELETED"
            rejected = receipt.get("status") == "REJECT"
            passed = receipt.get("status") == "PASS" and receipt.get("material_status") == "DELIVERY_OK"
            interval = TERMINAL_SECONDS if deleted or rejected else PASS_SECONDS if passed else min(900, PENDING_SECONDS * (2 ** min(attempts - 1, 3)))
            new_state = {"status": "verified" if receipt["current_verified"] else "pending",
                "checked_at": _stamp(current), "next_check_at": _stamp(current + timedelta(seconds=interval)),
                "attempts": 0 if deleted or rejected or passed else attempts, "error_code": error_code}
            task.binding_evidence = {**(task.binding_evidence or {}),
                **({"previous_platform_audit": previous} if previous else {}),
                "platform_audit": receipt, "workstation_platform_review": new_state}
            if deleted or rejected:
                task.status = "partial"
                task.last_error_category = "plan_material_removed" if deleted else "platform_audit_rejected"
                task.failure_stage = "platform_review"
                task.message = "千川已将素材移除，保留原记录并等待自动补片。" if deleted else "千川审核未通过，保留原记录并等待自动补片。"
            task.updated_at = current
            db.commit()
            result["updated"] += 1
    return result
