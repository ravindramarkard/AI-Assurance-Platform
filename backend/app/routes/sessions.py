from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import db
from ..agent_runner import control_agent, follow_up
from ..browser_factory import stop_browser
from ..config import session_dir, settings
from ..models import CreateSessionRequest, MessageRequest, SessionControlRequest
from ..queue import enqueue
from ..run_opts import set_run_opts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB per file
MAX_UPLOAD_FILES = 10


def _safe_filename(name: str) -> str:
    base = Path(name or "upload.bin").name
    base = re.sub(r"[^\w.\- ()\[\]]+", "_", base).strip(" ._") or "upload.bin"
    return base[:180]


async def _save_uploads(session_id: str, files: list[UploadFile]) -> list[str]:
    if not files:
        return []
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(400, f"Max {MAX_UPLOAD_FILES} attachments")
    upload_dir = session_dir(session_id) / "workspace" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    for uf in files:
        if not uf.filename:
            continue
        raw = await uf.read()
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(400, f"{uf.filename} exceeds 25MB limit")
        fname = _safe_filename(uf.filename)
        dest = upload_dir / fname
        # avoid overwrite collisions
        n = 1
        while dest.exists():
            dest = upload_dir / f"{Path(fname).stem}_{n}{Path(fname).suffix}"
            n += 1
        dest.write_bytes(raw)
        rel = f"uploads/{dest.name}"
        saved.append(rel)
        await db.add_event(
            session_id,
            "file_written",
            {"path": rel, "name": dest.name, "source": "attachment"},
        )
    return saved


def _task_with_attachments(task: str, saved: list[str]) -> str:
    if not saved:
        return task
    listing = "\n".join(f"- workspace/{p}" for p in saved)
    return (
        f"{task.rstrip()}\n\n"
        f"[Attached files saved under the session workspace — use them as needed:]\n{listing}"
    )


@router.get("")
async def list_sessions():
    return await db.list_sessions()


@router.post("")
async def create_session(body: CreateSessionRequest):
    session = await db.create_session(body.task, body.model)
    session_dir(session["id"])
    runtime = (body.runtime_url or "").strip() or None
    if runtime:
        set_run_opts(session["id"], runtime_url=runtime)
    await enqueue(session["id"], body.task)
    return session


async def _purge_session_files(session_id: str) -> None:
    try:
        stop_browser(session_id)
    except Exception:
        pass
    try:
        await control_agent(session_id, "stop")
    except Exception:
        pass
    path = settings.data_dir / "sessions" / session_id
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


@router.delete("")
async def clear_history():
    """Delete all sessions, events, messages, and on-disk session data."""
    ids = await db.list_session_ids()
    for sid in ids:
        await _purge_session_files(sid)
    n = await db.delete_all_sessions()
    return {"ok": True, "deleted": n}


@router.delete("/{session_id}")
async def delete_session(session_id: str):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    await _purge_session_files(session_id)
    ok = await db.delete_session(session_id)
    if not ok:
        raise HTTPException(404, "Session not found")
    return {"ok": True, "id": session_id}


@router.post("/with-files")
async def create_session_with_files(
    task: str = Form(...),
    model: str | None = Form(None),
    runtime_url: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
):
    """Create a session and persist uploaded attachments into workspace/uploads/."""
    task = (task or "").strip()
    if not task:
        raise HTTPException(400, "Task is required")
    real_files = [f for f in (files or []) if f.filename]
    session = await db.create_session(task, model)
    sid = session["id"]
    session_dir(sid)
    saved = await _save_uploads(sid, real_files)
    final_task = _task_with_attachments(task, saved)
    if saved:
        await db.update_session(sid, task=final_task)
        await db.add_message(
            sid,
            "user",
            f"Attached {len(saved)} file(s): " + ", ".join(Path(p).name for p in saved),
        )
    runtime = (runtime_url or "").strip() or None
    if runtime:
        set_run_opts(sid, runtime_url=runtime)
    await enqueue(sid, final_task)
    session = await db.get_session(sid)
    return {**(session or {}), "attachments": saved}


@router.get("/{session_id}")
async def get_session(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.get("/{session_id}/messages")
async def get_messages(session_id: str):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    return await db.list_messages(session_id)


@router.get("/{session_id}/events")
async def get_events(session_id: str):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    return await db.list_events(session_id)


@router.post("/{session_id}/messages")
async def post_message(session_id: str, body: MessageRequest):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    await follow_up(session_id, body.content)
    return {"ok": True}


@router.post("/{session_id}/control")
async def session_control(session_id: str, body: SessionControlRequest):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    ok = await control_agent(session_id, body.action)
    if not ok:
        raise HTTPException(409, "Agent not running or action unsupported")
    return {"ok": True}


@router.get("/{session_id}/screenshot/{filename}")
async def get_screenshot(session_id: str, filename: str):
    # Accept "screenshots/foo.png" or bare "foo.png"
    name = Path(filename).name
    path = session_dir(session_id) / "screenshots" / name
    if not path.exists():
        # fallback to rolling latest
        latest = session_dir(session_id) / "screenshots" / "latest.png"
        if latest.exists():
            path = latest
        else:
            raise HTTPException(404, "Screenshot not found")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )
