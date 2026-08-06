import unittest
from unittest.mock import AsyncMock, patch

from app import orchestrator


class TestOrchestrator(unittest.IsolatedAsyncioTestCase):
    async def test_maybe_start_skips_when_intent_skip(self):
        with patch(
            "app.orchestrator.effective_settings",
            new=AsyncMock(
                return_value={"parallel_execution_mode": "off", "max_subagents_per_task": 4}
            ),
        ):
            with patch(
                "app.orchestrator.db.get_session",
                new=AsyncMock(
                    return_value={
                        "id": "p1",
                        "force_parallel": 0,
                        "task": "short",
                        "role": "root",
                    }
                ),
            ):
                handled = await orchestrator.maybe_start("p1", "short")
        self.assertFalse(handled)

    async def test_child_task_envelope(self):
        text = orchestrator.build_child_task(
            parent_task="Parent big task",
            branch_title="Login",
            branch_task="Log into app",
            runtime_url="https://app.example",
        )
        self.assertIn("Log into app", text)
        self.assertIn("Login", text)
        self.assertIn("do not expand", text.lower())

    async def test_await_children_retries_once_on_failed_attempt1(self):
        async def _get_session(session_id: str):
            if session_id == "p1":
                return {"id": "p1", "status": "running"}
            if session_id == "c1":
                return {"id": "c1", "status": "failed", "attempt": 1, "error": "boom"}
            if session_id == "c1r":
                return {"id": "c1r", "status": "completed", "attempt": 2, "error": None}
            return None

        async def _list_messages(session_id: str):
            if session_id == "c1r":
                return [{"role": "assistant", "content": "ok"}]
            return []

        with patch("app.orchestrator.queue.is_cancelled", return_value=False):
            with patch("app.orchestrator.asyncio.sleep", new=AsyncMock()):
                with patch("app.orchestrator.db.get_session", new=AsyncMock(side_effect=_get_session)):
                    with patch(
                        "app.orchestrator.db.create_session",
                        new=AsyncMock(return_value={"id": "c1r"}),
                    ) as create_sess:
                        with patch(
                            "app.orchestrator.queue.enqueue",
                            new=AsyncMock(),
                        ) as enqueue:
                            with patch(
                                "app.orchestrator.db.list_messages",
                                new=AsyncMock(side_effect=_list_messages),
                            ):
                                emit = AsyncMock()
                                with patch("app.orchestrator._emit", new=emit):
                                    results = await orchestrator._await_children(
                                        "p1",
                                        "Parent",
                                        [
                                            {
                                                "child_id": "c1",
                                                "branch_id": "p1.b1",
                                                "title": "A",
                                                "task": "Do A",
                                            }
                                        ],
                                        cfg={},
                                        runtime_url=None,
                                    )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], "completed")
        self.assertEqual(results[0]["child_id"], "c1r")
        self.assertEqual(results[0]["attempt"], 2)
        self.assertEqual(create_sess.await_count, 1)
        self.assertEqual(enqueue.await_count, 1)
        child_finished = [
            c.args[2] for c in emit.call_args_list if len(c.args) >= 3 and c.args[1] == "child_finished"
        ]
        self.assertEqual(len(child_finished), 2)
        self.assertEqual(child_finished[0]["child_id"], "c1")
        self.assertEqual(child_finished[0]["branch_id"], "p1.b1")
        self.assertEqual(child_finished[0]["attempt"], 1)
        self.assertEqual(child_finished[0]["status"], "failed")
        self.assertEqual(child_finished[1]["child_id"], "c1r")
        self.assertEqual(child_finished[1]["branch_id"], "p1.b1")
        self.assertEqual(child_finished[1]["attempt"], 2)
        self.assertEqual(child_finished[1]["status"], "completed")

    async def test_run_orchestrator_serial_spawns_one_then_awaits(self):
        plan = {
            "phases": [
                {
                    "mode": "serial",
                    "branches": [
                        {"id": "b1", "title": "B1", "task": "Do B1"},
                        {"id": "b2", "title": "B2", "task": "Do B2"},
                    ],
                }
            ]
        }

        spawn_calls: list[str] = []
        await_calls: list[str] = []

        async def _spawn_child(parent_id: str, parent_task: str, br: dict, *, runtime_url=None):
            spawn_calls.append(br["id"])
            return {"child_id": f"c_{br['id']}", "branch_id": br["id"], "title": br["title"], "task": br["task"]}

        async def _await_children(parent_id: str, parent_task: str, children: list[dict], *, cfg, runtime_url):
            # Serial must not spawn b2 before awaiting b1 (and so on).
            self.assertEqual(len(children), 1)
            await_calls.append(children[0]["branch_id"])
            self.assertEqual(len(spawn_calls), len(await_calls))
            self.assertEqual(spawn_calls[-1], children[0]["branch_id"])
            return [
                {
                    "branch_id": children[0]["branch_id"],
                    "title": children[0]["title"],
                    "status": "completed",
                    "summary": None,
                    "error": None,
                    "child_id": children[0]["child_id"],
                    "attempt": 1,
                }
            ]

        with patch("app.orchestrator._parent_runtime_url", return_value=None):
            with patch("app.orchestrator._emit", new=AsyncMock()):
                with patch("app.orchestrator._spawn_children", new=AsyncMock()) as spawn_children:
                    with patch("app.orchestrator._spawn_child", new=AsyncMock(side_effect=_spawn_child)):
                        with patch("app.orchestrator._await_children", new=AsyncMock(side_effect=_await_children)):
                            with patch("app.orchestrator.aggregate_results", new=AsyncMock(return_value="report")):
                                with patch("app.orchestrator.db.update_session", new=AsyncMock()):
                                    with patch("app.orchestrator.db.add_message", new=AsyncMock()):
                                        await orchestrator._run_orchestrator("p1", "Parent", plan, cfg={})

        self.assertEqual(spawn_calls, ["b1", "b2"])
        self.assertEqual(await_calls, ["b1", "b2"])
        self.assertEqual(spawn_children.await_count, 0)


if __name__ == "__main__":
    unittest.main()

