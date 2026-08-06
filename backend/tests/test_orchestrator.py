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
                                with patch("app.orchestrator._emit", new=AsyncMock()):
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


if __name__ == "__main__":
    unittest.main()

