"""Durable, bounded recovery for an already-authorized delivery.

State lives in the existing receipt JSON; no queue/database migration is needed.
Only known transient stages are scheduled. A platform write checkpoint must be
reconciled, never replayed just because its response was delayed.
"""
from datetime import datetime, timedelta, timezone

KEY = "_recovery"
MAX_ATTEMPTS = 6
MAX_AGE_SECONDS = 1800
TRANSIENT = {
    "qianchuan": {"rate_limit", "plan_verification_pending", "video_detail_pending", "oss_read"},
    "adq": {"rate_limit", "upload_verification_pending", "library_readback_pending", "shared_visibility_pending", "binding_verification_pending"},
}
CHECKPOINT_TRANSIENT = {"connect_timeout", "read_timeout", "connection_interrupted", "network", "invalid_response", "platform_http"}


def stamp(value):
    return value.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"


def parse(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, TypeError, AttributeError):
        return None


def receipt(task):
    return dict(task.binding_evidence or {})


def set_state(task, state):
    evidence = receipt(task)
    evidence[KEY] = state
    task.binding_evidence = evidence


def schedule(task, error, platform, now=None):
    now = now or datetime.utcnow()
    category = str(getattr(error, "category", ""))
    resumable_transport = ((category in CHECKPOINT_TRANSIENT or category == "platform" and getattr(error, "retryable", False))
                           and bool(task.platform_asset_id or getattr(task, "upload_task_id", "")))
    if task.status not in {"failed", "partial"} or not (category in TRANSIENT[platform] or resumable_transport):
        finish(task, "blocked", now)
        return False
    state = dict(receipt(task).get(KEY) or {})
    first = parse(state.get("started_at")) or now
    attempts = int(state.get("attempts") or 0)
    if attempts >= MAX_ATTEMPTS or (now - first).total_seconds() >= MAX_AGE_SECONDS:
        state.update(state="exhausted", next_at="", stopped_at=stamp(now), category=category)
        set_state(task, state)
        task.error_advice = (task.error_advice or "") + " 自动恢复已达到上限；原视频及回执保留，请检查平台状态后重试原任务。"
        return False
    delay = min(300, 10 * (2 ** attempts))
    state.update(state="waiting", started_at=stamp(first), next_at=stamp(now + timedelta(seconds=delay)),
                 attempts=attempts, category=category)
    set_state(task, state)
    task.error_advice = (task.error_advice or "") + f" 系统将在约{delay}秒后自动续查原任务，最多{MAX_ATTEMPTS}次；无需重新上传。"
    return True


def due(task, now=None):
    now = now or datetime.utcnow()
    state = receipt(task).get(KEY) or {}
    deadline = parse(state.get("next_at"))
    first = parse(state.get("started_at"))
    return bool(state.get("state") == "waiting" and deadline and first and deadline <= now
                and int(state.get("attempts") or 0) < MAX_ATTEMPTS
                and (now - first).total_seconds() < MAX_AGE_SECONDS)


def claim(task, now=None):
    now = now or datetime.utcnow()
    if not due(task, now):
        return False
    state = dict(receipt(task)[KEY])
    state.update(state="running", attempts=int(state.get("attempts") or 0) + 1, next_at="", claimed_at=stamp(now))
    set_state(task, state)
    return True


def finish(task, outcome="completed", now=None):
    state = dict(receipt(task).get(KEY) or {})
    if not state:
        return
    state.update(state=outcome, next_at="", stopped_at=stamp(now or datetime.utcnow()))
    set_state(task, state)


def reset(task):
    evidence = receipt(task)
    evidence.pop(KEY, None)
    task.binding_evidence = evidence


def query(model, now=None):
    """Both MySQL and SQLite support these SQLAlchemy JSON string selectors."""
    from sqlalchemy import and_
    now = now or datetime.utcnow()
    return and_(model.status.in_({"failed", "partial"}),
                model.binding_evidence[KEY]["state"].as_string() == "waiting",
                model.binding_evidence[KEY]["next_at"].as_string() <= stamp(now))
