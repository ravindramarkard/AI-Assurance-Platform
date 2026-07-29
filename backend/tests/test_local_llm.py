import unittest
from types import SimpleNamespace

from app.local_llm import (
    _fix_missing_choices,
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


if __name__ == "__main__":
    unittest.main()
