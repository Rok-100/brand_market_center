from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import time
from copy import deepcopy
from datetime import date, datetime, time as clock_time, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

import requests

from .config import settings


logger = logging.getLogger(__name__)
SHANGHAI = ZoneInfo("Asia/Shanghai")
DOC_URL_RE = re.compile(r"https?://[^\s\]\[<>\"']+/(docx|wiki)/([A-Za-z0-9]+)")
ACTION_SIGNAL_RE = re.compile(
    r"长期|持续|每日|每天|每周|每月|计划|排期|截止|负责人|跟进|推进|完成|复盘|验收|目标|任务|要求|上线|测试|培训|认证|反馈|本周|下周|下月"
)
DATE_SIGNAL_RE = re.compile(r"(?:20\d{2}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月(?:底|中旬|上旬|下旬)")
MAX_MESSAGE_EVIDENCE = 80
MAX_MESSAGE_CHARS = 900
MAX_DOCUMENT_EXCERPT_CHARS = 2200
MAX_DOCUMENT_EVIDENCE_CHARS = 14000
MAX_AI_EVIDENCE_CHARS = 6000
ALLOWED_CENTERS = {
    "ALL", "AI营销中心", "营销中心A", "营销中心B", "营销中心C", "营销中心D",
    "营销中心J", "品牌营销中心", "品牌创意中心", "视频中心", "直播中心",
}


class LongTermWorkError(RuntimeError):
    def __init__(self, message: str, state: str = "error"):
        super().__init__(message)
        self.state = state


def _iso_now() -> str:
    return datetime.now(SHANGHAI).replace(microsecond=0).isoformat()


def _atomic_json_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, (_content_text(item) for item in value)))
    if isinstance(value, dict):
        preferred = [value.get(key) for key in ("text", "content", "href", "url", "title")]
        remaining = [item for key, item in value.items() if key not in {"text", "content", "href", "url", "title"}]
        return "\n".join(filter(None, (_content_text(item) for item in [*preferred, *remaining])))
    return ""


class LongTermWorkService:
    def __init__(self, state_path: str | Path | None = None, seed_path: str | Path | None = None):
        configured_path = Path(state_path or settings.long_term_work_snapshot_path)
        if state_path is None and os.name == "nt" and str(configured_path).startswith("\\data"):
            configured_path = Path(tempfile.gettempdir()) / "wis-video-center-dev" / configured_path.name
        self.state_path = configured_path
        self.seed_path = Path(seed_path or Path(__file__).with_name("long_term_work_seed.json"))
        self._lock = Lock()
        self._token = ""
        self._token_expires_at = datetime.min.replace(tzinfo=timezone.utc)
        self._last_ai_errors: list[dict] = []
        self._ensure_state()

    def _seed(self) -> dict:
        try:
            payload = json.loads(self.seed_path.read_text(encoding="utf-8"))
            if isinstance(payload.get("items"), list):
                return payload
        except (OSError, json.JSONDecodeError):
            logger.exception("Long-term work seed could not be read")
        return {
            "schemaVersion": 1,
            "generatedAt": _iso_now(),
            "sourceMode": "verified-snapshot",
            "sourceChat": {"name": settings.long_term_work_chat_name, "chatId": settings.long_term_work_chat_id, "readThroughDate": ""},
            "definition": "仅收录跨日、具备负责人或持续要求的工作。",
            "items": [],
        }

    def _default_state(self) -> dict:
        snapshot = self._seed()
        return {
            "schemaVersion": 1,
            "enabled": settings.long_term_work_enabled,
            "timezone": "Asia/Shanghai",
            "hour": settings.long_term_work_daily_hour,
            "minute": settings.long_term_work_daily_minute,
            "status": "idle" if settings.long_term_work_enabled else "disabled",
            "lastAttemptAt": None,
            "lastSuccessAt": None,
            "lastSuccessfulDate": None,
            "lastReadThroughTime": None,
            "messagesRead": 0,
            "documentsRead": 0,
            "documentErrorCount": 0,
            "documentErrors": [],
            "aiEvidenceErrorCount": 0,
            "aiEvidenceErrors": [],
            "itemCount": len(snapshot.get("items") or []),
            "newCount": 0,
            "updatedCount": 0,
            "lastError": None,
            "snapshot": snapshot,
        }

    def _ensure_state(self) -> None:
        if not self.state_path.exists():
            _atomic_json_write(self.state_path, self._default_state())

    def _read_state(self) -> dict:
        self._ensure_state()
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
            if isinstance(value, dict) and isinstance(value.get("snapshot"), dict):
                return value
        except (OSError, json.JSONDecodeError):
            logger.exception("Long-term work state could not be read")
        return self._default_state()

    def _write_state(self, state: dict) -> None:
        _atomic_json_write(self.state_path, state)

    def next_run(self, state: dict | None = None, now: datetime | None = None) -> datetime | None:
        current = state or self._read_state()
        if not current.get("enabled"):
            return None
        local_now = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
        scheduled = datetime.combine(
            local_now.date(),
            clock_time(hour=int(current.get("hour", 10)), minute=int(current.get("minute", 15))),
            tzinfo=SHANGHAI,
        )
        if local_now >= scheduled:
            scheduled += timedelta(days=1)
        return scheduled

    def status(self) -> dict:
        state = self._read_state()
        scheduled = self.next_run(state)
        snapshot = state.get("snapshot") or {}
        return {
            **{key: state.get(key) for key in (
                "schemaVersion", "enabled", "timezone", "hour", "minute", "status",
                "lastAttemptAt", "lastSuccessAt", "lastSuccessfulDate", "lastReadThroughTime",
                "messagesRead", "documentsRead", "documentErrorCount", "documentErrors",
                "aiEvidenceErrorCount", "aiEvidenceErrors",
                "itemCount", "newCount", "updatedCount", "lastError",
            )},
            "nextRunAt": scheduled.replace(microsecond=0).isoformat() if scheduled else None,
            "sourceChat": snapshot.get("sourceChat") or {},
            "snapshotGeneratedAt": snapshot.get("generatedAt"),
            "resourceAccessRequired": "请将平台飞书应用机器人加入“品牌营销部-核心干将”群，并把关联文档查看权限授予该应用。",
        }

    def snapshot(self) -> dict:
        state = self._read_state()
        return {**deepcopy(state.get("snapshot") or self._seed()), "scheduler": self.status()}

    def configure(self, *, enabled: bool, hour: int, minute: int) -> dict:
        if not 0 <= hour <= 23 or not 0 <= minute <= 59:
            raise LongTermWorkError("定时刷新时间不合法")
        with self._lock:
            state = self._read_state()
            state.update({"enabled": bool(enabled), "hour": int(hour), "minute": int(minute)})
            if not enabled:
                state["status"] = "disabled"
            elif state.get("status") == "disabled":
                state["status"] = "idle"
            self._write_state(state)
        return self.status()

    def _tenant_token(self) -> str:
        now = datetime.now(timezone.utc)
        if self._token and now < self._token_expires_at:
            return self._token
        app_id = os.getenv("FEISHU_APP_ID", "").strip()
        app_secret = os.getenv("FEISHU_APP_SECRET", "").strip()
        if not app_id or not app_secret:
            raise LongTermWorkError("平台服务器尚未配置飞书应用凭证", "blocked_configuration")
        try:
            response = requests.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
                timeout=20,
            )
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise LongTermWorkError("飞书租户授权暂时无法连接", "error") from exc
        if response.status_code != 200 or payload.get("code") != 0 or not payload.get("tenant_access_token"):
            raise LongTermWorkError("飞书应用凭证校验失败", "blocked_configuration")
        self._token = str(payload["tenant_access_token"])
        self._token_expires_at = now + timedelta(seconds=max(60, int(payload.get("expire") or 7200) - 300))
        return self._token

    def _feishu_get(self, path: str, params: dict | None = None) -> dict:
        try:
            response = requests.get(
                f"https://open.feishu.cn{path}",
                headers={"Authorization": f"Bearer {self._tenant_token()}"},
                params=params,
                timeout=30,
            )
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise LongTermWorkError("飞书数据读取网络异常，已保留最近成功快照") from exc
        code = int(payload.get("code") or 0)
        if response.status_code in {401, 403} or code in {99991663, 99991672, 1770032}:
            raise LongTermWorkError("飞书应用没有关联文档的查看权限，已保留最近成功快照", "blocked_permission")
        if code == 230002:
            raise LongTermWorkError("飞书应用机器人尚未加入“品牌营销部-核心干将”群，已保留最近成功快照", "blocked_permission")
        if response.status_code != 200 or code != 0:
            message = str(payload.get("msg") or "飞书接口返回异常")
            raise LongTermWorkError(f"飞书读取失败：{message}，已保留最近成功快照")
        return payload.get("data") or {}

    def _list_messages(self, start_at: datetime, end_at: datetime) -> list[dict]:
        items: list[dict] = []
        page_token = ""
        while True:
            params = {
                "container_id_type": "chat",
                "container_id": settings.long_term_work_chat_id,
                "start_time": str(int(start_at.timestamp())),
                "end_time": str(int(end_at.timestamp())),
                "sort_type": "ByCreateTimeAsc",
                "page_size": 50,
            }
            if page_token:
                params["page_token"] = page_token
            data = self._feishu_get("/open-apis/im/v1/messages", params)
            items.extend(data.get("items") or [])
            if not data.get("has_more"):
                break
            page_token = str(data.get("page_token") or "")
            if not page_token:
                break
        return items

    def _message_text(self, message: dict) -> str:
        content = (message.get("body") or {}).get("content") or ""
        try:
            decoded = json.loads(content)
        except (TypeError, json.JSONDecodeError):
            decoded = content
        return _content_text(decoded).strip()

    def _document_content(self, kind: str, token: str) -> tuple[str, str]:
        document_token = token
        title = token
        if kind == "wiki":
            node = self._feishu_get("/open-apis/wiki/v2/spaces/get_node", {"token": token}).get("node") or {}
            document_token = str(node.get("obj_token") or "")
            title = str(node.get("title") or token)
            if not document_token:
                raise LongTermWorkError("飞书知识库节点无法解析到文档", "blocked_permission")
        data = self._feishu_get(f"/open-apis/docx/v1/documents/{document_token}/raw_content")
        return title, str(data.get("content") or "")

    def _known_document_urls(self, state: dict, messages: list[str]) -> list[str]:
        urls = {
            str(item.get("sourceUrl") or "")
            for item in (state.get("snapshot") or {}).get("items") or []
            if "/docx/" in str(item.get("sourceUrl") or "") or "/wiki/" in str(item.get("sourceUrl") or "")
        }
        for text in messages:
            for match in DOC_URL_RE.finditer(text):
                urls.add(match.group(0).rstrip(".,，。;；)）"))
        return sorted(filter(None, urls))

    def _compact_evidence(
        self,
        messages: list[dict],
        documents: list[dict],
        previous: list[dict],
        today: date,
    ) -> dict:
        chat_url = f"https://applink.feishu.cn/client/chat/open?openChatId={settings.long_term_work_chat_id}"
        action_messages = [
            str(item.get("text") or "").strip()
            for item in messages
            if ACTION_SIGNAL_RE.search(str(item.get("text") or ""))
            or DATE_SIGNAL_RE.search(str(item.get("text") or ""))
        ]
        if not action_messages:
            action_messages = [str(item.get("text") or "").strip() for item in messages[-50:]]
        compact_messages = [
            {
                "text": text[:MAX_MESSAGE_CHARS],
                "sourceType": "核心干将群",
                "sourceTitle": settings.long_term_work_chat_name,
                "sourceUrl": chat_url,
            }
            for text in action_messages[-MAX_MESSAGE_EVIDENCE:]
            if text
        ]

        compact_documents: list[dict] = []
        remaining = MAX_DOCUMENT_EVIDENCE_CHARS
        for document in documents:
            if remaining <= 0:
                break
            content = str(document.get("content") or "")
            windows: list[tuple[int, int]] = []
            for match in re.finditer(
                rf"{ACTION_SIGNAL_RE.pattern}|{DATE_SIGNAL_RE.pattern}",
                content,
            ):
                start = max(0, match.start() - 220)
                end = min(len(content), match.end() + 620)
                if windows and start <= windows[-1][1] + 80:
                    windows[-1] = (windows[-1][0], max(windows[-1][1], end))
                else:
                    windows.append((start, end))
            excerpt = "\n…\n".join(content[start:end].strip() for start, end in windows if content[start:end].strip())
            if not excerpt:
                excerpt = content[:600]
            limit = min(MAX_DOCUMENT_EXCERPT_CHARS, remaining)
            excerpt = excerpt[:limit]
            if not excerpt:
                continue
            compact_documents.append({
                "title": str(document.get("title") or ""),
                "url": str(document.get("url") or ""),
                "content": excerpt,
            })
            remaining -= len(excerpt)

        return {
            "today": today.isoformat(),
            "messages": compact_messages,
            "documents": compact_documents,
            "previousItems": previous,
            "evidenceStats": {
                "rawMessageCount": len(messages),
                "selectedMessageCount": len(compact_messages),
                "rawDocumentCount": len(documents),
                "selectedDocumentCount": len(compact_documents),
                "selectedDocumentChars": sum(len(item["content"]) for item in compact_documents),
            },
        }

    def _evidence_batches(self, evidence: dict) -> list[dict]:
        def fresh(*, include_previous: bool) -> dict:
            return {
                "today": evidence["today"],
                "messages": [],
                "documents": [],
                "previousItems": evidence.get("previousItems") or [] if include_previous else [],
                "evidenceStats": evidence.get("evidenceStats") or {},
            }

        batches: list[dict] = []
        current = fresh(include_previous=True)
        for collection in ("messages", "documents"):
            for item in evidence.get(collection) or []:
                current[collection].append(item)
                size = len(json.dumps(current, ensure_ascii=False))
                has_prior_source = len(current[collection]) > 1 or bool(
                    current["documents"] if collection == "messages" else current["messages"]
                )
                if size <= MAX_AI_EVIDENCE_CHARS or not has_prior_source:
                    continue
                current[collection].pop()
                batches.append(current)
                current = fresh(include_previous=False)
                current[collection].append(item)
        if current["messages"] or current["documents"] or not batches:
            batches.append(current)
        return batches

    def _split_evidence_batch(self, batch: dict) -> list[dict]:
        sources = [
            (collection, item)
            for collection in ("previousItems", "messages", "documents")
            for item in (batch.get(collection) or [])
        ]
        if len(sources) < 2:
            return []
        weights = [len(json.dumps(item, ensure_ascii=False)) for _, item in sources]
        target = max(1, sum(weights) // 2)

        def fresh() -> dict:
            return {
                "today": batch["today"],
                "messages": [],
                "documents": [],
                "previousItems": [],
                "evidenceStats": batch.get("evidenceStats") or {},
            }

        left = fresh()
        right = fresh()
        running = 0
        for (collection, item), weight in zip(sources, weights):
            destination = left if running < target or not any(left[key] for key in ("previousItems", "messages", "documents")) else right
            destination[collection].append(item)
            if destination is left:
                running += weight
        if not any(right[key] for key in ("previousItems", "messages", "documents")):
            collection, item = sources[-1]
            left[collection].pop()
            right[collection].append(item)
        return [left, right]

    def _request_evidence_batch(self, batch: dict, system_prompt: str, label: str, depth: int = 0) -> list[Any]:
        payload = {
            "application": settings.jump_llm_application,
            "event": "text",
            "provider": settings.jump_llm_provider,
            "requests_data": {
                "model": settings.jump_llm_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(batch, ensure_ascii=False)},
                ],
                "temperature": 0.05,
            },
        }
        failure: LongTermWorkError | None = None
        try:
            response = requests.post(
                settings.jump_llm_url,
                headers={"Authorization": settings.jump_llm_token, "Content-Type": "application/json"},
                json=payload,
                timeout=settings.jump_llm_timeout_seconds,
            )
        except requests.RequestException as exc:
            failure = LongTermWorkError(f"AI 长期工作抽取批次 {label} 网络失败")
            failure.__cause__ = exc
        else:
            if response.status_code != 200:
                failure = LongTermWorkError(f"AI 长期工作抽取批次 {label} 返回 HTTP {response.status_code}")
            else:
                try:
                    result = response.json()
                except ValueError as exc:
                    failure = LongTermWorkError(f"AI 长期工作抽取批次 {label} 返回非 JSON 内容")
                    failure.__cause__ = exc
                else:
                    choices = result.get("choices") or (result.get("data") or {}).get("choices") or []
                    content = (((choices[0] or {}).get("message") or {}).get("content") if choices else "") or result.get("answer") or ""
                    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(content).strip(), flags=re.I)
                    try:
                        batch_items = json.loads(content)
                    except json.JSONDecodeError as exc:
                        failure = LongTermWorkError(f"AI 长期工作抽取批次 {label} 结果无法校验")
                        failure.__cause__ = exc
                    else:
                        if isinstance(batch_items, list):
                            return batch_items
                        failure = LongTermWorkError(f"AI 长期工作抽取批次 {label} 结果格式错误")

        children = self._split_evidence_batch(batch) if depth < 3 else []
        if children:
            logger.warning(
                "Long-term work AI batch %s failed (%s); splitting sizes=%s",
                label,
                failure,
                [len(json.dumps(child, ensure_ascii=False)) for child in children],
            )
            recovered: list[Any] = []
            for child_index, child in enumerate(children, start=1):
                recovered.extend(self._request_evidence_batch(child, system_prompt, f"{label}.{child_index}", depth + 1))
            return recovered
        if depth < 4:
            logger.warning("Long-term work AI batch %s failed (%s); retrying once", label, failure)
            time.sleep(2)
            return self._request_evidence_batch(batch, system_prompt, f"{label}.retry", 4)
        source_urls = []
        for collection in ("previousItems", "messages", "documents"):
            for item in batch.get(collection) or []:
                url = str(item.get("sourceUrl") or item.get("url") or "").strip()
                if url and url not in source_urls:
                    source_urls.append(url)
        error = {
            "label": label,
            "error": str(failure),
            "sourceUrls": source_urls[:10],
            "evidenceChars": len(json.dumps(batch, ensure_ascii=False)),
        }
        self._last_ai_errors.append(error)
        logger.error("Long-term work AI evidence deferred: %s", error)
        return []

    def _extract(self, messages: list[dict], documents: list[dict], previous: list[dict], today: date) -> list[dict]:
        if not settings.jump_llm_token:
            raise LongTermWorkError("AI 长期工作抽取服务尚未配置，已保留最近成功快照", "blocked_configuration")
        evidence = self._compact_evidence(messages, documents, previous, today)
        logger.info(
            "Long-term work compact evidence messages=%s/%s documents=%s/%s document_chars=%s payload_chars=%s",
            evidence["evidenceStats"]["selectedMessageCount"],
            evidence["evidenceStats"]["rawMessageCount"],
            evidence["evidenceStats"]["selectedDocumentCount"],
            evidence["evidenceStats"]["rawDocumentCount"],
            evidence["evidenceStats"]["selectedDocumentChars"],
            len(json.dumps(evidence, ensure_ascii=False)),
        )
        system_prompt = (
            "你是品牌营销部长期工作事实抽取器。只输出 JSON 数组，不要 Markdown。"
            "仅收录跨日或持续发生、负责人明确、日期明确、验收口径明确且有来源链接的工作。"
            "聊天建议、闲聊、当天已结束事项、推测和缺少负责人/日期/验收的信息一律不收录。"
            "可保留仍在有效期内的 previousItems；有新证据时更新。字段必须为 id,title,center,owners,startDate,endDate,status,acceptance,sourceType,sourceTitle,sourceUrl。"
            f"center 只能是 {sorted(ALLOWED_CENTERS)}。日期 YYYY-MM-DD。id 应稳定，可用标题与来源的短横线英文或哈希式短标识。"
        )
        batches = self._evidence_batches(evidence)
        logger.info(
            "Long-term work AI evidence batches=%s sizes=%s",
            len(batches),
            [len(json.dumps(batch, ensure_ascii=False)) for batch in batches],
        )
        self._last_ai_errors = []
        raw_items: list[Any] = []
        for item in previous:
            try:
                if date.fromisoformat(str(item.get("endDate") or "")) >= today:
                    raw_items.append(deepcopy(item))
            except ValueError:
                continue
        for index, batch in enumerate(batches, start=1):
            raw_items.extend(self._request_evidence_batch(batch, system_prompt, f"{index}/{len(batches)}"))
            if index < len(batches):
                time.sleep(1)
        validated: list[dict] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            title = str(raw.get("title") or "").strip()
            owners = [str(item).strip() for item in raw.get("owners") or [] if str(item).strip()]
            start_date = str(raw.get("startDate") or "")
            end_date = str(raw.get("endDate") or "")
            acceptance = str(raw.get("acceptance") or "").strip()
            source_url = str(raw.get("sourceUrl") or "").strip()
            center = str(raw.get("center") or "ALL").strip()
            try:
                date.fromisoformat(start_date)
                date.fromisoformat(end_date)
            except ValueError:
                continue
            if not title or not owners or not acceptance or not source_url.startswith("https://") or center not in ALLOWED_CENTERS:
                continue
            stable_id = str(raw.get("id") or "").strip() or hashlib.sha1(f"{title}|{source_url}".encode()).hexdigest()[:12]
            validated.append({
                "id": stable_id[:80], "title": title[:160], "center": center, "owners": owners[:8],
                "startDate": start_date, "endDate": end_date,
                "status": str(raw.get("status") or "进行中")[:30], "acceptance": acceptance[:300],
                "sourceType": str(raw.get("sourceType") or "飞书文档")[:30],
                "sourceTitle": str(raw.get("sourceTitle") or "飞书来源")[:160], "sourceUrl": source_url[:500],
            })
        validated = list({item["id"]: item for item in validated}.values())
        if not validated and previous:
            raise LongTermWorkError("本次未抽取到可核验长期工作，已保留最近成功快照")
        return validated

    def run(self, *, force: bool = False, now: datetime | None = None) -> dict:
        if not self._lock.acquire(blocking=False):
            raise LongTermWorkError("长期工作刷新正在执行，请稍后查看", "running")
        try:
            local_now = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
            state = self._read_state()
            if not state.get("enabled") and not force:
                return self.status()
            scheduled = datetime.combine(local_now.date(), clock_time(int(state.get("hour", 10)), int(state.get("minute", 15))), tzinfo=SHANGHAI)
            last_attempt_date = None
            try:
                if state.get("lastAttemptAt"):
                    last_attempt_date = datetime.fromisoformat(str(state["lastAttemptAt"])).astimezone(SHANGHAI).date().isoformat()
            except ValueError:
                last_attempt_date = None
            if not force and (
                local_now < scheduled
                or state.get("lastSuccessfulDate") == local_now.date().isoformat()
                or last_attempt_date == local_now.date().isoformat()
            ):
                return self.status()
            state.update({"status": "running", "lastAttemptAt": local_now.replace(microsecond=0).isoformat(), "lastError": None})
            self._write_state(state)
            cursor_text = state.get("lastReadThroughTime")
            start_at = datetime.fromisoformat(cursor_text) if cursor_text else local_now - timedelta(days=settings.long_term_work_lookback_days)
            if start_at.tzinfo is None:
                start_at = start_at.replace(tzinfo=SHANGHAI)
            try:
                message_rows = self._list_messages(start_at, local_now)
                message_texts = [self._message_text(row) for row in message_rows]
                message_texts = [value for value in message_texts if value]
                document_urls = self._known_document_urls(state, message_texts)
                documents = []
                document_errors = []
                for url in document_urls:
                    match = DOC_URL_RE.search(url)
                    if not match:
                        continue
                    try:
                        title, content = self._document_content(match.group(1), match.group(2))
                    except LongTermWorkError as exc:
                        logger.warning("Long-term work skipped inaccessible document %s: %s", url, exc)
                        document_errors.append({"url": url, "error": str(exc)})
                        continue
                    documents.append({"title": title, "url": url, "content": content[:120000]})
                previous_items = list((state.get("snapshot") or {}).get("items") or [])
                items = self._extract(
                    [{"text": text} for text in message_texts], documents, previous_items, local_now.date()
                )
                previous_by_id = {str(item.get("id")): item for item in previous_items}
                new_count = sum(str(item.get("id")) not in previous_by_id for item in items)
                updated_count = sum(
                    str(item.get("id")) in previous_by_id and item != previous_by_id[str(item.get("id"))]
                    for item in items
                )
                snapshot = {
                    "schemaVersion": 1,
                    "generatedAt": local_now.replace(microsecond=0).isoformat(),
                    "sourceMode": "live-refresh-with-warnings" if document_errors or self._last_ai_errors else "live-refresh",
                    "sourceChat": {"name": settings.long_term_work_chat_name, "chatId": settings.long_term_work_chat_id, "readThroughDate": local_now.date().isoformat()},
                    "definition": "仅收录跨日、具备负责人或持续要求的工作；群聊和文档只作为事实来源，不把闲聊或未确认建议当任务。",
                    "items": items,
                }
                state.update({
                    "status": "ready", "lastSuccessAt": local_now.replace(microsecond=0).isoformat(),
                    "lastSuccessfulDate": local_now.date().isoformat(), "lastReadThroughTime": local_now.replace(microsecond=0).isoformat(),
                    "messagesRead": len(message_rows), "documentsRead": len(documents), "itemCount": len(items),
                    "documentErrorCount": len(document_errors), "documentErrors": document_errors[:20],
                    "aiEvidenceErrorCount": len(self._last_ai_errors), "aiEvidenceErrors": self._last_ai_errors[:20],
                    "newCount": new_count, "updatedCount": updated_count, "lastError": None, "snapshot": snapshot,
                })
            except LongTermWorkError as exc:
                state.update({"status": exc.state, "lastError": str(exc)})
                self._write_state(state)
                return self.status()
            self._write_state(state)
            return self.status()
        finally:
            self._lock.release()

    def run_if_due(self) -> dict:
        return self.run(force=False)


long_term_work_service = LongTermWorkService()
