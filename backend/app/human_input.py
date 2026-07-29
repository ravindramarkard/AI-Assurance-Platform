"""In-process human-in-the-loop waits for live agent sessions."""

from __future__ import annotations

import asyncio
from uuid import uuid4

_lock = asyncio.Lock()
_futures: dict[str, asyncio.Future[str]] = {}
_meta: dict[str, dict[str, str]] = {}


class HumanInputCancelled(Exception):
    def __init__(self, reason: str = "stopped") -> None:
        self.reason = reason
        super().__init__(reason)


def get_pending(session_id: str) -> dict[str, str] | None:
    meta = _meta.get(session_id)
    return dict(meta) if meta else None


def submit(session_id: str, value: str, request_id: str | None = None) -> bool:
    trimmed = (value or "").strip()
    if not trimmed:
        return False
    fut = _futures.get(session_id)
    meta = _meta.get(session_id)
    if fut is None or meta is None or fut.done():
        return False
    if request_id is not None and request_id != meta.get("request_id"):
        return False
    fut.set_result(trimmed)
    return True


def cancel(session_id: str, reason: str = "stopped") -> bool:
    fut = _futures.get(session_id)
    if fut is None or fut.done():
        _futures.pop(session_id, None)
        _meta.pop(session_id, None)
        return False
    fut.set_exception(HumanInputCancelled(reason))
    return True


async def begin_wait(
    session_id: str, prompt: str, input_type: str = "text"
) -> tuple[str, str]:
    """Block until submit() or cancel(). Returns (request_id, value)."""
    async with _lock:
        # Replace any stale pending wait for this session
        old = _futures.get(session_id)
        if old is not None and not old.done():
            old.set_exception(HumanInputCancelled("replaced"))
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[str] = loop.create_future()
        request_id = str(uuid4())
        itype = input_type if input_type in ("otp", "text") else "text"
        _futures[session_id] = fut
        _meta[session_id] = {
            "request_id": request_id,
            "prompt": (prompt or "").strip() or "Human input required",
            "input_type": itype,
        }

    try:
        value = await fut
        return request_id, value
    finally:
        # Only clear if we still own this session's wait (a replacement must not be wiped)
        if _futures.get(session_id) is fut:
            _futures.pop(session_id, None)
        if _meta.get(session_id, {}).get("request_id") == request_id:
            _meta.pop(session_id, None)
