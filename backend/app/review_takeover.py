"""Timed human takeover policy and durable per-submission receipts.
Uses AppMeta JSON, scoped by business library. Company jobs are never cancelled.
"""
import json
from datetime import datetime, timedelta
from fastapi import HTTPException
from sqlalchemy import select
from .models import AppMeta, Asset, AssetReviewSubmission, AssetReviewDecision

CONFIG_KEY = 'review_timed_takeover_config_v1'
def config(db):
    row = db.get(AppMeta, CONFIG_KEY)
    value = json.loads(row.value) if row else {}
    return {'enabled': value.get('enabled') is True, 'minutes': int(value.get('minutes', 60))}

def save_config(db, enabled, minutes, actor):
    previous = config(db)
    enabled = previous['enabled'] if enabled is None else enabled
    minutes = previous['minutes'] if minutes is None else minutes
    if type(enabled) is not bool or type(minutes) is not int or not 1 <= minutes <= 10080:
        raise HTTPException(400, '接管等待时长须为1至10080的整数分钟')
    row = db.get(AppMeta, CONFIG_KEY)
    if not row:
        row = AppMeta(key=CONFIG_KEY, value='{}'); db.add(row)
    row.value = json.dumps({'enabled': enabled, 'minutes': minutes, 'updated_by': actor,
        'updated_at': datetime.utcnow().isoformat()+'Z'}, ensure_ascii=False)

def receipt_prefix():
    from .remix_business import _namespace
    return 'review_takeover:' + _namespace.get() + ':'

def receipt(db, sid):
    row = db.get(AppMeta, receipt_prefix()+sid)
    return json.loads(row.value) if row else None

def snapshot(asset, item):
    return {'asset_id': asset.id, 'object_key': asset.object_key, 'etag': asset.etag or '',
        'size': asset.size or 0, 'category': asset.category or '', 'filename': asset.filename,
        'version': item.version}

def matching(db, item, asset, record=None):
    record = receipt(db, item.id) if record is None else record
    return bool(record and record.get('snapshot') == snapshot(asset, item)
        and not asset.deleted_at and not asset.purged_at)

def active(db, item, asset):
    return matching(db, item, asset)

def gate(db, job, channel=''):
    """None preserves the original company gate. A claimed task never auto-passes."""
    if job is None:
        return None
    item = db.get(AssetReviewSubmission, job.submission_id)
    record = receipt(db, job.submission_id)
    if not record:
        return None
    if not item or not matching(db, item, job.asset, record):
        return False, '人工接管对应素材已变更，请重新送审'
    if channel and job.channel and channel != job.channel:
        return False, '人工接管渠道与实际投放渠道不一致，请重新送审'
    decisions = db.scalars(select(AssetReviewDecision).where(AssetReviewDecision.submission_id == item.id)).all()
    if item.status == 'rejected':
        return False, '人工接管审核未通过'
    if item.status != 'approved' or not decisions or any(d.status != 'approved' for d in decisions):
        return False, '已转人工接管，等待全部人工审核通过'
    return True, '超时人工接管审核已通过，公司任务继续保留'

def state(db, item, asset, user=None):
    from . import main as m, company_audit
    settings = config(db)
    record = receipt(db, item.id)
    job = company_audit.get_for_submission(db, item.id)
    deadline = (job.created_at + timedelta(minutes=settings['minutes'])) if job and job.created_at else None
    is_active = bool(record and matching(db, item, asset, record))
    task = job.remote_task if job else None
    # A completed company verdict is handled by the existing red/yellow review path.
    final = bool(task and task.status == 'success' and task.ready and task.verdict in {'pass','reject','manual_required'})
    eligible = bool(settings['enabled'] and company_audit.enabled(db) and job and not final
        and item.status == 'pending' and deadline and datetime.utcnow() >= deadline
        and company_audit._snapshot_matches(job) and not asset.deleted_at and not asset.purged_at
        and m._review_latest_submission(db, asset.id).id == item.id)
    decisions = db.scalars(select(AssetReviewDecision).where(AssetReviewDecision.submission_id == item.id)
        .order_by(AssetReviewDecision.id)).all()
    current = next((d for d in decisions if d.status == 'pending'), None)
    candidate = current
    missing = []
    if not candidate and eligible and not decisions:
        candidates = {role: m._review_role_candidates(db, role, item.route_center, item.route_group)
            for role in m.REVIEW_STAGE_ORDER}
        missing = [m.REVIEW_ROLE_LABELS[role] for role in m.REVIEW_STAGE_ORDER if not candidates[role]]
        role = m.REVIEW_STAGE_ORDER[0]
        candidate = AssetReviewDecision(role_code=role, candidate_reviewers=candidates[role], status='pending')
    permitted = bool(user and candidate and not missing and m._review_decision_allows_user(candidate, user,
        set(m._review_user_roles(db, user))))
    allowed = gate(db, job) if is_active else None
    return {'enabled': settings['enabled'], 'minutes':settings['minutes'],
        'eligible': eligible and not bool(record), 'active': is_active,
        'can_takeover': eligible and not record and permitted,
        'deadline_at': deadline.isoformat()+'Z' if deadline else None,
        'started_at': record.get('started_at') if record else None,
        'actor_name': record.get('actor_name','') if record else '',
        'dispatch_allowed': bool(allowed and allowed[0]),
        'message': allowed[1] if allowed else ('审核组织链路待配置：'+'、'.join(missing) if missing else
            '公司审核超时，可由当前审核人接管；也可继续等待公司结论' if eligible else
            '等待超时后开放人工接管' if settings['enabled'] and job and not final else '' )}

def claim(db, sid, user):
    from . import main as m
    # Serialize competing claims and decisions using the existing submission row.
    item = db.scalar(select(AssetReviewSubmission).where(AssetReviewSubmission.id == sid).with_for_update())
    if not item:
        raise HTTPException(404, '未找到该审核任务')
    asset = db.get(Asset, item.asset_id)
    from .company_audit import CompanyAuditJob, CompanyAuditRemoteTask
    job = db.scalar(select(CompanyAuditJob).where(CompanyAuditJob.submission_id == sid).with_for_update())
    if job and job.task_id:
        db.scalar(select(CompanyAuditRemoteTask).where(CompanyAuditRemoteTask.task_id == job.task_id)
            .execution_options(populate_existing=True).with_for_update())
    current_state = state(db, item, asset, user)
    if current_state['active']:
        return item
    if not current_state['eligible']:
        raise HTTPException(409, '尚未满足超时接管条件，请刷新核对公司审核状态')
    if not current_state['can_takeover']:
        raise HTTPException(403, '仅本任务当前审核人可接管；请核对审核角色与组织配置')
    decisions = db.scalars(select(AssetReviewDecision).where(AssetReviewDecision.submission_id == item.id)).all()
    if not decisions:
        for role in m.REVIEW_STAGE_ORDER:
            candidates = m._review_role_candidates(db, role, item.route_center, item.route_group)
            if not candidates:
                raise HTTPException(409, '请先配置本任务的全部人工审核角色')
            db.add(AssetReviewDecision(submission_id=item.id, role_code=role, status='pending',
                candidate_reviewers=candidates, candidate_search=' | '.join(
                    value for c in candidates for value in (c.get('user_name',''), c.get('user_number','')) if value)))
    db.add(AppMeta(key=receipt_prefix()+sid, value=json.dumps({'snapshot':snapshot(asset,item),
        'started_at':datetime.utcnow().isoformat()+'Z', 'actor_name':m.user_name(user),
        'actor_number':m.user_number(user), 'minutes':current_state['minutes'], 'outcome':'pending'},ensure_ascii=False)))
    db.flush()
    return item

def finish(db, item, actor):
    row = db.get(AppMeta, receipt_prefix()+item.id)
    if row:
        record = json.loads(row.value)
        record.update(outcome=item.status, decided_at=datetime.utcnow().isoformat()+'Z', last_reviewer=actor)
        row.value = json.dumps(record,ensure_ascii=False)
