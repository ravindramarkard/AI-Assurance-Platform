from __future__ import annotations

import asyncio
import logging
from collections import deque

from . import agent_runner
from .config import settings

logger = logging.getLogger(__name__)

_queue: deque[tuple[str, str]] = deque()
_workers: list[asyncio.Task] = []
_started = False
_lock = asyncio.Lock()
_cancelled: set[str] = set()
_target_workers = 1


async def dispatch_session(session_id: str, task: str) -> None:
    """
    Dispatch one queue item.

    If the orchestrator takes over (maybe_start=True), return early so the
    worker slot is freed and we do not double-run the session.
    """
    from . import orchestrator

    handled = await orchestrator.maybe_start(session_id, task)
    if handled:
        return
    await agent_runner.run_session(session_id, task)


async def enqueue(session_id: str, task: str) -> None:
    async with _lock:
        _cancelled.discard(session_id)
        _queue.append((session_id, task))
        depth = len(_queue)
    logger.info("enqueued session %s (queue=%d)", session_id, depth)


async def cancel_queued(session_id: str) -> bool:
    """Remove a session from the wait queue (or mark it so the worker skips it)."""
    removed = False
    async with _lock:
        before = len(_queue)
        kept = deque(item for item in _queue if item[0] != session_id)
        if len(kept) != before:
            _queue.clear()
            _queue.extend(kept)
            removed = True
        _cancelled.add(session_id)
    if removed:
        logger.info("cancelled queued session %s (queue=%d)", session_id, len(_queue))
    return removed


def is_cancelled(session_id: str) -> bool:
    return session_id in _cancelled


def clear_cancelled(session_id: str) -> None:
    _cancelled.discard(session_id)


async def _worker(worker_id: int) -> None:
    logger.info("worker %d started", worker_id)
    while True:
        item = None
        async with _lock:
            if _queue:
                item = _queue.popleft()
        if item is None:
            await asyncio.sleep(0.25)
            continue
        session_id, task = item
        if is_cancelled(session_id):
            clear_cancelled(session_id)
            logger.info("worker %d skip cancelled session %s", worker_id, session_id)
            continue
        logger.info("worker %d running session %s", worker_id, session_id)
        try:
            await dispatch_session(session_id, task)
        except Exception:
            logger.exception("worker %d crash on %s", worker_id, session_id)
        finally:
            clear_cancelled(session_id)


async def recover_stuck_sessions() -> None:
    """Re-enqueue DB sessions stuck in queued/running after a process restart."""
    from . import db

    try:
        sessions = await db.list_sessions(include_children=True)
    except Exception:
        logger.exception("recover_stuck_sessions: list failed")
        return
    n = 0
    for s in sessions:
        if s.get("status") in ("queued", "running", "planning", "aggregating"):
            sid = s["id"]
            task = s.get("task") or ""
            await db.update_session(sid, status="queued", error=None)
            await enqueue(sid, task)
            n += 1
    if n:
        logger.info("re-enqueued %d stuck session(s)", n)


def _spawn_workers(n: int) -> None:
    global _target_workers
    n = max(1, min(int(n), 8))
    _target_workers = n
    while len(_workers) < n:
        i = len(_workers)
        _workers.append(asyncio.create_task(_worker(i)))
        logger.info("spawned agent worker %d (total=%d)", i, len(_workers))


async def start_workers() -> None:
    global _started
    if _started:
        return
    _started = True
    n = max(1, min(int(settings.max_concurrent_agents), 8))
    _spawn_workers(n)
    logger.info("started %d agent workers (max_concurrent_agents=%d)", n, n)
    await recover_stuck_sessions()


async def scale_workers(n: int) -> int:
    """Grow the worker pool to match settings (shrinking waits for idle exits)."""
    n = max(1, min(int(n), 8))
    before = len(_workers)
    _spawn_workers(n)
    if n < before:
        logger.info(
            "max_concurrent_agents reduced to %d; %d worker(s) remain until restart "
            "(extra workers finish current jobs then idle)",
            n,
            before,
        )
    return len(_workers)


async def stop_workers() -> None:
    global _started
    for t in _workers:
        t.cancel()
    _workers.clear()
    _started = False


def queue_size() -> int:
    return len(_queue)


def worker_count() -> int:
    return len(_workers)


def target_worker_count() -> int:
    return _target_workers
