"""Offline contract/recovery tests. Every HTTP request is mocked by default."""
import json
from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest
import requests
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Asset, AssetReviewSubmission
from app import company_audit as audit


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("COMPANY_AUDIT_TOKEN", "offline-fixture-credential")
    monkeypatch.delenv("COMPANY_AUDIT_TOKEN_FILE", raising=False)
    monkeypatch.delenv("COMPANY_AUDIT_BASE_URL", raising=False)
    monkeypatch.delenv("COMPANY_AUDIT_CALLBACK_BASE_URL", raising=False)
    monkeypatch.delenv("COMPANY_AUDIT_EVIDENCE_HOSTS", raising=False)
    monkeypatch.setattr(audit.requests, "post", Mock(side_effect=AssertionError("Unexpected network request")))
    monkeypatch.setattr(audit.requests, "get", Mock(side_effect=AssertionError("Unexpected network request")))
    engine = create_engine("sqlite:///" + str(tmp_path / "test.db"))
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    yield factory
    engine.dispose()


def response(data=None, status=200, **kwargs):
    return Mock(status_code=status, headers=kwargs.get("headers", {}), json=Mock(return_value={"ok": True, "data": data}))


def new_job(factory, submission_id="submission-1", asset_id=1, version=1, product_id="", url=None, channel="抖音"):
    with factory() as db:
        asset = db.get(Asset, asset_id)
        if not asset:
            asset = Asset(id=asset_id, object_key=f"fixture/{asset_id}.mp4", filename="offline.mp4", media_type="video", size=100, etag="etag-v1")
            db.add(asset)
            db.flush()
        submission = AssetReviewSubmission(id=submission_id, asset_id=asset.id, version=version)
        db.add(submission)
        db.flush()
        job = audit.enqueue(db, submission, asset, url or "https://storage.invalid/a.mp4?signature=fixture-private", product_id=product_id, channel=channel)
        result = job.id
        db.commit()
        return result


def submit(factory, monkeypatch, task_id="task-a"):
    mock = Mock(return_value=response({"task_id": task_id, "status": "pending", "verdict": "unknown", "reused": False}, 202))
    monkeypatch.setattr(audit.requests, "post", mock)
    assert audit.worker_tick(factory)
    return mock


def make_due(factory):
    with factory() as db:
        for row in db.scalars(select(audit.CompanyAuditRemoteTask)).all() + db.scalars(select(audit.CompanyAuditJob)).all():
            row.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()


def result(factory, monkeypatch, verdict="pass", status="success", ready=True, findings=None, task_id="task-a", **extra):
    data = {"task_id": task_id, "status": status, "verdict": verdict, "ready": ready, "findings": findings or [], **extra}
    monkeypatch.setattr(audit.requests, "get", Mock(return_value=response(data)))
    make_due(factory)
    assert audit.worker_tick(factory)
    return data


def gate(factory, submission_id="submission-1"):
    with factory() as db:
        return audit.gate(db, submission_id)


def feedback(factory, verdict, reason="", submission_id="submission-1"):
    with factory() as db:
        row = audit.queue_feedback(db, submission_id, verdict, reason, {"user_number": "fixture-operator"})
        key = row.id
        db.commit()
        return key


def test_202_persisted_fixed_url_and_no_network_inside_transaction(env, monkeypatch):
    job_id = new_job(env)
    seen = []
    def network(*args, **kwargs):
        with env() as db:
            persisted = db.get(audit.CompanyAuditJob, job_id)
            assert persisted.video_url == kwargs["json"]["video_url"]
            # A second session can write while the first request is in flight.
            persisted.error_code = "proof_network_does_not_hold_db_lock"
            db.commit()
        seen.append(kwargs)
        return response({"task_id": "task-a", "status": "pending"}, 202)
    monkeypatch.setattr(audit.requests, "post", network)
    assert audit.worker_tick(env)
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        assert job.task_id == "task-a"
        assert not audit.gate(db, job.submission_id)[0]
        asset = db.get(Asset, 1)
        submission = db.get(AssetReviewSubmission, "submission-1")
        assert audit.enqueue(db, submission, asset, "https://storage.invalid/different-signature").video_url == job.video_url
    assert seen[0]["allow_redirects"] is False
    assert seen[0]["headers"]["Authorization"] == "Bearer offline-fixture-credential"
    assert seen[0]["timeout"] == (3.05, 12)


def test_submit_timeout_and_expired_lease_resume_exact_url(env, monkeypatch):
    job_id = new_job(env)
    monkeypatch.setattr(audit.requests, "post", Mock(side_effect=requests.Timeout("private URL must never escape")))
    audit.worker_tick(env)
    with env() as db:
        row = db.get(audit.CompanyAuditJob, job_id)
        assert row.error_code == "network_timeout"
        assert row.task_id is None
        original = row.video_url
        row.next_attempt_at = datetime.utcnow() - timedelta(hours=2)
        db.commit()
    abandoned = audit._claim(env)
    with env() as db:
        row = db.get(audit.CompanyAuditJob, job_id)
        row.lease_until = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    mock = submit(env, monkeypatch)
    assert mock.call_args.kwargs["json"]["video_url"] == original
    audit._store(env, abandoned, {"task_id": "stale-task"}, "", 0)
    with env() as db:
        assert db.get(audit.CompanyAuditJob, job_id).task_id == "task-a"


def test_processing_after_an_hour_and_result_timeout_keep_task(env, monkeypatch):
    job_id = new_job(env)
    submit(env, monkeypatch)
    with env() as db:
        db.get(audit.CompanyAuditRemoteTask, "task-a").created_at = datetime.utcnow() - timedelta(hours=4)
        db.commit()
    result(env, monkeypatch, verdict="unknown", status="processing", ready=False)
    assert not gate(env)[0]
    make_due(env)
    monkeypatch.setattr(audit.requests, "get", Mock(side_effect=requests.Timeout("sensitive text")))
    audit.worker_tick(env)
    with env() as db:
        row = db.get(audit.CompanyAuditJob, job_id)
        assert row.task_id == "task-a"
        assert row.remote_task.status == "processing"
        assert row.remote_task.error_code == "network_timeout"
    result(env, monkeypatch)
    assert gate(env)[0]


def test_rate_limit_minimum_and_exponential_backoff(env, monkeypatch):
    job_id = new_job(env)
    monkeypatch.setattr(audit.requests, "post", Mock(return_value=response(status=429, headers={"Retry-After": "1"})))
    for expected in (30, 60, 120):
        make_due(env)
        before = datetime.utcnow()
        audit.worker_tick(env)
        with env() as db:
            row = db.get(audit.CompanyAuditJob, job_id)
            assert (row.next_attempt_at - before).total_seconds() >= expected
            assert row.error_code == "rate_limited"


def test_reused_task_shared_by_multiple_submission_versions(env, monkeypatch):
    first = new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch)
    second = new_job(env, "submission-2", version=2)
    submit(env, monkeypatch)
    result(env, monkeypatch)
    with env() as db:
        assert db.get(audit.CompanyAuditJob, first).task_id == db.get(audit.CompanyAuditJob, second).task_id
        assert len(db.scalars(select(audit.CompanyAuditRemoteTask)).all()) == 1
    assert gate(env)[0] and gate(env, "submission-2")[0]
    feedback(env, "reject", "人工发现风险", "submission-2")
    assert not gate(env)[0] and not gate(env, "submission-2")[0]


def test_callback_receipt_cannot_release_gate_and_duplicate_rechecks(env, monkeypatch):
    job_id = new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch, verdict="reject")
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        payload = {"task_id": "task-a", "event": "verdict_changed", "status": "success", "verdict": "pass"}
        receipt = audit.accept_callback(db, job.callback_capability, payload)
        first_id = receipt.id
        db.commit()
    assert not gate(env)[0]
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        duplicate = audit.accept_callback(db, job.callback_capability, payload)
        assert duplicate.id == first_id and duplicate.duplicate_count == 1
        assert job.remote_task.verdict == "reject"
        db.commit()
    result(env, monkeypatch, verdict="reject")
    assert not gate(env)[0]
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        with pytest.raises(ValueError):
            audit.accept_callback(db, "untrusted-capability", payload)
        with pytest.raises(ValueError):
            audit.accept_callback(db, job.callback_capability, {"task_id": "wrong-task"})


def test_callback_racing_submit_is_receipt_only(env, monkeypatch):
    job_id = new_job(env)
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        audit.accept_callback(db, job.callback_capability, {"task_id": "fake-task", "verdict": "pass"})
        db.commit()
        assert job.task_id is None
    submit(env, monkeypatch)
    assert not gate(env)[0]


def test_callback_fences_inflight_get_then_authority_wins(env, monkeypatch):
    job_id = new_job(env)
    submit(env, monkeypatch)
    work = audit._claim(env)
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        audit.accept_callback(db, job.callback_capability, {"task_id": "task-a", "verdict": "reject", "event": "verdict_changed"})
        db.commit()
    audit._store(env, work, {"task_id": "task-a", "status": "success", "ready": True, "verdict": "pass", "findings": []}, "", 0)
    assert not gate(env)[0]
    result(env, monkeypatch, verdict="reject")
    assert not gate(env)[0]


def test_shadow_filtered_original_evidence_preserved_and_public_secrets_removed(env, monkeypatch):
    job_id = new_job(env)
    submit(env, monkeypatch)
    findings = [{"tier": "red", "shadow": True, "evidence": "试运行"},
                {"tier": "green", "rule_code": "R9", "rule_name": "fixture", "rule_remark": "原文依据", "time_start_ms": 1234,
                 "frame_url": "https://oss.fandow.com/fixture.jpg?signature=fixture-value", "evidence": "原文保留"}]
    result(env, monkeypatch, findings=findings)
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        public = audit.to_public(job)
        assert len(public["findings"]) == 1
        assert public["findings"][0]["rule_remark"] == "原文依据"
        assert public["findings"][0]["time_start_ms"] == 1234
        assert public["findings"][0]["frame_url"].startswith("https://oss.fandow.com/")
        assert job.remote_task.raw_result["findings"] == findings
        assert public["dispatch_allowed"]
        assert public["product_mapping_missing"] and public["coverage_warning"]
        text = json.dumps(public)
        assert job.video_url not in text and job.callback_capability not in text and "offline-fixture-credential" not in text
    for url in ("http://oss.fandow.com/x", "https://oss.fandow.com.evil.invalid/x", "https://user:pass@oss.fandow.com/x", "javascript:alert(1)"):
        assert audit._public_finding({"frame_url": url})["frame_url"] == ""


def test_redline_override_requires_reason_feedback_ack_and_get(env, monkeypatch):
    new_job(env)
    submit(env, monkeypatch)
    findings = [{"tier": "red", "rule_code": "R1"}]
    result(env, monkeypatch, verdict="reject", findings=findings)
    with pytest.raises(ValueError, match="理由"):
        feedback(env, "pass")
    feedback_id = feedback(env, "pass", "已核实有效授权证明")
    assert not gate(env)[0]
    # Before the POST, a GET must confirm the original result still holds.
    result(env, monkeypatch, verdict="reject", findings=findings)
    post = Mock(return_value=response({"task_id": "task-a", "verdict": "pass", "changed": True}))
    monkeypatch.setattr(audit.requests, "post", post)
    assert audit.worker_tick(env)
    assert post.call_args.args[0].endswith("/audit/feedback")
    assert not gate(env)[0]
    result(env, monkeypatch, verdict="pass", findings=findings)
    assert gate(env)[0]
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, feedback_id).status == "confirmed"
    result(env, monkeypatch, verdict="reject", findings=findings)
    assert not gate(env)[0]


def test_outbox_rollback_and_unknown_pass_never_override(env, monkeypatch):
    new_job(env)
    with pytest.raises(ValueError):
        feedback(env, "pass", "不能绕过未知")
    submit(env, monkeypatch)
    result(env, monkeypatch, verdict="manual_required", findings=[{"tier": "yellow"}])
    with pytest.raises(ValueError, match="理由"):
        feedback(env, "pass")
    with env() as db:
        audit.queue_feedback(db, "submission-1", "pass", "已人工核查", "fixture")
        db.rollback()
    with env() as db:
        assert db.scalars(select(audit.CompanyAuditFeedback)).all() == []
        assert db.get(audit.CompanyAuditRemoteTask, "task-a").latest_feedback_id is None


def test_pending_reject_persists_then_waits_for_company_success(env, monkeypatch):
    new_job(env)
    key = feedback(env, "reject", "人工先驳回")
    with env() as db:
        row = db.get(audit.CompanyAuditFeedback, key)
        assert row.task_id is None and row.status == "waiting_result"
    submit(env, monkeypatch)
    result(env, monkeypatch, verdict="unknown", status="failed", ready=False)
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, key).status == "waiting_result"
    result(env, monkeypatch)
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, key).status == "ready_to_send"
    monkeypatch.setattr(audit.requests, "post", Mock(return_value=response({"task_id": "task-a", "verdict": "reject", "changed": True})))
    audit.worker_tick(env)
    result(env, monkeypatch, verdict="reject")
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, key).status == "confirmed"
    assert not gate(env)[0]


def test_old_feedback_conflicts_instead_of_overwriting_changed_authority(env, monkeypatch):
    new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch, verdict="manual_required")
    key = feedback(env, "pass", "仅基于原证据复核")
    result(env, monkeypatch, verdict="reject", findings=[{"tier": "red", "rule_code": "new-rule"}])
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, key).status == "conflict"
    assert not gate(env)[0]


def test_feedback_timeout_reads_before_retry_and_confirms_authority(env, monkeypatch):
    new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch)
    key = feedback(env, "reject", "人工复核发现问题")
    result(env, monkeypatch)
    monkeypatch.setattr(audit.requests, "post", Mock(side_effect=requests.Timeout("uncertain")))
    audit.worker_tick(env)
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, key).status == "verify_after_uncertain"
    result(env, monkeypatch, verdict="reject")
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, key).status == "confirmed"
    assert audit.requests.post.call_count == 1


@pytest.mark.parametrize("field,value", [("etag", "changed"), ("size", 999), ("object_key", "fixture/replaced.mp4"), ("category", "changed-category")])
def test_mutated_media_never_uses_previous_pass(env, monkeypatch, field, value):
    new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch)
    assert gate(env)[0]
    with env() as db:
        setattr(db.get(Asset, 1), field, value)
        db.commit()
    assert not gate(env)[0]


def test_missing_configuration_blocks_new_jobs_but_legacy_unchanged(env, monkeypatch):
    monkeypatch.delenv("COMPANY_AUDIT_TOKEN")
    assert not audit.configured()
    job_id = new_job(env)
    assert audit.worker_tick(env)
    assert not gate(env)[0]
    assert gate(env, "legacy-submission")[0]
    with env() as db:
        assert db.get(audit.CompanyAuditJob, job_id).error_code == "configuration_required"


def test_https_only_config_and_token_file(env, monkeypatch, tmp_path):
    monkeypatch.setenv("COMPANY_AUDIT_BASE_URL", "http://cloud.fandow.com/material-security-check")
    assert not audit.configured()
    monkeypatch.setenv("COMPANY_AUDIT_BASE_URL", audit.DEFAULT_BASE)
    monkeypatch.delenv("COMPANY_AUDIT_TOKEN")
    token_file = tmp_path / "offline-credential.txt"
    token_file.write_text("file-fixture-credential", encoding="utf-8")
    monkeypatch.setenv("COMPANY_AUDIT_TOKEN_FILE", str(token_file))
    assert audit.configured()
    monkeypatch.setenv("COMPANY_AUDIT_CALLBACK_BASE_URL", "http://callback.invalid/hooks")
    assert not audit.configured()


@pytest.mark.parametrize("data", [
    {"task_id": "wrong-task", "status": "success", "ready": True, "verdict": "pass", "findings": []},
    {"task_id": "task-a", "status": "success", "ready": "true", "verdict": "pass", "findings": []},
    {"task_id": "task-a", "status": "success", "ready": True, "verdict": "pass"},
    {"task_id": "task-a", "status": "success", "ready": True, "verdict": "pass", "findings": [], "findings_truncated": True},
])
def test_incomplete_or_wrong_results_fail_closed(env, monkeypatch, data):
    new_job(env)
    submit(env, monkeypatch)
    monkeypatch.setattr(audit.requests, "get", Mock(return_value=response(data)))
    audit.worker_tick(env)
    assert not gate(env)[0]


def test_authority_error_blocks_previous_pass_without_resubmit(env, monkeypatch):
    new_job(env)
    post = submit(env, monkeypatch)
    result(env, monkeypatch)
    make_due(env)
    monkeypatch.setattr(audit.requests, "get", Mock(return_value=response(status=401)))
    audit.worker_tick(env)
    assert not gate(env)[0]
    assert post.call_count == 1
    with env() as db:
        assert db.get(audit.CompanyAuditRemoteTask, "task-a").error_code == "authorization_failed"


def test_completed_result_staleness_fails_closed_and_resumes(env, monkeypatch):
    new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch)
    with env() as db:
        db.get(audit.CompanyAuditRemoteTask, "task-a").last_verified_at = datetime.utcnow() - timedelta(minutes=11)
        db.commit()
    assert not gate(env)[0]
    result(env, monkeypatch)
    assert gate(env)[0]


def test_worker_lease_excludes_parallel_claim_and_respects_due_time(env, monkeypatch):
    new_job(env)
    work = audit._claim(env)
    assert work["kind"] == "submit"
    assert audit._claim(env) is None
    audit._store(env, work, None, "rate_limited", 30)
    assert audit._claim(env) is None
    make_due(env)
    submit(env, monkeypatch)
    work = audit._claim(env)
    assert work["kind"] == "result"
    assert audit._claim(env) is None


def test_feedback_timeout_rechecks_original_before_retry(env, monkeypatch):
    new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch)
    key = feedback(env, "reject", "人工风险")
    result(env, monkeypatch)
    monkeypatch.setattr(audit.requests, "post", Mock(side_effect=requests.Timeout("uncertain")))
    audit.worker_tick(env)
    result(env, monkeypatch)
    with env() as db:
        row = db.get(audit.CompanyAuditFeedback, key)
        assert row.status == "ready_to_send"
        assert row.attempts == 1
    assert audit.requests.post.call_count == 1
    monkeypatch.setattr(audit.requests, "post", Mock(return_value=response({"task_id": "task-a", "verdict": "reject", "changed": True})))
    audit.worker_tick(env)
    assert audit.requests.post.call_count == 1
    assert not gate(env)[0]


def test_callback_between_feedback_preflight_and_send_forces_fresh_get(env, monkeypatch):
    job_id = new_job(env)
    submit(env, monkeypatch)
    result(env, monkeypatch, verdict="manual_required")
    key = feedback(env, "pass", "已核验证据")
    result(env, monkeypatch, verdict="manual_required")
    with env() as db:
        job = db.get(audit.CompanyAuditJob, job_id)
        audit.accept_callback(db, job.callback_capability, {"task_id": "task-a", "event": "verdict_changed", "verdict": "pass"})
        db.commit()
    # The earlier preflight has been invalidated. It must not POST blindly.
    result(env, monkeypatch, verdict="reject", findings=[{"tier": "red"}])
    with env() as db:
        assert db.get(audit.CompanyAuditFeedback, key).status == "conflict"
    assert not gate(env)[0]


def test_150_due_remote_tasks_cannot_starve_new_submissions(env):
    with env() as db:
        for index in range(150):
            db.add(audit.CompanyAuditRemoteTask(task_id=f"backlog-{index:03d}", status="success", ready=True, verdict="pass",
                                               next_attempt_at=datetime.utcnow() - timedelta(hours=2)))
        db.commit()
    first = new_job(env)
    second = new_job(env, "submission-2", asset_id=2)
    # Fairness survives distinct sessions/calls; even a persistent poll backlog
    # can use only every other slot while submissions are available.
    work1 = audit._claim(env)
    work2 = audit._claim(env)
    work3 = audit._claim(env)
    assert [work1["kind"], work2["kind"], work3["kind"]] == ["submit", "result", "submit"]
    assert {work1["key"], work3["key"]} == {first, second}


def test_declared_channel_mismatch_blocks_other_platform(env, monkeypatch):
    new_job(env, channel="抖音")
    submit(env, monkeypatch)
    result(env, monkeypatch)
    with env() as db:
        assert audit.gate(db, "submission-1", channel="抖音")[0]
        assert not audit.gate(db, "submission-1", channel="视频号")[0]


def test_unspecified_channel_discloses_basic_review_only(env, monkeypatch):
    job_id = new_job(env, product_id="fixture-product-id", channel="")
    submit(env, monkeypatch)
    result(env, monkeypatch)
    with env() as db:
        public = audit.to_public(db.get(audit.CompanyAuditJob, job_id))
        assert public["channel_mapping_missing"]
        assert "仅作基础内容审核" in public["coverage_warning"]
        assert audit.gate(db, "submission-1", channel="视频号")[0]


def test_reused_task_product_identity_checked_for_each_job(env, monkeypatch):
    new_job(env, product_id="fixture-product-A")
    submit(env, monkeypatch)
    result(env, monkeypatch, product_id="fixture-product-A")
    new_job(env, "submission-2", version=2, product_id="fixture-product-B")
    submit(env, monkeypatch)
    result(env, monkeypatch, product_id="fixture-product-A")
    assert gate(env)[0]
    assert not gate(env, "submission-2")[0]
    with pytest.raises(ValueError, match="产品编码"):
        feedback(env, "pass", "不可跨产品放行", "submission-2")


@pytest.mark.parametrize("ready_fields", [{}, {"ready": True}])
def test_failed_without_ready_is_accepted_and_root_cause_is_sanitized(env, monkeypatch, ready_fields):
    job_id = new_job(env)
    submit(env, monkeypatch)
    monkeypatch.setattr(audit.requests, "get", Mock(return_value=response({
        "task_id": "task-a", "status": "failed", "verdict": "unknown", "findings": None,
        **ready_fields,
        "error_message": "视频无法下载 https://storage.invalid/a?signature=private; token=private-token"
    })))
    audit.worker_tick(env)
    with env() as db:
        public = audit.to_public(db.get(audit.CompanyAuditJob, job_id))
        assert public["status"] == "failed" and public["ready"] is False
        assert public["error_code"] == ""
        assert "视频无法下载" in public["error_message"]
        assert "private" not in public["error_message"]
        assert not public["dispatch_allowed"]
