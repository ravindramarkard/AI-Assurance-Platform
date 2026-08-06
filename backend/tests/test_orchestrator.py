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


class TestOrchestratorResume(unittest.IsolatedAsyncioTestCase):
    PLAN = {
        "phases": [
            {
                "mode": "parallel",
                "branches": [
                    {"id": "b1", "title": "B1", "task": "Do B1"},
                    {"id": "b2", "title": "B2", "task": "Do B2"},
                ],
            }
        ]
    }

    async def test_resume_adopts_in_flight_child_instead_of_spawning_duplicate(self):
        existing = [
            {"id": "c_b1_a1", "branch_id": "b1", "status": "failed", "attempt": 1, "task": "Do B1"},
            {"id": "c_b1_a2", "branch_id": "b1", "status": "running", "attempt": 2, "task": "Do B1"},
        ]

        awaited: list[list[dict]] = []

        async def _await_children(parent_id, parent_task, children, *, cfg, runtime_url):
            awaited.append(children)
            return [
                {
                    "branch_id": c["branch_id"],
                    "title": c["title"],
                    "status": "completed",
                    "summary": None,
                    "error": None,
                    "child_id": c["child_id"],
                    "attempt": 1,
                }
                for c in children
            ]

        async def _spawn_children(parent_id, parent_task, branches, *, runtime_url):
            return [
                {
                    "child_id": f"new_{b['id']}",
                    "branch_id": b["id"],
                    "title": b["title"],
                    "task": b["task"],
                }
                for b in branches
            ]

        with patch("app.orchestrator._parent_runtime_url", return_value=None):
            with patch("app.orchestrator._emit", new=AsyncMock()):
                with patch(
                    "app.orchestrator.db.list_child_sessions", new=AsyncMock(return_value=existing)
                ):
                    with patch(
                        "app.orchestrator._spawn_children",
                        new=AsyncMock(side_effect=_spawn_children),
                    ):
                        with patch("app.orchestrator._spawn_child", new=AsyncMock()) as spawn_child:
                            with patch(
                                "app.orchestrator._await_children",
                                new=AsyncMock(side_effect=_await_children),
                            ):
                                with patch("app.orchestrator.queue.enqueue", new=AsyncMock()) as enqueue:
                                    with patch(
                                        "app.orchestrator.aggregate_results",
                                        new=AsyncMock(return_value="report"),
                                    ):
                                        with patch(
                                            "app.orchestrator.db.get_session",
                                            new=AsyncMock(return_value={"id": "p1", "status": "running"}),
                                        ):
                                            with patch(
                                                "app.orchestrator.db.update_session", new=AsyncMock()
                                            ):
                                                with patch(
                                                    "app.orchestrator.db.add_message", new=AsyncMock()
                                                ):
                                                    await orchestrator._run_orchestrator(
                                                        "p1", "Parent", self.PLAN, cfg={}
                                                    )

        self.assertEqual(spawn_child.await_count, 0)
        self.assertEqual(len(awaited), 1)
        by_branch = {c["branch_id"]: c["child_id"] for c in awaited[0]}
        # b1 reuses the highest-attempt in-flight child; only b2 gets a fresh one.
        self.assertEqual(by_branch, {"b1": "c_b1_a2", "b2": "new_b2"})
        self.assertEqual([c.args[0] for c in enqueue.call_args_list], ["c_b1_a2"])

    async def test_resume_reuses_completed_branch_without_rerunning(self):
        existing = [
            {"id": "c_b1", "branch_id": "b1", "status": "completed", "attempt": 1, "task": "Do B1"},
            {"id": "c_b2", "branch_id": "b2", "status": "completed", "attempt": 1, "task": "Do B2"},
        ]

        with patch("app.orchestrator._parent_runtime_url", return_value=None):
            with patch("app.orchestrator._emit", new=AsyncMock()):
                with patch(
                    "app.orchestrator.db.list_child_sessions", new=AsyncMock(return_value=existing)
                ):
                    with patch("app.orchestrator._branch_summary", new=AsyncMock(return_value="ok")):
                        with patch(
                            "app.orchestrator._spawn_children", new=AsyncMock(return_value=[])
                        ) as spawn_children:
                            with patch(
                                "app.orchestrator._await_children", new=AsyncMock()
                            ) as await_children:
                                with patch(
                                    "app.orchestrator.aggregate_results",
                                    new=AsyncMock(return_value="report"),
                                ) as aggregate:
                                    with patch(
                                        "app.orchestrator.db.get_session",
                                        new=AsyncMock(return_value={"id": "p1", "status": "running"}),
                                    ):
                                        with patch(
                                            "app.orchestrator.db.update_session", new=AsyncMock()
                                        ):
                                            with patch(
                                                "app.orchestrator.db.add_message", new=AsyncMock()
                                            ):
                                                await orchestrator._run_orchestrator(
                                                    "p1", "Parent", self.PLAN, cfg={}
                                                )

        self.assertEqual(await_children.await_count, 0)
        self.assertEqual(spawn_children.call_args.args[2], [])
        results = aggregate.call_args.args[1]
        self.assertEqual([r["branch_id"] for r in results], ["b1", "b2"])
        self.assertTrue(all(r["status"] == "completed" for r in results))


class TestOrchestratorStopRace(unittest.IsolatedAsyncioTestCase):
    async def test_stopped_parent_is_not_overwritten_by_aggregate(self):
        plan = {"phases": [{"mode": "parallel", "branches": [{"id": "b1", "title": "B1", "task": "Do B1"}]}]}

        async def _spawn_children(parent_id, parent_task, branches, *, runtime_url):
            return [{"child_id": "c1", "branch_id": "b1", "title": "B1", "task": "Do B1"}]

        async def _await_children(parent_id, parent_task, children, *, cfg, runtime_url):
            return [
                {
                    "branch_id": "b1",
                    "title": "B1",
                    "status": "completed",
                    "summary": "done",
                    "error": None,
                    "child_id": "c1",
                    "attempt": 1,
                }
            ]

        with patch("app.orchestrator._parent_runtime_url", return_value=None):
            with patch("app.orchestrator._emit", new=AsyncMock()):
                with patch("app.orchestrator.db.list_child_sessions", new=AsyncMock(return_value=[])):
                    with patch(
                        "app.orchestrator._spawn_children", new=AsyncMock(side_effect=_spawn_children)
                    ):
                        with patch(
                            "app.orchestrator._await_children", new=AsyncMock(side_effect=_await_children)
                        ):
                            with patch(
                                "app.orchestrator.db.get_session",
                                new=AsyncMock(return_value={"id": "p1", "status": "stopped"}),
                            ):
                                with patch(
                                    "app.orchestrator.aggregate_results", new=AsyncMock()
                                ) as aggregate:
                                    with patch(
                                        "app.orchestrator.db.update_session", new=AsyncMock()
                                    ) as update_session:
                                        with patch(
                                            "app.orchestrator.db.add_message", new=AsyncMock()
                                        ) as add_message:
                                            await orchestrator._run_orchestrator(
                                                "p1", "Parent", plan, cfg={}
                                            )

        self.assertEqual(aggregate.await_count, 0)
        self.assertEqual(add_message.await_count, 0)
        written = [c.kwargs.get("status") for c in update_session.call_args_list]
        self.assertNotIn("completed", written)
        self.assertNotIn("aggregating", written)


class TestMaybeStartPlannerFailure(unittest.IsolatedAsyncioTestCase):
    # Long enough that resolve_parallel_intent('auto', ...) reaches the planner.
    BIG_TASK = "- step one\n- step two\n- step three\n- step four\n"

    async def _run(self, *, force: bool, mode: str):
        sess = {"id": "p1", "force_parallel": 1 if force else 0, "task": "t", "role": "root"}
        with patch("app.orchestrator.db.get_session", new=AsyncMock(return_value=sess)):
            with patch(
                "app.orchestrator.effective_settings",
                new=AsyncMock(
                    return_value={"parallel_execution_mode": mode, "max_subagents_per_task": 4}
                ),
            ):
                with patch(
                    "app.orchestrator.plan_task",
                    new=AsyncMock(side_effect=ConnectionError("llm unreachable")),
                ):
                    with patch("app.orchestrator._emit", new=AsyncMock()):
                        with patch(
                            "app.orchestrator.db.update_session", new=AsyncMock()
                        ) as update_session:
                            handled = await orchestrator.maybe_start("p1", self.BIG_TASK)
        return handled, update_session

    async def test_auto_planner_connection_error_falls_back_to_single_agent(self):
        handled, update_session = await self._run(force=False, mode="auto")
        self.assertFalse(handled, "non-forced planner failure must fall back to the single-agent path")
        final = update_session.call_args_list[-1]
        self.assertEqual(final.kwargs.get("status"), "queued")
        self.assertEqual(final.kwargs.get("role"), "root")
        self.assertIsNone(final.kwargs.get("plan_json"))

    async def test_always_mode_planner_connection_error_fails_parent(self):
        handled, update_session = await self._run(force=False, mode="always")
        self.assertTrue(handled, "'always' mode must not silently downgrade")
        self.assertEqual(update_session.call_args_list[-1].kwargs.get("status"), "failed")

    async def test_forced_planner_connection_error_fails_parent(self):
        handled, update_session = await self._run(force=True, mode="auto")
        self.assertTrue(handled, "forced parallelism must not silently downgrade")
        final = update_session.call_args_list[-1]
        self.assertEqual(final.kwargs.get("status"), "failed")
        self.assertIn("ConnectionError", final.kwargs.get("error") or "")


if __name__ == "__main__":
    unittest.main()

