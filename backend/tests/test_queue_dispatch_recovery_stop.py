import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch


class TestQueueDispatchRecoveryStop(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        from app import queue

        # Ensure a clean in-memory queue state between tests.
        queue._queue.clear()
        queue._cancelled.clear()

    async def test_queue_exports_dispatch_session_callable(self):
        from app import queue

        fn = getattr(queue, "dispatch_session", None)
        self.assertTrue(callable(fn), "queue.dispatch_session must exist and be callable")

    async def test_worker_uses_dispatch_session(self):
        from app import queue

        # Prime one item so the worker does real work immediately.
        queue._queue.append(("s1", "task1"))

        with patch("app.queue.dispatch_session", new=AsyncMock(), create=True) as dispatch:
            with patch("app.queue.agent_runner.run_session", new=AsyncMock()) as run_session:
                t = asyncio.create_task(queue._worker(0))
                await asyncio.sleep(0.05)
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass

        self.assertEqual(dispatch.await_count, 1)
        self.assertEqual(run_session.await_count, 0)

    async def test_recover_stuck_sessions_reenqueues_planning_aggregating_and_children(self):
        from app import queue

        sessions = [
            {"id": "a", "task": "ta", "status": "queued", "role": "root"},
            {"id": "b", "task": "tb", "status": "running", "role": "root"},
            {"id": "c", "task": "tc", "status": "planning", "role": "root"},
            {"id": "d", "task": "td", "status": "aggregating", "role": "orchestrator"},
            {"id": "e", "task": "te", "status": "completed", "role": "root"},
            # Child should also be considered during recovery.
            {"id": "ch1", "task": "tch", "status": "running", "role": "child"},
        ]

        list_sessions = AsyncMock(return_value=sessions)
        update_session = AsyncMock()
        enqueue = AsyncMock()

        # queue.recover_stuck_sessions imports db inside the function.
        with patch("app.db.list_sessions", new=list_sessions):
            with patch("app.db.update_session", new=update_session):
                with patch("app.queue.enqueue", new=enqueue):
                    await queue.recover_stuck_sessions()

        # Must include children in recovery scans.
        self.assertTrue(
            list_sessions.call_args.kwargs.get("include_children", False),
            "recover_stuck_sessions must call db.list_sessions(include_children=True)",
        )

        # Should enqueue all non-terminal sessions including planning/aggregating.
        enq_ids = [c.args[0] for c in enqueue.call_args_list]
        self.assertCountEqual(enq_ids, ["a", "b", "c", "d", "ch1"])

    async def test_recover_skips_children_of_resumable_orchestrator(self):
        from app import queue

        sessions = [
            {"id": "orch", "task": "to", "status": "running", "role": "orchestrator"},
            {"id": "k1", "task": "t1", "status": "running", "role": "child", "parent_id": "orch"},
            {"id": "k2", "task": "t2", "status": "queued", "role": "child", "parent_id": "orch"},
            # Orphaned child: its parent already finished, so recovery still owns it.
            {"id": "dead", "task": "td", "status": "completed", "role": "orchestrator"},
            {"id": "k3", "task": "t3", "status": "running", "role": "child", "parent_id": "dead"},
        ]

        enqueue = AsyncMock()
        with patch("app.db.list_sessions", new=AsyncMock(return_value=sessions)):
            with patch("app.db.update_session", new=AsyncMock()) as update_session:
                with patch("app.queue.enqueue", new=enqueue):
                    await queue.recover_stuck_sessions()

        enq_ids = [c.args[0] for c in enqueue.call_args_list]
        self.assertCountEqual(
            enq_ids,
            ["orch", "k3"],
            "children of a resumable orchestrator must be left to the orchestrator",
        )
        touched = [c.args[0] for c in update_session.call_args_list]
        self.assertNotIn("k1", touched)
        self.assertNotIn("k2", touched)

    async def test_orchestrator_maybe_start_prefers_resume_when_plan_json_exists(self):
        from app import orchestrator

        sess = {"id": "p1", "role": "orchestrator", "status": "queued", "plan_json": json.dumps({"phases": []})}

        with patch("app.orchestrator.db.get_session", new=AsyncMock(return_value=sess)):
            with patch("app.orchestrator.effective_settings", new=AsyncMock(return_value={"parallel_execution_mode": "auto"})):
                with patch("app.orchestrator.plan_task", new=AsyncMock()) as plan_task:
                    with patch("app.orchestrator.db.update_session", new=AsyncMock()):
                        with patch("app.orchestrator._emit", new=AsyncMock()):
                            def _create_task(coro):
                                # Avoid "coroutine was never awaited" warnings in unit tests.
                                try:
                                    coro.close()
                                except Exception:
                                    pass
                                return None

                            with patch("app.orchestrator.asyncio.create_task", new=_create_task) as create_task:
                                handled = await orchestrator.maybe_start("p1", "task")

        self.assertTrue(handled)
        self.assertEqual(plan_task.await_count, 0, "resume path must not call plan_task when plan_json exists")
        # patch() with new=_create_task returns the function itself, not a mock; assert via handled behavior above.

    async def test_control_agent_stop_cascades_for_orchestrator_without_recursive_loops(self):
        from app import agent_runner

        parent = {"id": "p1", "role": "orchestrator", "status": "running"}
        children = [
            {"id": "c1", "role": "child", "status": "queued"},
            {"id": "c2", "role": "child", "status": "running"},
            {"id": "c3", "role": "child", "status": "completed"},
        ]

        async def _get_session(sid: str):
            if sid == "p1":
                return parent
            for ch in children:
                if ch["id"] == sid:
                    return ch
            return None

        with patch("app.agent_runner.db.get_session", new=AsyncMock(side_effect=_get_session)):
            with patch("app.agent_runner.db.list_child_sessions", new=AsyncMock(return_value=children)):
                # control_agent imports cancel_queued inside the function.
                with patch("app.queue.cancel_queued", new=AsyncMock(return_value=False)) as cancel_queued:
                    with patch("app.agent_runner.db.update_session", new=AsyncMock()) as update_session:
                        with patch("app.agent_runner._emit", new=AsyncMock()):
                            with patch("app.human_input.cancel", return_value=True):
                                ok = await agent_runner.control_agent("p1", "stop")

        self.assertTrue(ok, "stopping an orchestrator must succeed even without a live agent")
        stopped_ids = [c.args[0] for c in update_session.call_args_list if c.kwargs.get("status") == "stopped"]
        self.assertIn("p1", stopped_ids)
        self.assertIn("c1", stopped_ids)
        self.assertIn("c2", stopped_ids)
        self.assertNotIn("c3", stopped_ids, "terminal children should not be re-stopped")
        self.assertGreaterEqual(cancel_queued.await_count, 1, "stop should mark sessions cancelled for worker checks")


if __name__ == "__main__":
    unittest.main()

