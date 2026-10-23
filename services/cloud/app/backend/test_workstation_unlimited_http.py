"""Full-application HTTP isolation tests, intended for the candidate Linux image.

Run from /app/backend with no production volume or credentials:
  WIS_UNLIMITED_HTTP_TEST_TOKEN=fixture-unlimited-http-only-0123456789abcdef \
    python -m unittest -v test_workstation_unlimited_http.py

Imports the real app.main, schema, middleware, service-token dependency and
review gates. Only the request database (fresh in-memory SQLite) and live target
resolution are substituted. TestClient is deliberately NOT used as a context
manager: production lifespan/background workers must never start. External
network and platform writer spies are fail-closed assertions, not fake success
responses. Passing this suite is HTTP isolation evidence, not live acceptance.
"""

import atexit
from contextlib import ExitStack
from datetime import datetime
import importlib
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4


TEST_TOKEN = os.environ.get(
    "WIS_UNLIMITED_HTTP_TEST_TOKEN",
    "fixture-unlimited-http-only-0123456789abcdef",
)
if not TEST_TOKEN.startswith("fixture-") or len(TEST_TOKEN) < 32:
    raise RuntimeError("Supply a synthetic fixture- token, never a production token")

# This standalone test process never reuses a production token/database, even
# when those environment variables happen to be present in its parent shell.
os.environ.update({
    "WIS_WORKSTATION_API_TOKEN": TEST_TOKEN,
    "DATABASE_URL": "sqlite:///:memory:",
    "CLOUD_MIGRATION_VALIDATION": "0",
    "AWS_EC2_METADATA_DISABLED": "true",
    "AWS_ACCESS_KEY_ID": "fixture-not-a-real-access-key",
    "AWS_SECRET_ACCESS_KEY": "fixture-not-a-real-secret-key",
    "OSS_ACCESS_KEY": "fixture-not-a-real-access-key",
    "OSS_SECRET_KEY": "fixture-not-a-real-secret-key",
})

if (Path.cwd() / "app" / "main.py").is_file():
    sys.path.insert(0, str(Path.cwd()))

# Protect import-time behavior as well as request-time behavior. The ASGI
# TestClient uses an in-process transport and must not open outbound sockets.
NETWORK_GUARDS = ExitStack()
atexit.register(NETWORK_GUARDS.close)
NETWORK_ATTEMPTS = []


def forbid_network(*args, **kwargs):
    NETWORK_ATTEMPTS.append("blocked")
    raise AssertionError("External network is forbidden in HTTP isolation tests")


NETWORK_GUARDS.enter_context(patch("socket.socket.connect", side_effect=forbid_network))
NETWORK_GUARDS.enter_context(patch("socket.socket.connect_ex", side_effect=forbid_network))
NETWORK_GUARDS.enter_context(patch("socket.create_connection", side_effect=forbid_network))
NETWORK_GUARDS.enter_context(patch("urllib.request.urlopen", side_effect=forbid_network))

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

main = importlib.import_module("app.main")
from app.database import Base, get_db
from app.models import (
    Asset, AssetReviewSubmission, QianchuanDelivery,
    ReviewWorkflowConfig, WorkstationReturn,
)
from app.workstation_auth import require_workstation


class FullApplicationUnlimitedHttpTests(unittest.TestCase):
    def setUp(self):
        self.assertEqual(main.settings.database_url, "sqlite:///:memory:")
        self.engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.addCleanup(self.engine.dispose)

        def fixture_db():
            with self.Session() as db:
                yield db

        self.previous_overrides = dict(main.app.dependency_overrides)
        self.assertNotIn(require_workstation, self.previous_overrides)
        main.app.dependency_overrides[get_db] = fixture_db
        self.addCleanup(self.restore_overrides)
        self.target = self.stack.enter_context(patch.object(
            main, "_workstation_qianchuan_target",
            return_value={
                "account": {"id": "123", "name": "Fixture account"},
                "plan": {"id": "456", "name": "Unchanged fixture plan", "plan_type": "multiplication"},
            },
        ))
        self.platform_guards = {}
        for name in ("_plan_api_request", "add_to_plan", "begin_video_upload", "_upload_original_file_direct"):
            self.platform_guards[name] = self.stack.enter_context(patch.object(
                main.qianchuan_service, name,
                side_effect=AssertionError("HTTP admission route must not write to a platform"),
            ))

        self.filename = "自动混剪-HTTP隔离测试.mp4"
        self.provenance = {
            "automatic_review_enabled": True,
            "automatic_assessment": {
                "status": "passed", "recommendation": "approve", "autoApproved": True,
                "score": 98, "checks": [{"name": "fixture review check", "passed": True}],
            },
        }
        with self.Session() as db:
            db.add(Asset(
                id=1, object_key="fixture/remix/one.mp4", filename=self.filename,
                media_type="video", library_type="remix", category="黑晶面膜",
                source="wis_remix_workstation",
            ))
            db.add(ReviewWorkflowConfig(id=1, enabled=True, naming_enabled=True, ai_redline_enabled=False))
            db.flush()
            db.add(WorkstationReturn(
                idempotency_key="wis-remix:fixture:return:1", object_key="fixture/remix/one.mp4",
                asset_id=1, filename=self.filename, file_size=1234, sha256="a" * 64,
                status="completed", provenance=self.provenance,
            ))
            db.add(AssetReviewSubmission(
                id="fixture-review-1", asset_id=1, version=1, status="approved",
                filename_snapshot=self.filename, assignment_mode="automatic_workstation",
                naming_check={"status": "passed", "message": "fixture naming passed"},
            ))
            db.commit()

        # No `with TestClient(...)`: entering the context would start lifespan.
        self.client = TestClient(main.app, raise_server_exceptions=True)
        self.addCleanup(self.client.close)
        self.headers = {"x-wis-workstation-token": TEST_TOKEN}

    def restore_overrides(self):
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(self.previous_overrides)

    def tearDown(self):
        for name, guard in self.platform_guards.items():
            self.assertEqual(guard.call_count, 0, name)
        self.assertEqual(NETWORK_ATTEMPTS, [])

    def body(self, **updates):
        result = {
            "asset_id": 1, "idempotency_key": "wis-remix:fixture:http:1",
            "product_category": "黑晶面膜", "actor_number": "FIXTURE-TEST",
            "enabled": True, "confirmed": True,
            "delivery_limit_mode": "unlimited", "daily_material_limit": None,
            "daily_spend_guard_yuan": None,
            "target": {"advertiser_id": "123", "plan_id": "456", "plan_type": "multiplication"},
        }
        result.update(updates)
        return result

    def post(self, body=None, *, headers=None):
        return self.client.post(
            "/api/workstation/qianchuan/push", json=self.body() if body is None else body,
            headers=self.headers if headers is None else headers,
        )

    def count_deliveries(self):
        with self.Session() as db:
            return db.scalar(select(func.count()).select_from(QianchuanDelivery))

    def test_real_auth_dependency_is_not_overridden(self):
        self.assertNotIn(require_workstation, main.app.dependency_overrides)
        route = next(route for route in main.app.routes if getattr(route, "endpoint", None) is main.workstation_qianchuan_push)
        self.assertIn(require_workstation, [dep.call for dep in route.dependant.dependencies])

    def test_missing_token_returns_401_before_target_or_queue(self):
        response = self.post(headers={})
        self.assertEqual(response.status_code, 401, response.text)
        self.target.assert_not_called()
        self.assertEqual(self.count_deliveries(), 0)

    def test_wrong_token_returns_401(self):
        response = self.post(headers={"x-wis-workstation-token": "fixture-wrong-token-0123456789abcdef"})
        self.assertEqual(response.status_code, 401, response.text)
        self.target.assert_not_called()
        self.assertEqual(self.count_deliveries(), 0)

    def test_valid_token_preflight_does_not_enqueue(self):
        response = self.post(self.body(enabled=False, confirmed=False))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "preflight_only")
        self.target.assert_called_once()
        self.assertEqual(self.count_deliveries(), 0)

    def test_explicit_unlimited_http_queues_after_real_review_gates(self):
        response = self.post()
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["status"], "queued")
        self.assertEqual(result["task"]["status"], "pending")
        self.assertEqual(result["guard"]["application_status"], "not_applied")
        self.assertEqual(result["guard"]["spend_verification_status"], "not_applied")
        for name in ("daily_material_limit", "daily_material_count_before_push", "daily_spend_guard_yuan", "verified_spend_yuan", "unverified_success_count"):
            self.assertIsNone(result["guard"][name], name)
        self.assertEqual(self.count_deliveries(), 1)
        self.target.assert_called_once()
        self.assertEqual(self.target.call_args.kwargs, {
            "advertiser_id": "123", "plan_id": "456", "plan_type": "multiplication",
        })

    def test_unconfirmed_unlimited_http_returns_409(self):
        response = self.post(self.body(confirmed=False))
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("尚未明确确认", response.json()["detail"])
        self.assertEqual(self.count_deliveries(), 0)

    def test_pending_asset_review_returns_409_without_bypass(self):
        with self.Session() as db:
            db.get(AssetReviewSubmission, "fixture-review-1").status = "pending"
            db.commit()
        response = self.post()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("尚未完成全部审核", response.json()["detail"])
        self.assertEqual(self.count_deliveries(), 0)

    def test_untrusted_automatic_assessment_returns_409(self):
        with self.Session() as db:
            db.get(WorkstationReturn, "wis-remix:fixture:return:1").provenance = {}
            db.commit()
        response = self.post()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("可信的自动审核", response.json()["detail"])
        self.assertEqual(self.count_deliveries(), 0)

    def test_target_permission_failure_is_preserved(self):
        self.target.side_effect = HTTPException(403, "fixture target permission denied")
        response = self.post()
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.count_deliveries(), 0)

    def test_retry_is_idempotent_and_does_not_duplicate_queue(self):
        first = self.post()
        second = self.post()
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()["status"], "already_queued")
        self.assertEqual(first.json()["task"]["id"], second.json()["task"]["id"])
        self.assertEqual(self.count_deliveries(), 1)

    def test_legacy_request_still_requires_spend_guard(self):
        body = self.body(daily_material_limit=1)
        del body["delivery_limit_mode"]
        response = self.post(body)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("必须配置每日消耗护栏", response.json()["detail"])
        self.assertEqual(self.count_deliveries(), 0)

    def test_legacy_daily_count_limit_remains_enforced(self):
        with self.Session() as db:
            db.add(QianchuanDelivery(
                id=str(uuid4()), batch_id="fixture-batch", asset_id=1,
                created_by_number="FIXTURE-TEST", advertiser_id="123", plan_id="456",
                idempotency_key="wis-remix:fixture:older", status="success",
                created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
            ))
            db.commit()
        body = self.body(daily_material_limit=1, daily_spend_guard_yuan=100000)
        del body["delivery_limit_mode"]
        response = self.post(body)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("数量上限", response.json()["detail"])
        self.assertEqual(self.count_deliveries(), 1)

    def test_invalid_limit_mode_returns_422(self):
        response = self.post(self.body(delivery_limit_mode="unsafe-default"))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.count_deliveries(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
