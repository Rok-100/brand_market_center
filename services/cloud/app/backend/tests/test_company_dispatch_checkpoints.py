"""Offline integration regressions for company gates at external-write boundaries.

Use real main worker functions and durable SQL rows. Every external transport is
disabled; only explicitly mocked library readbacks may run after an audit reject.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import requests
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, company_audit as audit
from app.database import Base
from app.models import Asset, AssetReviewSubmission, AssetReviewDecision, QianchuanDelivery, AdqDelivery


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "dispatch.db"))
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setenv("COMPANY_AUDIT_ENABLED", "1")
    monkeypatch.delenv("COMPANY_AUDIT_ENFORCE_FROM", raising=False)
    monkeypatch.delenv("COMPANY_AUDIT_LEGACY_MAX_ASSET_ID", raising=False)
    monkeypatch.delenv("COMPANY_AUDIT_TOKEN", raising=False)
    monkeypatch.delenv("COMPANY_AUDIT_TOKEN_FILE", raising=False)
    monkeypatch.setenv("SUPER_ADMIN_NAMES", "fixture-super-admin")
    monkeypatch.setenv("SUPER_ADMIN_NUMBERS", "fixture-admin")
    monkeypatch.setattr(requests.sessions.Session, "request", Mock(side_effect=AssertionError("Live HTTP forbidden in offline checkpoint test")))
    monkeypatch.setattr(main.qianchuan_service, "dispatch_block_reason", Mock(return_value=""))
    methods = {
        "qc_upload": (main.qianchuan_service, "begin_video_upload"),
        "qc_readback": (main.qianchuan_service, "wait_video_upload"),
        "qc_bind": (main.qianchuan_service, "add_to_plan"),
        "adq_upload": (main.adq_service, "upload_original_video"),
        "adq_readback": (main.adq_service, "verify_video_in_library"),
        "adq_share": (main.adq_service, "grant_all_videos_to_mdm"),
        "adq_bind": (main.adq_service, "add_to_adgroup"),
    }
    mocks = {}
    for name, (service, method) in methods.items():
        mocks[name] = Mock(side_effect=AssertionError("Unexpected external operation: " + name))
        monkeypatch.setattr(service, method, mocks[name])
    yield SimpleNamespace(sessions=sessions, calls=mocks, monkeypatch=monkeypatch)
    engine.dispose()


def approved_material(ctx, channel="抖音"):
    with ctx.sessions() as db:
        asset = Asset(object_key="fixtures/dispatch-original.mp4", filename="offline-original.mp4", media_type="video", size=100, etag="offline-etag")
        db.add(asset)
        db.flush()
        submission = AssetReviewSubmission(id="fixture-submission", asset_id=asset.id, version=1, status="approved",
            submitted_by_number="fixture-owner", assignment_mode="designated", naming_check={"status": "passed"})
        db.add(submission)
        db.flush()
        job = audit.enqueue(db, submission, asset, "https://storage.invalid/fixture.mp4?signature=offline-only", channel=channel)
        remote = audit.CompanyAuditRemoteTask(task_id="fixture-official-task", status="success", verdict="pass", ready=True,
            raw_result={"status": "success", "ready": True, "verdict": "pass", "findings": []},
            requested_revision=1, verified_revision=1, result_revision=7, last_verified_at=datetime.utcnow())
        db.add(remote)
        db.flush()
        job.task_id = remote.task_id
        db.commit()
        # Establish that this material was legitimately allowed when queued.
        main._require_assets_review_approved(db, [asset], channel=channel)
        return asset.id


def company_rejects(ctx):
    with ctx.sessions() as db:
        task = db.get(audit.CompanyAuditRemoteTask, "fixture-official-task")
        task.verdict = "reject"
        task.raw_result = {"status": "success", "ready": True, "verdict": "reject", "findings": [{"rule_code": "fixture-rule", "tier": "red"}]}
        task.result_revision += 1
        task.last_verified_at = datetime.utcnow()
        db.commit()


def enqueue_qc(ctx, asset_id, platform_id="", upload_id=""):
    with ctx.sessions() as db:
        task = QianchuanDelivery(id="fixture-qc", batch_id="fixture-batch", asset_id=asset_id,
            created_by_number="fixture-owner", advertiser_id="fixture-advertiser", plan_id="fixture-plan",
            plan_type="multiplication", platform_asset_id=platform_id, upload_task_id=upload_id,
            request_id="existing-qc-request", status="pending")
        db.add(task)
        db.commit()
        return task.id


def enqueue_adq(ctx, asset_id, shared=False, platform_id=""):
    with ctx.sessions() as db:
        task = AdqDelivery(id="fixture-adq", batch_id="fixture-batch", asset_id=asset_id,
            created_by_number="fixture-owner", account_id="fixture-account",
            adgroup_id=main._ADQ_SHARED_TARGET_ID if shared else "fixture-adgroup",
            source_dynamic_creative_id="existing-template", dynamic_creative_id="existing-creative" if platform_id else "",
            platform_asset_id=platform_id, root_material_id="existing-root" if platform_id else "",
            cover_id="existing-cover" if platform_id else "", request_id="existing-adq-request", status="pending")
        db.add(task)
        db.commit()
        return task.id


def assert_no_new_adq_writes(ctx):
    for key in ("adq_upload", "adq_share", "adq_bind"):
        ctx.calls[key].assert_not_called()


def test_qianchuan_pass_then_queued_reject_prevents_initial_upload(isolated):
    asset_id = approved_material(isolated)
    delivery_id = enqueue_qc(isolated, asset_id)
    company_rejects(isolated)
    main._run_qianchuan_push_serial([delivery_id])
    for key in ("qc_upload", "qc_readback", "qc_bind"):
        isolated.calls[key].assert_not_called()
    with isolated.sessions() as db:
        row = db.get(QianchuanDelivery, delivery_id)
        assert row.status == "failed" and row.last_error_category == "company_audit_blocked"
        assert row.platform_asset_id == "" and row.upload_task_id == ""
        assert row.request_id == "existing-qc-request"


def test_qianchuan_existing_upload_readback_continues_but_new_binding_is_blocked(isolated):
    asset_id = approved_material(isolated)
    delivery_id = enqueue_qc(isolated, asset_id, upload_id="existing-upload-task")
    company_rejects(isolated)
    isolated.calls["qc_readback"].side_effect = None
    isolated.calls["qc_readback"].return_value = {"platform_asset_id": "readback-original-id", "request_id": "readback-request"}
    main._run_qianchuan_push_serial([delivery_id])
    isolated.calls["qc_upload"].assert_not_called()
    isolated.calls["qc_readback"].assert_called_once()
    isolated.calls["qc_bind"].assert_not_called()
    with isolated.sessions() as db:
        row = db.get(QianchuanDelivery, delivery_id)
        assert row.status == "partial" and row.failure_stage == "plan_binding"
        assert row.last_error_category == "company_audit_blocked"
        assert row.platform_asset_id == "readback-original-id"
        assert row.upload_task_id == "existing-upload-task"
        assert row.request_id == "readback-request"


def test_qianchuan_existing_material_ids_are_retained_without_reupload(isolated):
    asset_id = approved_material(isolated)
    delivery_id = enqueue_qc(isolated, asset_id, platform_id="existing-video", upload_id="existing-upload")
    company_rejects(isolated)
    main._run_qianchuan_push_serial([delivery_id])
    for key in ("qc_upload", "qc_readback", "qc_bind"):
        isolated.calls[key].assert_not_called()
    with isolated.sessions() as db:
        row = db.get(QianchuanDelivery, delivery_id)
        assert (row.platform_asset_id, row.upload_task_id) == ("existing-video", "existing-upload")
        assert row.last_error_category == "company_audit_blocked"
        assert row.status == "partial"


def test_qianchuan_reject_arriving_during_upload_prevents_following_write(isolated):
    asset_id = approved_material(isolated)
    delivery_id = enqueue_qc(isolated, asset_id)
    def accepted_upload(*args, **kwargs):
        company_rejects(isolated)
        return {"upload_task_id": "accepted-before-reject", "request_id": "upload-receipt"}
    isolated.calls["qc_upload"].side_effect = accepted_upload
    isolated.calls["qc_readback"].side_effect = None
    isolated.calls["qc_readback"].return_value = {"platform_asset_id": "readback-accepted-video"}
    main._run_qianchuan_push_serial([delivery_id])
    isolated.calls["qc_upload"].assert_called_once()
    isolated.calls["qc_readback"].assert_called_once()
    isolated.calls["qc_bind"].assert_not_called()
    with isolated.sessions() as db:
        row = db.get(QianchuanDelivery, delivery_id)
        assert row.upload_task_id == "accepted-before-reject"
        assert row.platform_asset_id == "readback-accepted-video"
        assert row.last_error_category == "company_audit_blocked"


@pytest.mark.parametrize("shared", [False, True])
def test_adq_pass_then_queued_reject_prevents_initial_upload(isolated, shared):
    asset_id = approved_material(isolated, channel="")
    delivery_id = enqueue_adq(isolated, asset_id, shared=shared)
    company_rejects(isolated)
    main.run_adq_push(delivery_id)
    assert_no_new_adq_writes(isolated)
    isolated.calls["adq_readback"].assert_not_called()
    with isolated.sessions() as db:
        row = db.get(AdqDelivery, delivery_id)
        assert row.status == "failed" and row.last_error_category == "company_audit_blocked"
        assert row.platform_asset_id == ""
        assert row.request_id == "existing-adq-request"


@pytest.mark.parametrize("shared", [False, True])
def test_adq_readback_allowed_but_shared_grant_or_creative_write_blocked(isolated, shared):
    asset_id = approved_material(isolated, channel="")
    delivery_id = enqueue_adq(isolated, asset_id, shared=shared, platform_id="existing-adq-video")
    company_rejects(isolated)
    isolated.calls["adq_readback"].side_effect = None
    isolated.calls["adq_readback"].return_value = {"video_id": "existing-adq-video", "verified": True}
    main.run_adq_push(delivery_id)
    assert_no_new_adq_writes(isolated)
    isolated.calls["adq_readback"].assert_called_once()
    with isolated.sessions() as db:
        row = db.get(AdqDelivery, delivery_id)
        assert row.status == "partial" and row.last_error_category == "company_audit_blocked"
        assert row.failure_stage == ("authorization" if shared else "binding")
        assert (row.platform_asset_id, row.cover_id, row.root_material_id, row.dynamic_creative_id) == (
            "existing-adq-video", "existing-cover", "existing-root", "existing-creative")
        assert row.binding_evidence["library_readback"]["verified"] is True


@pytest.mark.parametrize("shared", [False, True])
def test_adq_reject_during_upload_stops_next_write_without_losing_receipt(isolated, shared):
    asset_id = approved_material(isolated, channel="")
    delivery_id = enqueue_adq(isolated, asset_id, shared=shared)
    def accepted_upload(*args, **kwargs):
        company_rejects(isolated)
        return {"video_id": "accepted-adq-video", "cover_id": "accepted-cover", "request_id": "accepted-request"}
    isolated.calls["adq_upload"].side_effect = accepted_upload
    isolated.calls["adq_readback"].side_effect = None
    isolated.calls["adq_readback"].return_value = {"video_id": "accepted-adq-video", "verified": True}
    main.run_adq_push(delivery_id)
    isolated.calls["adq_upload"].assert_called_once()
    isolated.calls["adq_readback"].assert_called_once()
    isolated.calls["adq_share"].assert_not_called()
    isolated.calls["adq_bind"].assert_not_called()
    with isolated.sessions() as db:
        row = db.get(AdqDelivery, delivery_id)
        assert (row.platform_asset_id, row.cover_id, row.request_id) == ("accepted-adq-video", "accepted-cover", "accepted-request")
        assert row.last_error_category == "company_audit_blocked"


@pytest.mark.parametrize("has_submission", [False, True])
def test_post_cutoff_material_without_company_job_is_blocked(isolated, has_submission):
    cutoff = datetime.utcnow() - timedelta(days=1)
    isolated.monkeypatch.setenv("COMPANY_AUDIT_ENFORCE_FROM", cutoff.isoformat())
    with isolated.sessions() as db:
        asset = Asset(object_key="fixtures/new-without-job.mp4", filename="new-without-job.mp4", media_type="video", modified_at=datetime.utcnow())
        db.add(asset)
        db.flush()
        if has_submission:
            db.add(AssetReviewSubmission(id="new-without-job", asset_id=asset.id, version=1, status="approved", submitted_at=datetime.utcnow()))
        db.commit()
        with pytest.raises(HTTPException) as caught:
            main._require_assets_review_approved(db, [asset])
        assert caught.value.status_code == 409
        assert "请先提交公司素材审核" in caught.value.detail


def test_pre_cutoff_historical_material_keeps_existing_flow(isolated):
    cutoff = datetime.utcnow() - timedelta(days=1)
    isolated.monkeypatch.setenv("COMPANY_AUDIT_ENFORCE_FROM", cutoff.isoformat())
    with isolated.sessions() as db:
        asset = Asset(object_key="fixtures/historical.mp4", filename="historical.mp4", media_type="video",
                      modified_at=cutoff - timedelta(days=3))
        db.add(asset)
        db.commit()
        # The deployment records the legacy asset-ID boundary explicitly; an
        # old OSS modification timestamp alone cannot prove prior ingestion.
        isolated.monkeypatch.setenv("COMPANY_AUDIT_LEGACY_MAX_ASSET_ID", str(asset.id))
        main._require_assets_review_approved(db, [asset])


def test_douyin_only_company_approval_cannot_start_adq_upload(isolated):
    asset_id = approved_material(isolated, channel="抖音")
    delivery_id = enqueue_adq(isolated, asset_id)
    # A pass for an explicitly different platform cannot grant ADQ coverage.
    main.run_adq_push(delivery_id)
    assert_no_new_adq_writes(isolated)
    with isolated.sessions() as db:
        row = db.get(AdqDelivery, delivery_id)
        assert row.last_error_category == "company_audit_blocked"
        assert "渠道" in row.error_message


def prepare_feedback_conflict(ctx):
    asset_id = approved_material(ctx)
    company_rejects(ctx)
    with ctx.sessions() as db:
        remote = db.get(audit.CompanyAuditRemoteTask, "fixture-official-task")
        remote.latest_feedback_status = "conflict"
        db.add(AssetReviewDecision(submission_id="fixture-submission", role_code="designated_reviewer",
            status="approved", reviewer_number="fixture-reviewer", reviewer_name="fixture reviewer"))
        db.commit()
        return asset_id, remote.result_revision


def test_feedback_recovery_requires_original_final_reviewer_or_admin(isolated):
    _, revision = prepare_feedback_conflict(isolated)
    with isolated.sessions() as db:
        payload = main.CompanyAuditFeedbackRetry(revision=revision, reason="已复核最新证据")
        with pytest.raises(HTTPException) as caught:
            main.company_feedback_retry("fixture-submission", payload, db=db, user={"number": "other-user", "name": "Other"})
        assert caught.value.status_code == 403
        assert db.scalars(select(audit.CompanyAuditFeedback)).all() == []


def test_feedback_recovery_rejects_stale_revision_without_outbox_write(isolated):
    _, revision = prepare_feedback_conflict(isolated)
    with isolated.sessions() as db:
        payload = main.CompanyAuditFeedbackRetry(revision=revision - 1, reason="已复核最新证据")
        with pytest.raises(HTTPException) as caught:
            main.company_feedback_retry("fixture-submission", payload, db=db, user={"number": "fixture-reviewer", "name": "Reviewer"})
        assert caught.value.status_code == 409
        assert db.scalars(select(audit.CompanyAuditFeedback)).all() == []


def test_feedback_recovery_queues_same_submission_without_network_or_new_task(isolated):
    _, revision = prepare_feedback_conflict(isolated)
    isolated.monkeypatch.setattr(main, "_review_submission_out", Mock(return_value={"id": "fixture-submission"}))
    with isolated.sessions() as db:
        payload = main.CompanyAuditFeedbackRetry(revision=revision, reason="核验补充授权材料后改判")
        main.company_feedback_retry("fixture-submission", payload, db=db, user={"number": "fixture-reviewer", "name": "Reviewer"})
    with isolated.sessions() as db:
        rows = db.scalars(select(audit.CompanyAuditFeedback)).all()
        assert len(rows) == 1 and rows[0].verdict == "pass"
        assert rows[0].task_id == "fixture-official-task"
        assert rows[0].status == "verify_before_send"
        assert len(db.scalars(select(audit.CompanyAuditJob)).all()) == 1
        assert not audit.gate(db, "fixture-submission")[0]
    requests.sessions.Session.request.assert_not_called()


def test_feedback_outbox_preserves_callers_expected_revision_after_refresh(isolated):
    _, prior_revision = prepare_feedback_conflict(isolated)
    # Another worker changes the result after the endpoint loaded the UI basis.
    company_rejects(isolated)
    with isolated.sessions() as db:
        with pytest.raises(ValueError, match="结论已变化"):
            audit.queue_feedback(db, "fixture-submission", "pass", "基于已过期界面", "fixture-reviewer",
                                 expected_result_revision=prior_revision)
        db.rollback()
    with isolated.sessions() as db:
        assert db.scalars(select(audit.CompanyAuditFeedback)).all() == []
        current = db.get(audit.CompanyAuditRemoteTask, "fixture-official-task")
        assert current.result_revision == prior_revision + 1
        row = audit.queue_feedback(db, "fixture-submission", "pass", "重新核对最新依据", "fixture-reviewer",
                                   expected_result_revision=current.result_revision)
        db.commit()
        assert row.base_result_revision == prior_revision + 1
