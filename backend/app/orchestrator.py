from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Literal, TypedDict

from . import db, queue, run_opts
from .llm_factory import effective_settings
from .parallel_plan import resolve_parallel_intent
from .planner import PlannerError, aggregate_results, plan_task
from .ws import bus

logger = logging.getLogger(__name__)

_TERMINAL_CHILD: set[str] = {"completed", "failed", "stopped"}
_POLL_S = 0.5


class Branch(TypedDict):
    id: str
    title: str
    task: str


class ChildHandle(TypedDict):
    child_id: str
    branch_id: str
    title: str
    task: str


async def _emit(session_id: str, event_type: str, payload: dict[str, Any]) -> None:
    event = await db.add_event(session_id, event_type, payload)
    await bus.publish(session_id, event)


def build_child_task(
    *,
    parent_task: str,
    branch_title: str,
    branch_task: str,
    runtime_url: str | None,
) -> str:
    rt = (runtime_url or "").strip()
    rt_line = f"\nRuntime URL (continue here if relevant): {rt}\n" if rt else "\n"
    return (
        "You are a child agent working on ONE branch of a larger parent task.\n"
        "Do not expand scope beyond this branch task. Do not add extra branches.\n"
        "If blocked, clearly report the blocker and what you tried.\n\n"
        f"Parent task:\n{(parent_task or '').strip()}\n\n"
        f"Branch: {str(branch_title or '').strip()}\n"
        f"Branch task:\n{str(branch_task or '').strip()}\n"
        f"{rt_line}"
        "Return a concise result for this branch only."
    ).strip() + "\n"


async def maybe_start(session_id: str, task: str) -> bool:
    """
    Return True when orchestration handles this session (caller must NOT also run_session).
    Return False when caller should run the normal single-agent path.
    """
    sess = await db.get_session(session_id)
    if not sess:
        return False
    if str(sess.get("role") or "root") == "child":
        return False

    cfg = await effective_settings()
    force = bool(sess.get("force_parallel"))
    mode = str(cfg.get("parallel_execution_mode") or "auto")
    if resolve_parallel_intent(mode, force, task) == "skip":
        return False

    await db.update_session(session_id, status="planning", error=None)
    await _emit(session_id, "status", {"status": "planning"})

    max_b = int(cfg.get("max_subagents_per_task") or 4)
    try:
        plan = await plan_task(
            task,
            cfg=cfg,
            max_branches=max_b,
            force=force or mode.strip().lower() == "always",
        )
    except PlannerError as e:
        err = str(e) or "planner_failed"
        await db.update_session(session_id, status="failed", error=err)
        await _emit(session_id, "error", {"error": err})
        await _emit(session_id, "status", {"status": "failed"})
        return True

    if not bool(plan.get("should_parallelize")):
        await db.update_session(session_id, status="queued", role="root", plan_json=None)
        await _emit(session_id, "status", {"status": "queued"})
        return False

    await db.update_session(
        session_id,
        role="orchestrator",
        plan_json=json.dumps(plan, ensure_ascii=False),
        status="running",
        error=None,
    )
    await _emit(session_id, "plan_ready", {"plan": plan})
    await _emit(session_id, "status", {"status": "running", "message": "Orchestrator started"})

    # CRITICAL: do not await child work here; free the queue worker slot.
    asyncio.create_task(_run_orchestrator(session_id, task, plan, cfg))
    return True


def _parent_runtime_url(parent_id: str) -> str | None:
    try:
        opts = run_opts.get_run_opts(parent_id)
    except Exception:
        opts = {}
    rt = (opts or {}).get("runtime_url")
    return str(rt).strip() if rt else None


async def _await_terminal(child_id: str, *, parent_id: str) -> dict[str, Any]:
    while True:
        if queue.is_cancelled(parent_id):
            raise asyncio.CancelledError()
        parent = await db.get_session(parent_id)
        if parent and parent.get("status") == "stopped":
            raise asyncio.CancelledError()

        row = await db.get_session(child_id)
        if row and str(row.get("status") or "").lower() in _TERMINAL_CHILD:
            return row
        await asyncio.sleep(_POLL_S)


async def _branch_summary(child_id: str) -> str | None:
    try:
        msgs = await db.list_messages(child_id)
    except Exception:
        return None
    assistants = [m for m in msgs if m.get("role") == "assistant"]
    if not assistants:
        return None
    return str(assistants[-1].get("content") or "").strip() or None


def _status_rollup(statuses: list[str]) -> Literal["completed", "partial", "failed"]:
    norm = [str(s or "").lower() for s in statuses]
    if norm and all(s == "completed" for s in norm):
        return "completed"
    if any(s == "completed" for s in norm) and any(s in ("failed", "stopped") for s in norm):
        return "partial"
    if any(s == "completed" for s in norm):
        return "partial"
    return "failed"


async def _await_children(
    parent_id: str,
    parent_task: str,
    children: list[ChildHandle],
    *,
    cfg: dict[str, Any],
    runtime_url: str | None,
) -> list[dict[str, Any]]:
    """
    Wait for children. If a child fails on attempt==1, retry once by spawning a new child session.
    Returns branch result dicts suitable for aggregate_results().
    """

    async def _wait_one(ch: ChildHandle) -> dict[str, Any]:
        child_id = ch["child_id"]
        branch_id = ch["branch_id"]
        title = ch["title"]
        branch_task = ch["task"]

        row = await _await_terminal(child_id, parent_id=parent_id)
        status = str(row.get("status") or "failed").lower()
        attempt = int(row.get("attempt") or 1)
        error = row.get("error")

        if status == "failed" and attempt <= 1:
            retry_task = build_child_task(
                parent_task=parent_task,
                branch_title=title,
                branch_task=branch_task,
                runtime_url=runtime_url,
            )
            new_child = await db.create_session(
                retry_task,
                parent_id=parent_id,
                role="child",
                branch_id=branch_id,
                force_parallel=False,
                attempt=2,
            )
            new_id = str(new_child["id"])
            if runtime_url:
                run_opts.set_run_opts(new_id, runtime_url=runtime_url)
            await _emit(parent_id, "child_retry", {"branch_id": branch_id, "child_id": new_id})
            await queue.enqueue(new_id, retry_task)
            row = await _await_terminal(new_id, parent_id=parent_id)
            status = str(row.get("status") or "failed").lower()
            attempt = int(row.get("attempt") or 2)
            error = row.get("error")
            child_id = new_id

        summary = await _branch_summary(child_id)
        return {
            "branch_id": branch_id,
            "title": title,
            "status": "completed" if status == "completed" else "failed",
            "summary": summary,
            "error": error,
            "child_id": child_id,
            "attempt": attempt,
        }

    results = await asyncio.gather(*[_wait_one(ch) for ch in children])
    return list(results)


async def _spawn_children(
    parent_id: str,
    parent_task: str,
    branches: list[Branch],
    *,
    runtime_url: str | None,
) -> list[ChildHandle]:
    out: list[ChildHandle] = []
    for br in branches:
        child_task = build_child_task(
            parent_task=parent_task,
            branch_title=br["title"],
            branch_task=br["task"],
            runtime_url=runtime_url,
        )
        child = await db.create_session(
            child_task,
            parent_id=parent_id,
            role="child",
            branch_id=br["id"],
            force_parallel=False,
            attempt=1,
        )
        cid = str(child["id"])
        if runtime_url:
            run_opts.set_run_opts(cid, runtime_url=runtime_url)
        await _emit(parent_id, "child_spawned", {"branch_id": br["id"], "child_id": cid, "title": br["title"]})
        await queue.enqueue(cid, child_task)
        out.append({"child_id": cid, "branch_id": br["id"], "title": br["title"], "task": br["task"]})
    return out


async def _run_orchestrator(
    parent_id: str,
    parent_task: str,
    plan: dict[str, Any],
    cfg: dict[str, Any],
) -> None:
    runtime_url = _parent_runtime_url(parent_id)
    all_results: list[dict[str, Any]] = []

    try:
        phases = list(plan.get("phases") or [])
        for ph in phases:
            mode = str((ph or {}).get("mode") or "parallel").strip().lower()
            branches = list((ph or {}).get("branches") or [])
            if not branches:
                continue

            kids = await _spawn_children(
                parent_id,
                parent_task,
                branches,  # type: ignore[arg-type]
                runtime_url=runtime_url,
            )

            await _emit(parent_id, "phase_started", {"mode": mode, "count": len(kids)})
            if mode == "serial":
                for ch in kids:
                    res = await _await_children(
                        parent_id,
                        parent_task,
                        [ch],
                        cfg=cfg,
                        runtime_url=runtime_url,
                    )
                    all_results.extend(res)
            else:
                res = await _await_children(
                    parent_id,
                    parent_task,
                    kids,
                    cfg=cfg,
                    runtime_url=runtime_url,
                )
                all_results.extend(res)
            await _emit(parent_id, "phase_finished", {"mode": mode})

        report = await aggregate_results(parent_task, all_results, cfg=cfg)
        final_status = _status_rollup([r.get("status") for r in all_results])  # type: ignore[arg-type]
        await db.update_session(parent_id, status=final_status, aggregate_report=report, error=None)
        await db.add_message(parent_id, "assistant", report)
        await _emit(parent_id, "message", {"role": "assistant", "content": report})
        await _emit(parent_id, "aggregate_ready", {"status": final_status})
        await _emit(parent_id, "status", {"status": final_status})
    except asyncio.CancelledError:
        await db.update_session(parent_id, status="stopped")
        await _emit(parent_id, "status", {"status": "stopped", "message": "Cancelled"})
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        logger.exception("orchestrator failed for %s", parent_id)
        await db.update_session(parent_id, status="failed", error=err)
        await _emit(parent_id, "error", {"error": err})
        await _emit(parent_id, "status", {"status": "failed"})

