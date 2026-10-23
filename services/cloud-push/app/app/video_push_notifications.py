"""Read-only platform task observer with a separate, durable Feishu outbox.

Run as a single dedicated process. Never uploads, retries, or changes a video.
Credentials and recipient routing are loaded from a private JSON file.
"""
import json
import logging
import os
import signal
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone, timedelta
from pathlib import Path
from uuid import uuid4

import requests

PLATFORMS = {
    "qianchuan": ("qianchuan_deliveries", "千川", "advertiser_name", "plan_name"),
    "adq": ("adq_deliveries", "ADQ", "account_name", "adgroup_name"),
    "channels": ("channels_deliveries", "视频号", "account_name", None),
}
LABELS = {"pending": "已入队", "success": "推送成功", "failed": "推送失败",
          "partial": "部分完成，需处理", "submitted": "已提交，待平台确认", "cancelled": "已取消"}


def read_tasks(path):
    # mode=ro reads the live WAL correctly; immutable=1 would miss recent commits.
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=3)) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        rows = []
        for platform, (table, _, account, target) in PLATFORMS.items():
            target_sql = "d." + target if target else "''"
            query = f"""SELECT d.id,d.asset_id,d.status,d.created_at,d.updated_at,
                d.created_by_number,d.created_by_name,d.{account} AS account_name,
                {target_sql} AS target_name,a.filename,a.uploaded_by_number,a.uploaded_by_name
                FROM {table} d JOIN assets a ON a.id=d.asset_id
                WHERE d.deleted_at IS NULL AND a.deleted_at IS NULL AND a.purged_at IS NULL"""
            rows.extend({**dict(row), "platform": platform} for row in db.execute(query))
        return rows


def recipient(task, config):
    mode = config.get("recipient_mode")
    if mode == "chat" and str(config.get("chat_id", "")).startswith("oc_"):
        return "chat_id", config["chat_id"]
    if mode not in {"operator", "owner"}:
        raise ValueError("recipient_mode must be operator, owner or chat")
    number = task["created_by_number" if mode == "operator" else "uploaded_by_number"]
    # Never assume an OA employee number is a Feishu user ID, or guess by name.
    mapped = config.get("recipient_map", {}).get(number)
    kind = config.get("receive_id_type", "open_id")
    if not mapped or kind not in {"open_id", "user_id", "union_id"}:
        raise ValueError("missing verified recipient mapping")
    return kind, mapped


def card(task, status, public_url):
    title = f"WIS 云管家 · 推送{PLATFORMS[task['platform']][1]} · {LABELS[status]}"
    color = "green" if status == "success" else "red" if status == "failed" else "orange" if status == "partial" else "blue"
    stamp = str(task.get("updated_at") or task.get("created_at") or "")
    try:
        parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        stamp = parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S（北京时间）")
    except ValueError:
        stamp = "请查看工作台记录"
    fields = [("视频", task["filename"]), ("目标账号", task["account_name"] or "未命名账号"),
              ("操作人", task["created_by_name"] or task["created_by_number"]), ("状态", LABELS[status])]
    if task.get("target_name"):
        fields.append(("目标计划/营销单元", task["target_name"]))
    fields.extend([("任务编号", task["id"]), ("任务更新时间", stamp)])
    elements = [{"tag": "div", "text": {"tag": "plain_text", "content": f"{name}：{str(value)[:600]}"}} for name, value in fields]
    if status in {"failed", "partial"}:
        elements.append({"tag": "div", "text": {"tag": "plain_text", "content": "请在云管家查看失败原因和处理建议。通知重试不会重新推送视频。"}})
    if public_url.startswith("https://"):
        elements.append({"tag": "action", "actions": [{"tag": "button", "text": {"tag": "plain_text", "content": "打开 WIS 云管家"}, "type": "primary", "url": public_url}]})
    return {"config": {"wide_screen_mode": True}, "header": {"template": color, "title": {"tag": "plain_text", "content": title}}, "elements": elements}


class Outbox:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE IF NOT EXISTS observed(key TEXT PRIMARY KEY,status TEXT);
            CREATE TABLE IF NOT EXISTS notices(
                id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending', payload TEXT, receive_type TEXT,
                attempts INTEGER NOT NULL DEFAULT 0, next_at REAL NOT NULL DEFAULT 0,
                first_at REAL, message_id TEXT, error TEXT, created_at REAL NOT NULL);
        """)

    def observe(self, tasks, now):
        return self.db.rpc('intelligence',{'method':'observeCloudPush','args':[tasks,now,list(LABELS)]})

    def flush(self, sender, config, now):
        if not config.get("enabled"):
            return 0
        rows = self.db.execute("SELECT * FROM notices WHERE state IN ('pending','sending') AND next_at<=? ORDER BY created_at,rowid LIMIT 12", (now,)).fetchall()
        for row in rows:
            # Sending may have succeeded before a crash. Never retry beyond the
            # platform's one-hour UUID deduplication window.
            if row["first_at"] is not None and now - row["first_at"] >= 3500:
                with self.db:
                    self.db.execute("UPDATE notices SET state='attention',error='deduplication_window_expired' WHERE id=?", (row["id"],))
                continue
            if row["payload"]:
                payload, receive_type = json.loads(row["payload"]), row["receive_type"]
            else:
                task = json.loads(row["task"])
                try:
                    receive_type, receive_id = recipient(task, config)
                except ValueError:
                    with self.db:
                        self.db.execute("UPDATE notices SET next_at=?,error='recipient_mapping_missing' WHERE id=?", (now + 60, row["id"]))
                    continue
                payload = {"receive_id": receive_id, "msg_type": "interactive", "uuid": row["id"],
                           "content": json.dumps(card(task, row["status"], config.get("public_url", "")), ensure_ascii=False)}
            with self.db:
                self.db.execute("UPDATE notices SET state='sending',payload=?,receive_type=?,attempts=attempts+1,first_at=COALESCE(first_at,?),next_at=? WHERE id=?",
                                (json.dumps(payload, ensure_ascii=False), receive_type, now, now + 60, row["id"]))
            try:
                message_id = sender.send(receive_type, payload)
                state, error = "sent", ""
            except DeliveryError as exc:
                message_id, state, error = "", "attention" if exc.permanent else "pending", exc.code
            except Exception:
                # Do not log exception text: requests can include credentials.
                message_id, state, error = "", "pending", "transport_result_unknown"
            if state == "pending" and row["attempts"] >= 4:
                state = "attention"
            with self.db:
                self.db.execute("UPDATE notices SET state=?,message_id=?,error=?,next_at=? WHERE id=?",
                                (state, message_id, error, now + min(300, 10 * 2 ** row["attempts"]), row["id"]))
        return len(rows)


class DeliveryError(Exception):
    def __init__(self, code, permanent=False):
        self.code, self.permanent = code, permanent


class FeishuSender:
    def __init__(self, config, post=requests.post, clock=time.time):
        self.config, self.post, self.clock = config, post, clock
        self.token, self.expires = "", 0

    def tenant_token(self):
        if self.token and self.clock() < self.expires:
            return self.token
        r = self.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                      json={"app_id": self.config["app_id"], "app_secret": self.config["app_secret"]}, timeout=12, allow_redirects=False)
        p = r.json()
        if r.status_code != 200 or p.get("code") != 0 or not p.get("tenant_access_token"):
            raise DeliveryError("feishu_auth_failed")
        self.token = p["tenant_access_token"]
        self.expires = self.clock() + max(1, int(p.get("expire", 7200)) - 120)
        return self.token

    def send(self, receive_type, payload):
        for attempt in range(2):
            token = self.tenant_token()
            r = self.post("https://open.feishu.cn/open-apis/im/v1/messages", params={"receive_id_type": receive_type},
                          headers={"Authorization": "Bearer " + token}, json=payload, timeout=12, allow_redirects=False)
            p = r.json()
            if p.get("code") in {99991663, 99991668} and attempt == 0:
                self.token, self.expires = "", 0
                continue
            if r.status_code == 200 and p.get("code") == 0 and (p.get("data") or {}).get("message_id"):
                return p["data"]["message_id"]
            code = p.get("code", r.status_code)
            safe_code = str(code) if isinstance(code, int) else "invalid_response"
            raise DeliveryError("feishu_" + safe_code, permanent=r.status_code < 500 and r.status_code != 429)


def main():
    config_path = Path(os.environ["PUSH_NOTIFICATION_CONFIG"])
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("enabled") and (not config.get("app_id") or not config.get("app_secret") or not config.get("recipient_mode")):
        raise ValueError("Missing notification application or recipient configuration")
    state_dir = Path(os.environ.get("PUSH_NOTIFICATION_STATE", "/notifications"))
    state_dir.mkdir(parents=True, exist_ok=True)
    outbox = Outbox(str(state_dir / "outbox.sqlite3"))
    sender = FeishuSender(config)
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while not stopping:
        try:
            now = time.time()
            outbox.observe(read_tasks(os.environ["PUSH_NOTIFICATION_SOURCE_DB"]), now)
            outbox.flush(sender, config, now)
            health = {"ok": True, "enabled": bool(config.get("enabled")), "checked_at": time.time(),
                      "counts": dict(outbox.db.execute("SELECT state,count(*) FROM notices GROUP BY state").fetchall())}
            temp = state_dir / "health.tmp"
            temp.write_text(json.dumps(health), encoding="utf-8")
            temp.replace(state_dir / "health.json")
        except Exception as exc:
            logging.error("Push notification cycle deferred: %s", type(exc).__name__)
        for _ in range(5):
            if stopping:
                break
            time.sleep(1)
    outbox.db.close()


if __name__ == "__main__":
    main()
