from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from .. import db
from ..config import session_dir
from ..models import FileContent, FileEntry
from ..recording_gif import build_recording_gif

router = APIRouter(prefix="/api/sessions/{session_id}/files", tags=["files"])


def _workspace(session_id: str) -> Path:
    return session_dir(session_id) / "workspace"


def _safe(session_id: str, rel: str) -> Path:
    base = _workspace(session_id).resolve()
    target = (base / rel).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(400, "Invalid path")
    return target


def _resolve_file(session_id: str, path: str) -> Path:
    """Resolve a Files-tab path against workspace or screenshots/."""
    clean = (path or "").strip().lstrip("./")
    if clean.startswith("screenshots/"):
        target = (session_dir(session_id) / clean).resolve()
        base = (session_dir(session_id) / "screenshots").resolve()
        if not str(target).startswith(str(base)):
            raise HTTPException(400, "Invalid path")
        return target

    direct = _safe(session_id, clean)
    if direct.exists() and direct.is_file():
        return direct

    # Basename fallback: UI / events often pass "top_news.html" while the file
    # lives under browseruse_agent_data/top_news.html
    name = Path(clean).name
    if name:
        matches = [p for p in _workspace(session_id).rglob(name) if p.is_file()]
        if matches:
            matches.sort(
                key=lambda p: (
                    0 if "browseruse_agent_data" in p.parts else 1,
                    -p.stat().st_mtime,
                )
            )
            return matches[0]

    return direct


def _session_roots(session_id: str) -> list[tuple[str, Path]]:
    """Logical roots exposed in the Files tab: workspace + screenshots."""
    base = session_dir(session_id)
    return [
        ("", base / "workspace"),
        ("screenshots", base / "screenshots"),
    ]


@router.get("")
async def list_files(session_id: str):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    entries: list[FileEntry] = []
    for prefix, root in _session_roots(session_id):
        if not root.exists():
            continue
        for p in sorted(root.rglob("*")):
            rel_inner = str(p.relative_to(root))
            rel = f"{prefix}/{rel_inner}" if prefix else rel_inner
            entries.append(
                FileEntry(
                    path=rel,
                    name=p.name,
                    is_dir=p.is_dir(),
                    size=p.stat().st_size if p.is_file() else None,
                )
            )
    return entries


@router.post("/recording-gif")
async def create_recording_gif(
    session_id: str,
    duration_ms: int = Query(280, ge=80, le=2000),
):
    """Stitch sequential live_####.png (or step_####.png) into screenshots/recording.gif."""
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    try:
        return build_recording_gif(session_dir(session_id), duration_ms=duration_ms)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"GIF generation failed: {e}") from e


@router.get("/content")
async def read_file(session_id: str, path: str):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    target = _resolve_file(session_id, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "File not found")
    rel_out = path
    try:
        if "screenshots" in target.parts:
            rel_out = f"screenshots/{target.name}"
        else:
            rel_out = str(target.relative_to(_workspace(session_id)))
    except Exception:
        pass
    if target.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return FileContent(
            path=rel_out,
            content=f"[image {target.stat().st_size} bytes — open Browser tab for preview]",
        )
    if target.suffix.lower() == ".pdf":
        return FileContent(
            path=rel_out,
            content=f"[PDF {target.stat().st_size:,} bytes — preview in Artifacts panel]",
        )
    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = f"[binary file, {target.stat().st_size} bytes]"
    return FileContent(path=rel_out, content=content)


@router.get("/raw")
async def raw_file(session_id: str, path: str):
    """Serve a workspace file inline (HTML iframe preview / open in tab)."""
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    target = _resolve_file(session_id, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "File not found")
    media, _ = mimetypes.guess_type(str(target))
    media_type = media or "application/octet-stream"
    suffix = target.suffix.lower()
    # Inline for iframe/embed previews — FileResponse(filename=...) defaults to
    # attachment, which leaves HTML/PDF iframes blank.
    if suffix in {".html", ".htm", ".svg", ".xml", ".css", ".js", ".json", ".txt", ".md", ".pdf"}:
        data = target.read_bytes()
        if suffix in {".html", ".htm"}:
            media_type = "text/html; charset=utf-8"
        elif suffix == ".pdf":
            media_type = "application/pdf"
        return Response(
            content=data,
            media_type=media_type,
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": f'inline; filename="{target.name}"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    return FileResponse(
        target,
        media_type=media_type,
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'inline; filename="{target.name}"',
        },
    )
