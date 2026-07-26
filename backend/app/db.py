from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import aiosqlite

from .config import settings

DB_PATH = settings.data_dir / "app.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    return db


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                task TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                model TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                error TEXT,
                step_count INTEGER NOT NULL DEFAULT 0,
                current_url TEXT
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scheduled_jobs (
                id TEXT PRIMARY KEY,
                name TEXT,
                task TEXT NOT NULL,
                schedule TEXT NOT NULL DEFAULT 'every_hour',
                model TEXT,
                max_steps INTEGER NOT NULL DEFAULT 100,
                start_url TEXT,
                system_prompt TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'active',
                last_run_at TEXT,
                next_run_at TEXT,
                last_session_id TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        await db.commit()


async def create_session(task: str, model: str | None = None) -> dict[str, Any]:
    sid = str(uuid4())
    title = task.strip().split("\n")[0][:60] or "Untitled agent"
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO sessions (id, title, task, status, model, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', ?, ?, ?)
            """,
            (sid, title, task, model, now, now),
        )
        await db.execute(
            """
            INSERT INTO messages (id, session_id, role, content, created_at)
            VALUES (?, ?, 'user', ?, ?)
            """,
            (str(uuid4()), sid, task, now),
        )
        await db.commit()
    return await get_session(sid)  # type: ignore[return-value]


async def get_session(session_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = await cur.fetchone()
        if not row:
            return None
        return dict(row)


async def list_sessions(limit: int = 100) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def update_session(session_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [session_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE sessions SET {cols} WHERE id = ?", values)
        await db.commit()


async def delete_session(session_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        cur = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cur.fetchone():
            return False
        await db.execute("DELETE FROM events WHERE session_id = ?", (session_id,))
        await db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await db.commit()
    return True


async def delete_all_sessions() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT id FROM sessions")
        ids = [r[0] for r in await cur.fetchall()]
        await db.execute("DELETE FROM events")
        await db.execute("DELETE FROM messages")
        await db.execute("DELETE FROM sessions")
        await db.commit()
    return len(ids)


async def list_session_ids() -> list[str]:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT id FROM sessions")
        return [r[0] for r in await cur.fetchall()]


async def add_message(session_id: str, role: str, content: str) -> dict[str, Any]:
    mid = str(uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO messages (id, session_id, role, content, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (mid, session_id, role, content, now),
        )
        await db.commit()
    return {"id": mid, "session_id": session_id, "role": role, "content": content, "created_at": now}


async def list_messages(session_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]


def _payload_for_storage(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop huge base64 screenshots from persisted/listed payloads (keep file path)."""
    if not payload or "screenshot_b64" not in payload:
        return payload
    slim = dict(payload)
    slim.pop("screenshot_b64", None)
    return slim


async def add_event(session_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    eid = str(uuid4())
    now = _now()
    stored = _payload_for_storage(payload)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO events (id, session_id, type, payload, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (eid, session_id, event_type, json.dumps(stored), now),
        )
        await db.commit()
    # Return original payload (may include b64) so live WS clients can render instantly.
    return {
        "id": eid,
        "session_id": session_id,
        "type": event_type,
        "payload": payload,
        "created_at": now,
    }


async def list_events(session_id: str, limit: int = 500) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM events WHERE session_id = ?
            ORDER BY created_at ASC LIMIT ?
            """,
            (session_id, limit),
        )
        rows = await cur.fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["payload"] = _payload_for_storage(json.loads(d["payload"]))
            out.append(d)
        return out


async def get_setting(key: str, default: str | None = None) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
        row = await cur.fetchone()
        return row[0] if row else default


async def set_setting(key: str, value: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO app_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        await db.commit()


async def get_all_settings() -> dict[str, str]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT key, value FROM app_settings")
        return {r["key"]: r["value"] for r in await cur.fetchall()}


def _job_row(row: aiosqlite.Row) -> dict[str, Any]:
    d = dict(row)
    d["enabled"] = bool(d.get("enabled"))
    return d


async def create_scheduled_job(
    *,
    task: str,
    name: str | None = None,
    schedule: str = "every_hour",
    model: str | None = None,
    max_steps: int = 100,
    start_url: str | None = None,
    system_prompt: str | None = None,
    next_run_at: str | None = None,
) -> dict[str, Any]:
    jid = str(uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO scheduled_jobs (
                id, name, task, schedule, model, max_steps, start_url, system_prompt,
                enabled, status, next_run_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)
            """,
            (
                jid,
                name,
                task,
                schedule,
                model,
                max_steps,
                start_url,
                system_prompt,
                next_run_at or now,
                now,
                now,
            ),
        )
        await db.commit()
    return await get_scheduled_job(jid)  # type: ignore[return-value]


async def get_scheduled_job(job_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM scheduled_jobs WHERE id = ?", (job_id,))
        row = await cur.fetchone()
        return _job_row(row) if row else None


async def list_scheduled_jobs() -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM scheduled_jobs ORDER BY created_at DESC"
        )
        return [_job_row(r) for r in await cur.fetchall()]


async def update_scheduled_job(job_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return await get_scheduled_job(job_id)
    if "enabled" in fields:
        fields["enabled"] = 1 if fields["enabled"] else 0
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [job_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE scheduled_jobs SET {cols} WHERE id = ?", values)
        await db.commit()
    return await get_scheduled_job(job_id)


async def delete_scheduled_job(job_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("DELETE FROM scheduled_jobs WHERE id = ?", (job_id,))
        await db.commit()
        return cur.rowcount > 0


async def list_due_scheduled_jobs(now_iso: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM scheduled_jobs
            WHERE enabled = 1
              AND status = 'active'
              AND next_run_at IS NOT NULL
              AND next_run_at <= ?
            ORDER BY next_run_at ASC
            """,
            (now_iso,),
        )
        return [_job_row(r) for r in await cur.fetchall()]
