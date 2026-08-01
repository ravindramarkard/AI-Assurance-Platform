import json
import unittest
from types import SimpleNamespace

from app.local_llm import (
    _fix_missing_choices,
    hoist_reasoning_content,
    resolve_temperature,
    resolve_use_vision,
    use_vision_for_provider,
)


class TestFixMissingChoices(unittest.TestCase):
    def test_raises_gateway_error_when_choices_null(self):
        # Vitruvian returns HTTP 200 {"error":"..."} which OpenAI SDK parses into
        # a ChatCompletion with choices=None and error set.
        resp = SimpleNamespace(
            id=None,
            choices=None,
            created=None,
            model=None,
            object=None,
            usage=None,
            error="Failed to connect to Dest API",
        )
        with self.assertRaises(RuntimeError) as ctx:
            _fix_missing_choices(resp)
        msg = str(ctx.exception)
        self.assertIn("Failed to connect to Dest API", msg)
        self.assertIn("vision", msg.lower())

    def test_passes_through_when_choices_present(self):
        resp = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])
        out = _fix_missing_choices(resp)
        self.assertIs(out, resp)


class TestUseVisionForProvider(unittest.TestCase):
    def test_local_disables_vision(self):
        self.assertFalse(use_vision_for_provider("local"))

    def test_cloud_enables_vision(self):
        self.assertTrue(use_vision_for_provider("openai"))
        self.assertTrue(use_vision_for_provider("anthropic"))
        self.assertTrue(use_vision_for_provider("browser_use"))


class TestResolveUseVision(unittest.TestCase):
    def test_unset_uses_provider_default(self):
        self.assertFalse(resolve_use_vision(provider="local", override=None))
        self.assertTrue(resolve_use_vision(provider="openai", override=None))
        self.assertTrue(resolve_use_vision(provider="anthropic", override=None))
        self.assertTrue(resolve_use_vision(provider="browser_use", override=None))

    def test_override_wins(self):
        self.assertTrue(resolve_use_vision(provider="local", override=True))
        self.assertFalse(resolve_use_vision(provider="openai", override=False))


class TestResolveTemperature(unittest.TestCase):
    def test_default_and_clamp(self):
        self.assertEqual(resolve_temperature(None), 0.1)
        self.assertEqual(resolve_temperature("0.5"), 0.5)
        self.assertEqual(resolve_temperature(2.0), 1.0)
        self.assertEqual(resolve_temperature(-1), 0.0)
        self.assertEqual(resolve_temperature("nope"), 0.1)


class TestAgentVisionResolution(unittest.TestCase):
    def test_cfg_override_true_on_local(self):
        cfg_override = True
        self.assertTrue(resolve_use_vision(provider="local", override=cfg_override))


class TestHoistMarkdownFencedJson(unittest.TestCase):
    """Vitruvian/local models wrap AgentOutput in ```json fences; browser-use needs raw JSON."""

    def test_strips_markdown_json_fence_from_content(self):
        payload = {
            "thinking": "need to click",
            "evaluation_previous_goal": "ok",
            "memory": "on page",
            "next_goal": "click",
            "action": [{"click": {"index": 1}}],
        }
        fenced = "```json\n" + json.dumps(payload, indent=2) + "\n```"
        msg = SimpleNamespace(content=fenced, reasoning_content=None)
        resp = SimpleNamespace(choices=[SimpleNamespace(message=msg)])
        hoist_reasoning_content(resp)
        self.assertTrue(msg.content.strip().startswith("{"), msg.content[:40])
        parsed = json.loads(msg.content)
        self.assertEqual(parsed["action"], payload["action"])


class TestNormalizeStructuredOutputText(unittest.TestCase):
    def test_strips_fence_for_any_model(self):
        from app.local_llm import normalize_structured_output_text

        payload = {
            "thinking": "t",
            "evaluation_previous_goal": "ok",
            "memory": "m",
            "next_goal": "g",
            "action": [{"done": {"text": "hi", "success": True}}],
        }
        fenced = "```json\n" + json.dumps(payload) + "\n```"
        out = normalize_structured_output_text(fenced)
        self.assertIsNotNone(out)
        self.assertEqual(json.loads(out)["action"], payload["action"])


class TestResilientModelValidateJson(unittest.TestCase):
    def test_validates_fenced_agent_output(self):
        from pydantic import BaseModel, Field

        from app.local_llm import resilient_model_validate_json

        class MiniOut(BaseModel):
            thinking: str = ""
            evaluation_previous_goal: str = ""
            memory: str = ""
            next_goal: str = ""
            action: list[dict] = Field(default_factory=list)

        payload = {
            "thinking": "t",
            "evaluation_previous_goal": "ok",
            "memory": "m",
            "next_goal": "g",
            "action": [{"click": {"index": 3}}],
        }
        fenced = "```json\n" + json.dumps(payload) + "\n```"
        parsed = resilient_model_validate_json(MiniOut, fenced)
        self.assertEqual(parsed.action, payload["action"])


class TestWrapLlmForResilientStructuredOutput(unittest.IsolatedAsyncioTestCase):
    async def test_wrapper_recovers_when_inner_validate_fails_on_fences(self):
        from pydantic import BaseModel, Field

        from app.local_llm import wrap_llm_for_resilient_structured_output
        from browser_use.llm.views import ChatInvokeCompletion

        class MiniOut(BaseModel):
            thinking: str = ""
            evaluation_previous_goal: str = ""
            memory: str = ""
            next_goal: str = ""
            action: list[dict] = Field(default_factory=list)

        payload = {
            "thinking": "t",
            "evaluation_previous_goal": "ok",
            "memory": "m",
            "next_goal": "g",
            "action": [{"click": {"index": 9}}],
        }
        fenced = "```json\n" + json.dumps(payload) + "\n```"

        class FakeLlm:
            model = "any-model"

            async def ainvoke(self, messages, output_format=None, **kwargs):
                # Mimic browser-use ChatOpenAI: validate raw content as-is
                parsed = output_format.model_validate_json(fenced)
                return ChatInvokeCompletion(completion=parsed, usage=None)

        wrapped = wrap_llm_for_resilient_structured_output(FakeLlm())
        result = await wrapped.ainvoke([], output_format=MiniOut)
        self.assertEqual(result.completion.action, payload["action"])


if __name__ == "__main__":
    unittest.main()
