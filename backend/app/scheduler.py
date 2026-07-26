"""Background loop that fires due scheduled jobs into the agent queue."""

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


async def fire_job(job: dict) -> str | None:
    """Create a session for the job and enqueue it. Returns session id."""
    jid = job["id"]
    # Claim the slot immediately so a concurrent tick cannot double-fire
    nxt = next_run_after(job.get("schedule") or "every_hour")
    await db.update_scheduled_job(
        jid,
        last_run_at=to_iso(utc_now()),
        next_run_at=to_iso(nxt),
        last_error=None,
        status="active",
    )

    task_text = _build_task(job)
    title_prefix = (job.get("name") or "Scheduled").strip() or "Scheduled"
    session = await db.create_session(task_text, job.get("model"))
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
    await db.update_scheduled_job(jid, last_session_id=sid)
    logger.info("scheduled job %s fired → session %s; next=%s", jid, sid, nxt.isoformat())
    return sid


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
