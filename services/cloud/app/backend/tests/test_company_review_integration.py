import os
from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app.database import Base, SessionLocal, engine
from app import main, company_audit as audit
from app.models import Asset, AssetReviewSubmission, UserNotification


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setenv('COMPANY_AUDIT_ENABLED', '1')
    monkeypatch.delenv('COMPANY_AUDIT_TOKEN', raising=False)
    monkeypatch.delenv('COMPANY_AUDIT_TOKEN_FILE', raising=False)
    monkeypatch.delenv('COMPANY_AUDIT_PRODUCT_MAP_FILE', raising=False)
    Base.metadata.drop_all(engine)
    main.ensure_asset_schema()
    with SessionLocal() as session:
        yield session


def rows(db):
    asset = Asset(object_key='fixture/test.mp4', filename='fixture.mp4', media_type='video', size=1)
    db.add(asset)
    db.flush()
    submission = AssetReviewSubmission(id='fixture-submission', asset_id=asset.id, version=1,
        status='approved', assignment_mode='designated', submitted_by_number='fixture-user',
        submitted_by_name='fixture', naming_check={'status': 'passed'})
    db.add(submission)
    db.flush()
    return asset, submission


def test_enabled_missing_credential_cannot_bypass_gate(db):
    asset, submission = rows(db)
    with patch.object(main.oss_service, 'url_for', return_value='https://storage.invalid/video'):
        job = main._enqueue_company_audit(db, submission, asset)
        db.commit()
    assert job and not audit.configured()
    with pytest.raises(HTTPException) as exc:
        main._require_assets_review_approved(db, [asset])
    assert exc.value.status_code == 409
    assert '公司素材审核' in exc.value.detail


def test_unchanged_submission_reuses_exact_url_and_one_job(db):
    asset, submission = rows(db)
    with patch.object(main.oss_service, 'url_for', return_value='https://storage.invalid/video?fixed=1') as sign:
        first = main._enqueue_company_audit(db, submission, asset, '抖音')
        second = main._enqueue_company_audit(db, submission, asset, '视频号')
        assert first.id == second.id
        assert second.channel == '抖音'
        assert sign.call_count == 1


def test_approved_notice_does_not_claim_distribution_while_company_waiting(db):
    asset, submission = rows(db)
    audit.enqueue(db, submission, asset, 'https://storage.invalid/video')
    main._notify_asset_review(db, submission, asset, 'approved')
    db.flush()
    notice = db.scalar(select(UserNotification))
    assert '待公司审核确认' in notice.title
    assert '不能推送' in notice.message
    assert '可按授权继续分发' not in notice.message


def test_trusted_success_pass_opens_common_dispatch_gate(db):
    asset, submission = rows(db)
    job = audit.enqueue(db, submission, asset, 'https://storage.invalid/video')
    remote = audit.CompanyAuditRemoteTask(task_id='fixture-remote', status='success', verdict='pass',
        ready=True, raw_result={'findings': []}, requested_revision=1, verified_revision=1,
        last_verified_at=datetime.utcnow())
    db.add(remote)
    db.flush()
    job.task_id = remote.task_id
    db.commit()
    main._require_assets_review_approved(db, [asset])
    remote.verdict = 'reject'
    db.commit()
    with pytest.raises(HTTPException):
        main._require_assets_review_approved(db, [asset])
