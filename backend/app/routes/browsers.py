from __future__ import annotations

from fastapi import APIRouter

from ..agent_runner import running_count
from ..llm_factory import effective_settings
from ..queue import queue_size, target_worker_count, worker_count

router = APIRouter(prefix="/api/browsers", tags=["browsers"])

_ENGINE_LABELS = {
    "chromium": "Local Chromium",
    "chrome": "Local Chrome",
    "custom": "Custom browser",
}


@router.get("")
async def browser_status():
    active = running_count()
    cfg = await effective_settings()
    engine = str(cfg.get("browser_engine") or "chromium")
    max_n = int(cfg.get("max_concurrent_agents") or target_worker_count() or 1)
    return {
        "browsers": [
            {
                "id": f"local-{engine}",
                "name": _ENGINE_LABELS.get(engine, "Local browser"),
                "engine": engine,
                "status": "busy" if active else "idle",
                "active_sessions": active,
                "queued": queue_size(),
            }
        ],
        "active_sessions": active,
        "queued": queue_size(),
        "max_concurrent_agents": max_n,
        "workers": worker_count(),
    }
