import unittest

from app.local_llm import resolve_temperature, resolve_use_vision


class TestPublicShapeContract(unittest.TestCase):
    """Pure contract for how effective values are derived (no DB)."""

    def test_effective_vision_null_override(self):
        self.assertFalse(resolve_use_vision(provider="local", override=None))
        self.assertTrue(resolve_use_vision(provider="openai", override=None))

    def test_temperature_bounds_for_api(self):
        self.assertEqual(resolve_temperature(0.0), 0.0)
        self.assertEqual(resolve_temperature(1.0), 1.0)
        self.assertEqual(resolve_temperature(1.5), 1.0)


class TestDeleteSettingApi(unittest.TestCase):
    def test_delete_setting_callable(self):
        from app import db

        self.assertTrue(callable(getattr(db, "delete_setting", None)))


if __name__ == "__main__":
    unittest.main()
