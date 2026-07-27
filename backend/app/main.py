from __future__ import annotations

import getpass
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import settings
from .queue import start_workers, stop_workers
from .routes import (
    api_test,
    browsers,
    files,
    integrations,
    scheduled_jobs,
    sessions,
    settings as settings_routes,
)
from .scheduler import start_scheduler, stop_scheduler
from .ws import bus

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("bu_local")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await start_workers()
    await start_scheduler()
    logger.info("bu_local ready — data=%s", settings.data_dir)
    yield
    await stop_scheduler()
    await stop_workers()


app = FastAPI(title="AI Assurance Platform", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(files.router)
app.include_router(settings_routes.router)
app.include_router(browsers.router)
app.include_router(scheduled_jobs.router)
app.include_router(integrations.router)
app.include_router(api_test.router)


@app.get("/api/health")
async def health():
    try:
        username = getpass.getuser()
    except Exception:
        username = ""
    return {"ok": True, "service": "bu_local", "username": username}


@app.websocket("/ws/sessions/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str):
    await websocket.accept()
    await bus.subscribe(session_id, websocket)
    # Send backlog
    try:
        events = await db.list_events(session_id)
        for ev in events:
            await websocket.send_json(ev)
        await websocket.send_json({"type": "ready", "payload": {"session_id": session_id}})
        while True:
            # Keep alive; client may send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await bus.unsubscribe(session_id, websocket)


@app.websocket("/ws/api-runs/{run_id}")
async def api_run_ws(websocket: WebSocket, run_id: str):
    channel = f"api_run:{run_id}"
    await websocket.accept()
    await bus.subscribe(channel, websocket)
    try:
        events = await db.list_api_run_events(run_id)
        for ev in events:
            await websocket.send_json(ev)
        await websocket.send_json({"type": "ready", "payload": {"run_id": run_id}})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await bus.unsubscribe(channel, websocket)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )


if __name__ == "__main__":
    run()
