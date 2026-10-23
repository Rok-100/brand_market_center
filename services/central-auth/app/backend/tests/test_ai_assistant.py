import os
import unittest
from unittest.mock import MagicMock, patch

import requests

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app.ai_assistant_service import AiAssistantConfig, AiAssistantError, AiAssistantService
from app.main import AssistantChatPayload, AssistantMessage, assistant_chat


def service(token: str = "server-token") -> AiAssistantService:
    return AiAssistantService(AiAssistantConfig(
        url="https://cloud.fandow.com/gpt/interface/chat/completions",
        token=token,
        application="pingying_zhongshu",
        provider="deepseek",
        model="deepseek-v4-pro",
        timeout_seconds=120,
        temperature=0.45,
    ))


class AiAssistantServiceTests(unittest.TestCase):
    def test_status_never_exposes_token(self):
        status = service().status()
        self.assertTrue(status["configured"])
        self.assertEqual(status["provider"], "deepseek")
        self.assertNotIn("token", status)

    @patch("app.ai_assistant_service.requests.post")
    def test_chat_calls_jump_llm_and_filters_module_actions(self, post: MagicMock):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {
            "choices": [{
                "message": {
                    "content": "先进入素材工作台继续处理。[[OPEN:material-workbench]] [[OPEN:cloud-manager]]",
                },
            }],
        }
        post.return_value = response

        result = service().chat(
            [{"role": "user", "content": "帮我打开二创工作台"}],
            ["material-workbench"],
            "AI管家",
            {
                "sources": ["操作日志"],
                "summary": {"total": 1},
                "insights": [{"title": "推送待核验", "evidence": ["pending 1 条"]}],
            },
        )

        self.assertEqual(result["answer"], "先进入素材工作台继续处理。")
        self.assertEqual([item["module_key"] for item in result["actions"]], ["material-workbench"])
        call = post.call_args
        self.assertEqual(call.kwargs["headers"]["Authorization"], "server-token")
        self.assertEqual(call.kwargs["json"]["application"], "pingying_zhongshu")
        self.assertEqual(call.kwargs["json"]["provider"], "deepseek")
        self.assertEqual(call.kwargs["json"]["requests_data"]["model"], "deepseek-v4-pro")
        system_prompt = call.kwargs["json"]["requests_data"]["messages"][0]["content"]
        self.assertIn("当前未授权", system_prompt)
        self.assertIn("只读阶段", system_prompt)
        self.assertIn("推送待核验", system_prompt)
        self.assertEqual(result["meta"]["context_sources"], ["操作日志"])

    @patch("app.ai_assistant_service.requests.post")
    def test_chat_uses_vision_model_when_message_contains_image(self, post: MagicMock):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {"choices": [{"message": {"content": "图片以白色为主。"}}]}
        post.return_value = response

        result = service().chat(
            [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "这张图是什么颜色？"},
                    {"type": "image_url", "image_url": {"url": "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="}},
                ],
            }],
            [],
        )

        self.assertEqual(post.call_args.kwargs["json"]["requests_data"]["model"], "deepseek-v4-flash-vision-exp")
        self.assertEqual(result["meta"]["model"], "deepseek-v4-flash-vision-exp")

    @patch("app.ai_assistant_service.requests.post")
    def test_chat_returns_safe_timeout_error(self, post: MagicMock):
        post.side_effect = requests.Timeout("secret upstream detail")
        with self.assertRaises(AiAssistantError) as raised:
            service().chat([{"role": "user", "content": "检查系统"}], ["cloud-manager"])
        self.assertEqual(raised.exception.status_code, 504)
        self.assertNotIn("secret", str(raised.exception))

    def test_chat_rejects_missing_server_configuration(self):
        with self.assertRaises(AiAssistantError) as raised:
            service(token="").chat([{"role": "user", "content": "你好"}], [])
        self.assertEqual(raised.exception.status_code, 503)

    @patch("app.main.module_access_for_user")
    @patch("app.main._assistant_context")
    @patch("app.main.ai_assistant_service.chat")
    def test_endpoint_passes_only_server_derived_access_to_model(
        self,
        chat: MagicMock,
        context: MagicMock,
        access: MagicMock,
    ):
        access.return_value = {"allowed_modules": ["material-workbench"]}
        context.return_value = {"sources": ["操作日志"], "summary": {"total": 1}}
        chat.return_value = {"answer": "可以进入。", "actions": [], "meta": {}}
        payload = AssistantChatPayload(
            messages=[AssistantMessage(role="user", content="  打开素材工作台  ")],
            current_view="AI管家",
        )

        result = assistant_chat(payload, {"number": "FD-TEST", "status": "normal"})

        self.assertTrue(result["request_id"])
        chat.assert_called_once_with(
            [{"role": "user", "content": "打开素材工作台"}],
            ["material-workbench"],
            "AI管家",
            {"sources": ["操作日志"], "summary": {"total": 1}},
        )

    @patch("app.main.business_intelligence_service.get_overview")
    @patch("app.main.module_access_for_user")
    @patch("app.main._assistant_context")
    @patch("app.main.ai_assistant_service.chat")
    def test_endpoint_injects_root_business_evidence_only_for_authorized_query(
        self,
        chat: MagicMock,
        context: MagicMock,
        access: MagicMock,
        get_overview: MagicMock,
    ):
        access.return_value = {"allowed_modules": ["data-dashboard"]}
        context.return_value = {"sources": ["操作日志"], "summary": {"total": 0}}
        get_overview.return_value = {
            "status": "ready",
            "query": {"productDate": "2026-08-20"},
            "summary": {"productEffectiveSalesYuan": 1000},
            "products": [{"standardProductName": "水润面膜", "effectiveSalesYuan": 1000}],
            "topMaterials": [],
            "quality": {},
            "coverage": {},
            "definitions": {},
        }
        chat.return_value = {"answer": "水润面膜成交1000元。", "actions": [], "meta": {}}
        payload = AssistantChatPayload(
            messages=[AssistantMessage(role="user", content="请分析昨天水润面膜成交表现并给建议")],
            current_view="AI管家",
        )

        assistant_chat(payload, {"number": "FD-TEST", "status": "normal"})

        system_context = chat.call_args.args[3]
        self.assertEqual(
            system_context["business_intelligence"]["summary"]["productEffectiveSalesYuan"],
            1000,
        )
        self.assertIn("FanDo 根数据 · 经营智能", system_context["sources"])

    @patch("app.main.business_intelligence_service.get_overview")
    @patch("app.main.module_access_for_user")
    @patch("app.main._assistant_context")
    @patch("app.main.ai_assistant_service.chat")
    def test_business_query_falls_back_to_exact_root_readback_when_model_times_out(
        self,
        chat: MagicMock,
        context: MagicMock,
        access: MagicMock,
        get_overview: MagicMock,
    ):
        access.return_value = {"allowed_modules": ["data-dashboard"]}
        context.return_value = {"sources": [], "summary": {}}
        get_overview.return_value = {
            "status": "ready",
            "query": {"productDate": "2026-08-20", "materialDays": 7},
            "summary": {
                "productEffectiveSalesYuan": 1250,
                "effectiveMaterialRate": 0.2,
                "effectiveMaterialCount": 2,
                "spentMaterialCount": 10,
            },
            "products": [
                {"standardProductName": "水润面膜", "effectiveSalesYuan": 1000, "orderCount": 10},
                {"standardProductName": "眼膜", "effectiveSalesYuan": 250, "orderCount": 2},
            ],
            "topMaterials": [],
            "quality": {},
            "coverage": {"warnings": []},
            "definitions": {},
        }
        chat.side_effect = AiAssistantError("模型超时", 504)
        payload = AssistantChatPayload(
            messages=[AssistantMessage(role="user", content="请分析昨天各单品表现并给建议")],
            current_view="AI管家",
        )

        result = assistant_chat(payload, {"number": "FD-TEST", "status": "normal"})

        self.assertIn("水润面膜：1,000.00 元", result["answer"])
        self.assertIn("不能相加", result["answer"])
        self.assertEqual(result["meta"]["model"], "经营数据直接读回")

    @patch("app.main.business_intelligence_service.get_overview")
    @patch("app.main.module_access_for_user")
    @patch("app.main._assistant_context")
    @patch("app.main.ai_assistant_service.chat")
    def test_exact_business_lookup_uses_fast_deterministic_readback(
        self,
        chat: MagicMock,
        context: MagicMock,
        access: MagicMock,
        get_overview: MagicMock,
    ):
        access.return_value = {"allowed_modules": ["data-dashboard"]}
        context.return_value = {"sources": [], "summary": {}}
        get_overview.return_value = {
            "status": "ready",
            "query": {"productDate": "2026-08-20", "materialDays": 7},
            "summary": {"productEffectiveSalesYuan": 1000},
            "products": [{"standardProductName": "水润面膜", "effectiveSalesYuan": 1000, "orderCount": 10}],
            "topMaterials": [],
            "quality": {},
            "coverage": {"warnings": []},
            "definitions": {},
        }
        payload = AssistantChatPayload(
            messages=[AssistantMessage(role="user", content="昨天各单品分别成交多少")],
            current_view="AI管家",
        )

        result = assistant_chat(payload, {"number": "FD-TEST", "status": "normal"})

        chat.assert_not_called()
        self.assertIn("直接精确查询", result["answer"])


if __name__ == "__main__":
    unittest.main()
