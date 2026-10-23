"""Durable delivery diagnostics in the existing receipt JSON (no schema change)."""
import math
from datetime import datetime


def timestamp(value=None):
    return (value or datetime.utcnow()).isoformat() + 'Z'


def metric_number(value):
    if value is None or isinstance(value, bool) or isinstance(value, str) and not value.strip():
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def identity(task):
    return {'asset_id': task.asset_id, 'advertiser_id': task.advertiser_id,
            'plan_id': task.plan_id, 'video_id': task.platform_asset_id or ''}


def record_failure(task, error, stage, stat_date=None):
    evidence = dict(task.binding_evidence or {})
    diagnostics = dict(evidence.get('diagnostics') or {})
    entry = {**identity(task), 'at': timestamp(), 'stage': stage, 'stat_date': str(stat_date or ''),
             'message': str(error)[:2000], 'code': str(getattr(error, 'code', '') or ''),
             'request_id': str(getattr(error, 'request_id', '') or '')}
    diagnostics['last_failure'] = entry
    diagnostics['failures'] = [*(diagnostics.get('failures') or []), entry][-50:]
    evidence['diagnostics'] = diagnostics
    task.binding_evidence = evidence


def record_success(task, scope, at=None, stat_date=None):
    evidence = dict(task.binding_evidence or {})
    diagnostics = dict(evidence.get('diagnostics') or {})
    diagnostics['last_' + scope + '_success'] = {**identity(task), 'at': timestamp(at), 'stat_date': str(stat_date or '')}
    evidence['diagnostics'] = diagnostics
    task.binding_evidence = evidence


def output(task, summary):
    diagnostics = (task.binding_evidence or {}).get('diagnostics') or {}
    failed_at = (diagnostics.get('last_failure') or {}).get('at')
    def current_success(scope):
        entry = diagnostics.get('last_' + scope + '_success') or {}
        return entry.get('at') if all(entry.get(key) == value for key, value in identity(task).items()) else None
    delivery = current_success('delivery')
    if not delivery and task.binding_verified_at:
        delivery = timestamp(task.binding_verified_at)
    metrics = current_success('metrics') or summary.get('last_success_at')
    successes = [value for value in (delivery, metrics) if value]
    return {'platform': 'qianchuan', 'platform_name': '巨量千川', 'failed_at': failed_at,
            'last_success_at': max(successes) if successes else None,
            'last_delivery_success_at': delivery, 'last_metrics_success_at': metrics,
            'last_failure': diagnostics.get('last_failure'), 'failure_history': diagnostics.get('failures') or [],
            'submission_rejected': bool((task.binding_evidence or {}).get('submission_rejected'))}
