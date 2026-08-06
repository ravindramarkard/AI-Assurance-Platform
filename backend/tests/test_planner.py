import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app import planner


class TestPlanner(unittest.IsolatedAsyncioTestCase):
    async def test_plan_task_parses_llm_json(self):
        payload = {
            "should_parallelize": True,
            "reason": "two",
            "phases": [
                {
                    "id": "p1",
                    "mode": "parallel",
                    "branches": [
                        {"id": "p1.b1", "title": "A", "task": "Do A"},
                        {"id": "p1.b2", "title": "B", "task": "Do B"},
                    ],
                }
            ],
        }
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=MagicMock(content=json.dumps(payload)))
        with patch("app.planner.build_llm", return_value=llm):
            plan = await planner.plan_task(
                "Do A and B in parallel",
                cfg={"llm_provider": "local"},
                max_branches=4,
                force=False,
            )
        self.assertTrue(plan["should_parallelize"])

    async def test_plan_task_repairs_once(self):
        bad = MagicMock(content="not-json")
        good = {
            "should_parallelize": False,
            "reason": "simple",
            "phases": [],
        }
        llm = MagicMock()
        llm.ainvoke = AsyncMock(side_effect=[bad, MagicMock(content=json.dumps(good))])
        with patch("app.planner.build_llm", return_value=llm):
            plan = await planner.plan_task("x", cfg={}, max_branches=4, force=False)
        self.assertEqual(llm.ainvoke.await_count, 2)
        self.assertFalse(plan["should_parallelize"])

    async def test_force_invalid_raises(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=MagicMock(content="nope"))
        with patch("app.planner.build_llm", return_value=llm):
            with self.assertRaises(planner.PlannerError):
                await planner.plan_task("x", cfg={}, max_branches=4, force=True)

    async def test_aggregate_returns_text(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=MagicMock(content="## Report\nOK"))
        with patch("app.planner.build_llm", return_value=llm):
            text = await planner.aggregate_results(
                "parent",
                [
                    {
                        "branch_id": "p1.b1",
                        "title": "A",
                        "status": "completed",
                        "summary": "ok",
                        "error": None,
                    }
                ],
                cfg={},
            )
        self.assertIn("Report", text)


if __name__ == "__main__":
    unittest.main()

