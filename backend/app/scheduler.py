"""Background loop that fires due scheduled jobs (agent tasks + API test suites)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from . import db
from .config import session_dir, schedular_dir
from .queue import enqueue
from .run_opts import set_run_opts

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None
_POLL_SECONDS = 15

SCHEDULE_DELTAS = {
    "every_hour": timedelta(hours=1),
    "every_day": timedelta(days=1),
    "every_week": timedelta(weeks=1),
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.isoformat()


def next_run_after(schedule: str, from_dt: datetime | None = None) -> datetime:
    base = from_dt or utc_now()
    delta = SCHEDULE_DELTAS.get(schedule, SCHEDULE_DELTAS["every_hour"])
    return base + delta


def _build_task(job: dict) -> str:
    parts: list[str] = []
    start_url = (job.get("start_url") or "").strip()
    if start_url:
        parts.append(f"Start by opening {start_url}.")
    parts.append(job["task"].strip())
    sched = schedular_dir()
    parts.append(
        f"\n[Scheduled job — default file folder is schedular at {sched}. "
        "Read and write files there.]"
    )
    return "\n".join(parts)


async def _claim_job_slot(job: dict) -> str:
    jid = job["id"]
    nxt = next_run_after(job.get("schedule") or "every_hour")
    await db.update_scheduled_job(
        jid,
        last_run_at=to_iso(utc_now()),
        next_run_at=to_iso(nxt),
        last_error=None,
        status="active",
    )
    return to_iso(nxt)


async def _fire_agent_job(job: dict) -> str:
    """Create a browser-agent session and enqueue it. Returns session id."""
    nxt = await _claim_job_slot(job)
    task_text = _build_task(job)
    title_prefix = (job.get("name") or "Scheduled").strip() or "Scheduled"
    session = await db.create_session(task_text, job.get("model"), job.get("llm_provider"))
    sid = session["id"]
    await db.update_session(sid, title=f"[sched] {title_prefix}"[:60])
    session_dir(sid)

    set_run_opts(
        sid,
        max_steps=int(job.get("max_steps") or 100),
        extend_system_message=job.get("system_prompt") or None,
        use_schedular=True,
    )
    await enqueue(sid, task_text)
    await db.update_scheduled_job(job["id"], last_session_id=sid)
    logger.info("scheduled agent job %s fired → session %s; next=%s", job["id"], sid, nxt)
    return sid


async def _fire_api_test_job(job: dict) -> str:
    """Start an API Test Console suite run. Returns api_run id."""
    from .api_test import service as api_test_service

    nxt = await _claim_job_slot(job)
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    project_id = str(payload.get("project_id") or "").strip()
    if not project_id:
        raise ValueError("api_test scheduled job missing payload.project_id")
    flow_ids = payload.get("flow_ids")
    if flow_ids is not None and not isinstance(flow_ids, list):
        flow_ids = None

    run = await api_test_service.execute_run(
        project_id,
        flow_ids=flow_ids,
        wait=False,
    )
    run_id = str(run.get("id") or "")
    await db.update_scheduled_job(job["id"], last_run_id=run_id or None)
    # Mirror last/next onto project config for the API Test UI
    try:
        project = await db.get_api_project(project_id, include_raw=False)
        if project:
            cfg = dict(project.get("config") or {})
            schedule_cfg = dict(cfg.get("schedule") or {})
            schedule_cfg.update(
                {
                    "enabled": True,
                    "schedule": job.get("schedule") or "every_day",
                    "job_id": job["id"],
                    "last_run_at": to_iso(utc_now()),
                    "next_run_at": nxt,
                    "last_run_id": run_id or None,
                    "flow_ids": flow_ids,
                }
            )
            cfg["schedule"] = schedule_cfg
            cfg["schedule_job_id"] = job["id"]
            await db.update_api_project(project_id, config=cfg)
    except Exception:
        logger.exception("failed to mirror schedule onto api project %s", project_id)

    logger.info(
        "scheduled api_test job %s fired → run %s (project=%s); next=%s",
        job["id"],
        run_id,
        project_id,
        nxt,
    )
    return run_id


async def fire_job(job: dict) -> str | None:
    """
    Fire a due (or manual) scheduled job.
    Returns session_id for agent jobs, or api_run id for api_test jobs.
    """
    job_type = (job.get("job_type") or "agent").lower()
    if job_type == "api_test":
        return await _fire_api_test_job(job)
    return await _fire_agent_job(job)


async def _tick() -> None:
    now = utc_now()
    due = await db.list_due_scheduled_jobs(to_iso(now))
    for job in due:
        try:
            await fire_job(job)
        except Exception as e:
            logger.exception("failed to fire job %s", job.get("id"))
            try:
                await db.update_scheduled_job(
                    job["id"],
                    last_error=f"{type(e).__name__}: {e}",
                    next_run_at=to_iso(next_run_after(job.get("schedule") or "every_hour")),
                )
            except Exception:
                pass


async def _loop() -> None:
    logger.info("scheduler loop started (poll=%ss)", _POLL_SECONDS)
    while True:
        try:
            await _tick()
        except Exception:
            logger.exception("scheduler tick failed")
        await asyncio.sleep(_POLL_SECONDS)


async def start_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop())


async def stop_scheduler() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
