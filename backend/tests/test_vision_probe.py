import unittest

from app.vision_probe import (
    classify_vision_probe_response,
    needs_live_vision_probe,
    resolve_vision_mode,
    vision_probe_key,
)


class TestClassify(unittest.TestCase):
    def test_ok_choices(self):
        self.assertTrue(
            classify_vision_probe_response(
                200, {"choices": [{"message": {"content": "ok"}}]}
            )
        )

    def test_gateway_error(self):
        self.assertFalse(
            classify_vision_probe_response(200, {"error": "Failed to connect to Dest API"})
        )

    def test_null_choices(self):
        self.assertFalse(classify_vision_probe_response(200, {"choices": None}))

    def test_http_error(self):
        self.assertFalse(classify_vision_probe_response(400, {"choices": [{"message": {}}]}))


class TestModeAndNeeds(unittest.TestCase):
    def test_resolve_mode(self):
        self.assertEqual(resolve_vision_mode(None), "auto")
        self.assertEqual(resolve_vision_mode("ON"), "on")
        self.assertEqual(resolve_vision_mode("off"), "off")
        self.assertEqual(resolve_vision_mode("nope"), "auto")

    def test_needs_live(self):
        self.assertTrue(needs_live_vision_probe("local"))
        self.assertFalse(needs_live_vision_probe("openai"))
        self.assertFalse(needs_live_vision_probe("anthropic"))

    def test_probe_key(self):
        self.assertEqual(
            vision_probe_key("local", "http://x/v1", "m1"),
            "local|http://x/v1|m1",
        )


class TestEnsure(unittest.IsolatedAsyncioTestCase):
    async def test_off_forces_false(self):
        from app.vision_probe import ensure_vision_for_cfg

        ok = await ensure_vision_for_cfg(
            {
                "llm_provider": "local",
                "llm_vision_mode": "off",
                "llm_base_url": "http://x",
                "llm_model": "m",
            },
            persist=False,
        )
        self.assertFalse(ok)

    async def test_on_forces_true(self):
        from app.vision_probe import ensure_vision_for_cfg

        ok = await ensure_vision_for_cfg(
            {"llm_provider": "local", "llm_vision_mode": "on"},
            persist=False,
        )
        self.assertTrue(ok)

    async def test_auto_cloud_true(self):
        from app.vision_probe import ensure_vision_for_cfg

        ok = await ensure_vision_for_cfg(
            {"llm_provider": "openai", "llm_vision_mode": "auto"},
            persist=False,
        )
        self.assertTrue(ok)


class TestMigrate(unittest.TestCase):
    def test_true_to_on(self):
        from app.vision_probe import migrate_llm_use_vision_value

        self.assertEqual(migrate_llm_use_vision_value("true"), "on")

    def test_false_to_off(self):
        from app.vision_probe import migrate_llm_use_vision_value

        self.assertEqual(migrate_llm_use_vision_value("false"), "off")

    def test_unset(self):
        from app.vision_probe import migrate_llm_use_vision_value

        self.assertIsNone(migrate_llm_use_vision_value(None))


if __name__ == "__main__":
    unittest.main()
