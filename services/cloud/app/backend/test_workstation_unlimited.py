"""Isolated schema and actual-route-body regression tests; no live API calls.

The route is extracted from main.py with AST to avoid importing application
startup/database/network side effects. ORM expressions, persistence and review
dependencies are test doubles. These tests are not production acceptance.
"""

import ast
import importlib.util
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import unittest
from uuid import uuid4

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("isolated_schemas", ROOT / "app" / "schemas.py")
schemas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schemas)
Push = schemas.WorkstationQianchuanPushCreate


class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class Expression:
    def __eq__(self, other):
        return self

    def __ge__(self, other):
        return self

    def is_(self, other):
        return self

    def like(self, other):
        return self

    def desc(self):
        return self


class Query:
    def __init__(self, model):
        self.model = model

    def where(self, *conditions):
        return self

    def order_by(self, *fields):
        return self

    def limit(self, count):
        return self


class Asset:
    pass


class ReturnRecord:
    asset_id = status = Expression()


class Delivery:
    deleted_at = advertiser_id = plan_id = created_at = idempotency_key = Expression()

    def __init__(self, **values):
        self.__dict__.update(values)


class Db:
    def __init__(self):
        self.asset = SimpleNamespace(
            id=1, deleted_at=None, purged_at=None, media_type="video",
            library_type="remix", category="黑晶面膜",
            source="wis_remix_workstation", filename="自动混剪-隔离测试.mp4",
        )
        self.receipt = SimpleNamespace(provenance={"trusted": True})
        self.existing = None
        self.daily_tasks = []
        self.daily_reads = 0
        self.added = []
        self.commits = 0

    def get(self, model, record_id):
        assert model is Asset
        return self.asset

    def scalar(self, query):
        if query.model is ReturnRecord:
            return self.receipt
        assert query.model is Delivery
        return self.existing

    def scalars(self, query):
        assert query.model is Delivery
        self.daily_reads += 1
        return SimpleNamespace(all=lambda: self.daily_tasks)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1


SOURCE = (ROOT / "app" / "main.py").read_text(encoding="utf-8-sig")
ROUTE = next(
    node for node in ast.parse(SOURCE).body
    if isinstance(node, ast.FunctionDef) and node.name == "workstation_qianchuan_push"
)


def payload(**updates):
    values = dict(
        asset_id=1, idempotency_key="wis-remix:isolated:one",
        product_category="黑晶面膜", actor_number="test-actor",
        enabled=True, confirmed=True, daily_spend_guard_yuan=100000,
        target=dict(advertiser_id="123", plan_id="456", plan_type="multiplication"),
    )
    values.update(updates)
    return Push(**values)


def extract_route(events, *, target_error=False, review_error=False):
    # Parse again so stripping decorations cannot mutate the structure under test.
    node = next(
        item for item in ast.parse(SOURCE).body
        if isinstance(item, ast.FunctionDef) and item.name == ROUTE.name
    )
    node.decorator_list = []
    for arg in node.args.args:
        arg.annotation = None
    node.args.defaults = [ast.Constant(value=None), ast.Constant(value=None)]
    node.returns = None

    def target(db, **kwargs):
        events.append(("target_verified", kwargs))
        if target_error:
            raise HttpError(403, "target not authorized")
        return dict(account={"name": "Test account"}, plan={"name": "Original plan", "plan_type": "multiplication"})

    def review(db, assets, channel=""):
        assert channel == "抖音"
        events.append(("asset_review", len(assets)))
        if review_error:
            raise HttpError(409, "asset review pending")

    def summary(db, task):
        events.append(("summary", getattr(task, "id", None)))
        return getattr(task, "summary", {})

    namespace = dict(
        HTTPException=HttpError, Asset=Asset, WorkstationReturn=ReturnRecord,
        QianchuanDelivery=Delivery, select=Query, datetime=datetime, uuid4=uuid4,
        _workstation_qianchuan_target=target,
        canonical_product_category=lambda value: value,
        _workstation_assessment_is_trusted=lambda provenance: provenance.get("trusted") is True,
        _require_assets_review_approved=review,
        _task_daily_summary=summary,
        _workstation_qianchuan_day_start_utc=lambda: datetime(2026, 9, 29, 16),
        delivery_out=lambda task, asset, state: {"id": task.id, "status": task.status},
    )
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    exec(compile(module, str(ROOT / "app" / "main.py"), "exec"), namespace)
    return namespace[ROUTE.name]


class SchemaTests(unittest.TestCase):
    def test_legacy_default_is_limited(self):
        self.assertEqual(payload().delivery_limit_mode, "limited")
        self.assertEqual(payload().daily_material_limit, 1)

    def test_unlimited_accepts_null_limits(self):
        item = payload(delivery_limit_mode="unlimited", daily_material_limit=None, daily_spend_guard_yuan=None)
        self.assertIsNone(item.daily_material_limit)
        self.assertIsNone(item.daily_spend_guard_yuan)

    def test_unknown_mode_rejected(self):
        for value in ("", "auto", "UNLIMITED", None):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                payload(delivery_limit_mode=value)

    def test_limited_count_is_still_one_to_twenty(self):
        for value in (None, 0, -1, 21):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                payload(daily_material_limit=value)
        self.assertEqual(payload(daily_material_limit=20).daily_material_limit, 20)

    def test_spend_cannot_be_zero_negative_or_nonfinite(self):
        for mode in ("limited", "unlimited"):
            for value in (0, -1, float("nan"), float("inf"), 10_000_001):
                with self.subTest(mode=mode, value=value), self.assertRaises(ValidationError):
                    payload(delivery_limit_mode=mode, daily_spend_guard_yuan=value)


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        self.events = []
        self.route = extract_route(self.events)

    def unlimited(self, **updates):
        values = dict(delivery_limit_mode="unlimited", daily_material_limit=None, daily_spend_guard_yuan=None)
        values.update(updates)
        return payload(**values)

    def assert_no_write(self):
        self.assertEqual(self.db.added, [])
        self.assertEqual(self.db.commits, 0)

    def test_unlimited_queues_without_count_or_spend_query(self):
        self.db.daily_tasks = [SimpleNamespace(status="success", summary={"link_verified": True, "metrics": {"stat_cost": 999999999}})] * 100
        result = self.route(self.unlimited(), self.db)
        self.assertEqual(result["status"], "queued")
        self.assertEqual(self.db.daily_reads, 0)
        self.assertEqual(len(self.db.added), 1)
        self.assertEqual(self.db.commits, 1)
        guard = result["guard"]
        self.assertEqual(guard["delivery_limit_mode"], "unlimited")
        self.assertEqual(guard["application_status"], "not_applied")
        self.assertEqual(guard["spend_verification_status"], "not_applied")
        for field in ("daily_material_limit", "daily_material_count_before_push", "daily_spend_guard_yuan", "verified_spend_yuan", "unverified_success_count"):
            self.assertIsNone(guard[field], field)
        self.assertEqual(self.events[0][0], "target_verified")
        self.assertIn(("asset_review", 1), self.events)

    def test_explicit_unlimited_ignores_stale_numeric_fields(self):
        result = self.route(self.unlimited(daily_material_limit=1, daily_spend_guard_yuan=1), self.db)
        self.assertIsNone(result["guard"]["daily_spend_guard_yuan"])
        self.assertEqual(self.db.daily_reads, 0)

    def test_disabled_unlimited_stays_preflight(self):
        result = self.route(self.unlimited(enabled=False, confirmed=False), self.db)
        self.assertEqual(result["status"], "preflight_only")
        self.assertEqual(self.events[0][0], "target_verified")
        self.assert_no_write()

    def test_unlimited_still_requires_confirmation(self):
        with self.assertRaises(HttpError) as caught:
            self.route(self.unlimited(confirmed=False), self.db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assert_no_write()

    def test_unlimited_still_requires_authorized_current_target(self):
        route = extract_route(self.events, target_error=True)
        with self.assertRaises(HttpError) as caught:
            route(self.unlimited(), self.db)
        self.assertEqual(caught.exception.status_code, 403)
        self.assert_no_write()

    def test_unlimited_keeps_all_asset_safety_gates(self):
        patches = (
            {"deleted_at": datetime.utcnow()}, {"purged_at": datetime.utcnow()},
            {"media_type": "image"}, {"library_type": "other"},
            {"category": "another product"}, {"source": "oa_upload"},
            {"filename": "ordinary.mp4"},
        )
        for patch in patches:
            with self.subTest(patch=patch):
                db = Db()
                db.asset.__dict__.update(patch)
                with self.assertRaises(HttpError):
                    self.route(self.unlimited(), db)
                self.assertEqual(db.added, [])
                self.assertEqual(db.commits, 0)

    def test_unlimited_missing_asset_does_not_queue(self):
        self.db.asset = None
        with self.assertRaises(HttpError) as caught:
            self.route(self.unlimited(), self.db)
        self.assertEqual(caught.exception.status_code, 404)
        self.assert_no_write()

    def test_unlimited_requires_trusted_completed_return(self):
        for receipt in (None, SimpleNamespace(provenance={}), SimpleNamespace(provenance={"trusted": False})):
            with self.subTest(receipt=receipt), self.assertRaises(HttpError):
                self.db.receipt = receipt
                self.route(self.unlimited(), self.db)
            self.assert_no_write()

    def test_unlimited_requires_asset_review_approved(self):
        route = extract_route(self.events, review_error=True)
        with self.assertRaises(HttpError):
            route(self.unlimited(), self.db)
        self.assert_no_write()

    def test_unlimited_idempotency_reuses_existing_before_guard(self):
        self.db.existing = Delivery(id="existing", status="success")
        result = self.route(self.unlimited(), self.db)
        self.assertEqual(result["status"], "already_queued")
        self.assertEqual(result["task"]["id"], "existing")
        self.assertEqual(self.db.daily_reads, 0)
        self.assert_no_write()

    def test_legacy_missing_spend_stays_blocked(self):
        with self.assertRaises(HttpError) as caught:
            self.route(payload(daily_spend_guard_yuan=None), self.db)
        self.assertIn("必须配置每日消耗护栏", caught.exception.detail)
        self.assert_no_write()

    def test_legacy_count_limit_stays_blocked(self):
        self.db.daily_tasks = [Delivery(id="older", status="success")]
        with self.assertRaises(HttpError) as caught:
            self.route(payload(), self.db)
        self.assertIn("数量上限", caught.exception.detail)
        self.assertEqual(self.db.daily_reads, 1)
        self.assert_no_write()

    def test_legacy_spend_limit_stays_blocked(self):
        task = Delivery(id="older", status="success")
        task.summary = dict(link_verified=True, metrics={"stat_cost": 100000})
        self.db.daily_tasks = [task]
        with self.assertRaises(HttpError) as caught:
            self.route(payload(daily_material_limit=2), self.db)
        self.assertIn("已阻止新增混剪推送", caught.exception.detail)
        self.assertIn("原计划未修改", caught.exception.detail)
        self.assert_no_write()

    def test_limited_response_still_exposes_applied_guard(self):
        result = self.route(payload(), self.db)
        self.assertEqual(result["guard"]["delivery_limit_mode"], "limited")
        self.assertEqual(result["guard"]["application_status"], "applied")
        self.assertEqual(result["guard"]["daily_material_limit"], 1)

    def test_route_retains_auth_dependency(self):
        default = ROUTE.args.defaults[-1]
        self.assertEqual(ast.unparse(default), "Depends(require_workstation)")
        self.assertEqual(ast.unparse(ROUTE.decorator_list[0]), "app.post('/api/workstation/qianchuan/push')")

    def test_route_has_no_platform_mutation_or_bulk_migration(self):
        calls = {ast.unparse(node.func) for node in ast.walk(ROUTE) if isinstance(node, ast.Call)}
        self.assertFalse(any("qianchuan_service" in name for name in calls))
        self.assertTrue({"db.add", "db.commit"}.issubset(calls))
        self.assertFalse({"db.delete", "db.execute", "db.query", "db.update"} & calls)
        constructors = [node for node in ast.walk(ROUTE) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "QianchuanDelivery"]
        self.assertEqual(len(constructors), 1)
        self.assertFalse({"budget", "budget_mode", "opt_status", "roi2_goal"} & {arg.arg for arg in constructors[0].keywords})


if __name__ == "__main__":
    unittest.main(verbosity=2)
