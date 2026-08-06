"""Parallel plan heuristic and validation."""

import unittest

from app import parallel_plan


class TestHeuristic(unittest.TestCase):
    def test_short_task_not_large(self):
        self.assertFalse(parallel_plan.task_looks_large("Open homepage and describe it."))

    def test_long_task_large(self):
        self.assertTrue(parallel_plan.task_looks_large("x" * 400))

    def test_two_urls_large(self):
        self.assertTrue(
            parallel_plan.task_looks_large(
                "Check https://a.example and https://b.example for outages."
            )
        )

    def test_checklist_large(self):
        task = "\n".join(
            [
                "Do these:",
                "1. Login",
                "2. Open dashboard",
                "3. Export report",
            ]
        )
        self.assertTrue(parallel_plan.task_looks_large(task))

    def test_keywords_large(self):
        self.assertTrue(
            parallel_plan.task_looks_large(
                "Verify Jira ticket and also verify Confluence page."
            )
        )


class TestResolveIntent(unittest.TestCase):
    def test_off_without_force_skips(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("off", False, "x" * 500),
            "skip",
        )

    def test_off_with_force_plans(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("off", True, "short"),
            "plan",
        )

    def test_always_plans(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("always", False, "short"),
            "plan",
        )

    def test_auto_short_skips(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("auto", False, "Open home."),
            "skip",
        )

    def test_auto_large_plans(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("auto", False, "x" * 400),
            "plan",
        )


class TestParsePlan(unittest.TestCase):
    def test_valid_parallel_plan(self):
        raw = {
            "should_parallelize": True,
            "reason": "two checks",
            "phases": [
                {
                    "id": "p1",
                    "mode": "serial",
                    "branches": [
                        {"id": "p1.b1", "title": "Login", "task": "Log in"},
                    ],
                },
                {
                    "id": "p2",
                    "mode": "parallel",
                    "branches": [
                        {"id": "p2.b1", "title": "A", "task": "Do A"},
                        {"id": "p2.b2", "title": "B", "task": "Do B"},
                    ],
                },
            ],
        }
        plan = parallel_plan.parse_plan(raw, max_branches=4)
        self.assertTrue(plan["should_parallelize"])
        self.assertEqual(len(plan["phases"]), 2)

    def test_single_branch_disables_parallel(self):
        raw = {
            "should_parallelize": True,
            "reason": "only one",
            "phases": [
                {
                    "id": "p1",
                    "mode": "serial",
                    "branches": [
                        {"id": "p1.b1", "title": "Only", "task": "Do it"},
                    ],
                }
            ],
        }
        plan = parallel_plan.parse_plan(raw, max_branches=4)
        self.assertFalse(plan["should_parallelize"])

    def test_truncates_to_max_branches(self):
        branches = [
            {"id": f"p1.b{i}", "title": f"T{i}", "task": f"Do {i}"} for i in range(6)
        ]
        raw = {
            "should_parallelize": True,
            "reason": "many",
            "phases": [{"id": "p1", "mode": "parallel", "branches": branches}],
        }
        plan = parallel_plan.parse_plan(raw, max_branches=4)
        total = sum(len(p["branches"]) for p in plan["phases"])
        self.assertEqual(total, 4)
        self.assertTrue(plan.get("truncated"))

    def test_invalid_raises(self):
        with self.assertRaises(parallel_plan.PlanValidationError):
            parallel_plan.parse_plan({"should_parallelize": True, "phases": []}, max_branches=4)


if __name__ == "__main__":
    unittest.main()
