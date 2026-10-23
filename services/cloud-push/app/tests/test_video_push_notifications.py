import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from app.video_push_notifications import Outbox, FeishuSender, DeliveryError, card, recipient, read_tasks


def task(platform="qianchuan", status="pending", **changes):
    return {"id": "task-1", "platform": platform, "status": status, "asset_id": 1,
            "filename": "测试视频.mp4", "account_name": "测试账号", "target_name": "测试计划",
            "created_by_number": "FD-001", "created_by_name": "操作人",
            "uploaded_by_number": "FD-002", "uploaded_by_name": "上传人",
            "created_at": "2026-09-29 01:00:00", "updated_at": "2026-09-29 01:01:00", **changes}


CONFIG = {"enabled": True, "recipient_mode": "operator", "recipient_map": {"FD-001": "ou_operator", "FD-002": "ou_owner"},
          "public_url": "https://example.test/cloud", "app_id": "test", "app_secret": "test"}


class PushNotificationTests(unittest.TestCase):
    def setUp(self):
        self.box = Outbox(":memory:")
        self.box.observe([], 0)

    def tearDown(self):
        self.box.db.close()

    def test_three_platforms_send_cards_to_operator(self):
        self.box.observe([task(p) for p in ("qianchuan", "adq", "channels")], 10)
        sender = Mock()
        sender.send.return_value = "om_test"
        self.assertEqual(self.box.flush(sender, CONFIG, 10), 3)
        for args in sender.send.call_args_list:
            receive_type, payload = args.args
            self.assertEqual(receive_type, "open_id")
            self.assertEqual(payload["receive_id"], "ou_operator")
            self.assertEqual(payload["msg_type"], "interactive")
            self.assertIn("已入队", json.loads(payload["content"])["header"]["title"]["content"])
        self.assertEqual(self.box.db.execute("SELECT count(*) FROM notices WHERE state='sent'").fetchone()[0], 3)

    def test_initial_baseline_never_sends_history_but_tracks_changes(self):
        with tempfile.TemporaryDirectory() as root:
            path = str(Path(root) / "state.db")
            box = Outbox(path)
            self.assertEqual(box.observe([task()], 10), 0)
            box.db.close()
            box = Outbox(path)
            self.assertEqual(box.observe([task()], 20), 0)
            self.assertEqual(box.observe([task(status="success")], 30), 1)
            box.db.close()

    def test_status_changes_only_no_metric_update_duplicates(self):
        self.assertEqual(self.box.observe([task()], 10), 1)
        self.assertEqual(self.box.observe([task(updated_at="2026-09-29 01:02:00")], 20), 0)
        self.assertEqual(self.box.observe([task(status="uploading")], 30), 0)
        self.assertEqual(self.box.observe([task(status="failed")], 40), 1)
        self.assertEqual(self.box.observe([task(status="pending")], 50), 1)
        self.assertEqual(self.box.observe([task(status="success")], 60), 1)

    def test_submitted_is_not_success_and_untrusted_text_is_plain(self):
        value = card(task("channels", filename="<at id=all>所有人</at>"), "submitted", CONFIG["public_url"])
        self.assertIn("待平台确认", value["header"]["title"]["content"])
        self.assertEqual(value["elements"][0]["text"]["tag"], "plain_text")
        self.assertIn("09:01:00", value["elements"][-2]["text"]["content"])

    def test_no_guessing_recipient_from_employee_number(self):
        with self.assertRaises(ValueError):
            recipient(task(created_by_number="FD-UNKNOWN"), CONFIG)
        self.box.observe([task(created_by_number="FD-UNKNOWN")], 10)
        sender = Mock()
        self.box.flush(sender, CONFIG, 10)
        sender.send.assert_not_called()
        self.assertEqual(self.box.db.execute("SELECT error FROM notices").fetchone()[0], "recipient_mapping_missing")

    def test_retry_preserves_uuid_body_and_recipient(self):
        self.box.observe([task()], 10)
        sender = Mock()
        sender.send.side_effect = [TimeoutError("sensitive-secret"), "om_ok"]
        self.box.flush(sender, CONFIG, 10)
        changed = {**CONFIG, "recipient_map": {"FD-001": "ou_changed"}, "public_url": "https://changed.test"}
        self.box.flush(sender, changed, 30)
        self.assertEqual(sender.send.call_args_list[0], sender.send.call_args_list[1])
        self.assertEqual(self.box.db.execute("SELECT state FROM notices").fetchone()[0], "sent")

    def test_restart_uncertain_send_expires_without_duplicate(self):
        self.box.observe([task()], 10)
        sender = Mock()
        sender.send.side_effect = TimeoutError()
        self.box.flush(sender, CONFIG, 10)
        self.box.db.execute("UPDATE notices SET state='sending'")
        self.box.db.commit()
        self.box.flush(sender, CONFIG, 4000)
        self.assertEqual(sender.send.call_count, 1)
        self.assertEqual(self.box.db.execute("SELECT state FROM notices").fetchone()[0], "attention")

    def test_disabled_and_permanent_errors(self):
        self.box.observe([task()], 10)
        sender = Mock()
        self.box.flush(sender, {**CONFIG, "enabled": False}, 10)
        sender.send.assert_not_called()
        sender.send.side_effect = DeliveryError("feishu_230013", permanent=True)
        self.box.flush(sender, CONFIG, 20)
        self.box.flush(sender, CONFIG, 50)
        self.assertEqual(sender.send.call_count, 1)

    def test_token_refresh_and_message_request(self):
        def response(payload):
            r = Mock(status_code=200)
            r.json.return_value = payload
            return r
        post = Mock(side_effect=[response({"code": 0, "tenant_access_token": "t1", "expire": 7200}),
                                 response({"code": 99991663}),
                                 response({"code": 0, "tenant_access_token": "t2", "expire": 7200}),
                                 response({"code": 0, "data": {"message_id": "om_1"}})])
        sender = FeishuSender(CONFIG, post=post, clock=lambda: 10)
        self.assertEqual(sender.send("open_id", {"uuid": "fixed"}), "om_1")
        self.assertEqual(post.call_args_list[-1].kwargs["json"], {"uuid": "fixed"})
        self.assertFalse(post.call_args_list[-1].kwargs["allow_redirects"])

    def test_source_reader_uses_live_wal_without_writing(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "source.db"
            db = sqlite3.connect(path)
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE assets(id,filename,uploaded_by_number,uploaded_by_name,deleted_at,purged_at)")
            db.execute("INSERT INTO assets VALUES(1,'video.mp4','FD-002','owner',NULL,NULL)")
            for table in ("qianchuan_deliveries", "adq_deliveries", "channels_deliveries"):
                db.execute(f"CREATE TABLE {table}(id,asset_id,status,created_at,updated_at,created_by_number,created_by_name,advertiser_name,plan_name,account_name,adgroup_name,deleted_at)")
                db.execute(f"INSERT INTO {table} VALUES('t',1,'pending','','','FD-001','operator','adv','plan','account','group',NULL)")
            db.commit()
            self.assertEqual(len(read_tasks(path)), 3)
            db.execute("UPDATE channels_deliveries SET status='success'")
            db.commit()
            self.assertEqual(next(t for t in read_tasks(path) if t["platform"] == "channels")["status"], "success")
            db.close()


if __name__ == "__main__":
    unittest.main()
