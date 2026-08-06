import unittest
from unittest.mock import AsyncMock, patch


class TestParallelSettings(unittest.IsolatedAsyncioTestCase):
    async def test_effective_includes_parallel_defaults(self):
        from app.llm_factory import effective_settings

        with patch("app.llm_factory.db.get_all_settings", new=AsyncMock(return_value={})):
            cfg = await effective_settings()
        self.assertEqual(cfg.get("parallel_execution_mode"), "auto")
        self.assertEqual(int(cfg.get("max_subagents_per_task") or 0), 4)


if __name__ == "__main__":
    unittest.main()
