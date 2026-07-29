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

            CREATE TABLE IF NOT EXISTS api_projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                base_url TEXT NOT NULL DEFAULT '',
                openapi_url TEXT NOT NULL DEFAULT '',
                openapi_raw TEXT NOT NULL DEFAULT '',
                config_json TEXT NOT NULL DEFAULT '{}',
                security_schemes_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS api_services (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                key TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                base_url TEXT NOT NULL DEFAULT '',
                openapi_url TEXT NOT NULL DEFAULT '',
                openapi_raw TEXT NOT NULL DEFAULT '',
                security_schemes_json TEXT NOT NULL DEFAULT '{}',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(project_id, key),
                FOREIGN KEY(project_id) REFERENCES api_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_auth (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                scheme_name TEXT NOT NULL,
                scheme_type TEXT NOT NULL DEFAULT '',
                secrets_json TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL,
                UNIQUE(project_id, scheme_name),
                FOREIGN KEY(project_id) REFERENCES api_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_baselines (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                schema_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES api_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_endpoints (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                operation_id TEXT NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]',
                summary TEXT NOT NULL DEFAULT '',
                meta_json TEXT NOT NULL DEFAULT '{}',
                last_status TEXT,
                FOREIGN KEY(project_id) REFERENCES api_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_flows (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'happy',
                resource TEXT NOT NULL DEFAULT '',
                steps_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES api_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_runs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                summary_json TEXT NOT NULL DEFAULT '{}',
                error TEXT,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES api_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_run_steps (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                idx INTEGER NOT NULL DEFAULT 0,
                flow_name TEXT NOT NULL DEFAULT '',
                method TEXT NOT NULL DEFAULT '',
                path TEXT NOT NULL DEFAULT '',
                operation_id TEXT,
                status TEXT NOT NULL DEFAULT 'fail',
                latency_ms REAL NOT NULL DEFAULT 0,
                detail_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(run_id) REFERENCES api_runs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_anomalies (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                run_id TEXT,
                endpoint TEXT,
                finding TEXT NOT NULL,
                confidence INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES api_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_run_events (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(run_id) REFERENCES api_runs(id) ON DELETE CASCADE
            );
            """
        )
        await db.commit()
        await _ensure_column(db, "scheduled_jobs", "job_type", "TEXT NOT NULL DEFAULT 'agent'")
        await _ensure_column(db, "scheduled_jobs", "payload_json", "TEXT NOT NULL DEFAULT '{}'")
        await _ensure_column(db, "scheduled_jobs", "last_run_id", "TEXT")
        await _ensure_column(db, "sessions", "llm_provider", "TEXT")
        await _ensure_column(db, "scheduled_jobs", "llm_provider", "TEXT")
        await db.commit()


async def _ensure_column(db: aiosqlite.Connection, table: str, column: str, decl: str) -> None:
    cur = await db.execute(f"PRAGMA table_info({table})")
    cols = {row[1] for row in await cur.fetchall()}
    if column not in cols:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


async def create_session(
    task: str, model: str | None = None, llm_provider: str | None = None
) -> dict[str, Any]:
    sid = str(uuid4())
    title = task.strip().split("\n")[0][:60] or "Untitled agent"
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO sessions (id, title, task, status, model, llm_provider, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)
            """,
            (sid, title, task, model, llm_provider, now, now),
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


async def delete_setting(key: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM app_settings WHERE key = ?", (key,))
        await db.commit()


async def get_all_settings() -> dict[str, str]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT key, value FROM app_settings")
        return {r["key"]: r["value"] for r in await cur.fetchall()}


def _job_row(row: aiosqlite.Row) -> dict[str, Any]:
    d = dict(row)
    d["enabled"] = bool(d.get("enabled"))
    d["job_type"] = d.get("job_type") or "agent"
    payload = d.get("payload_json")
    if isinstance(payload, str):
        try:
            d["payload"] = json.loads(payload) if payload else {}
        except Exception:
            d["payload"] = {}
    elif isinstance(payload, dict):
        d["payload"] = payload
    else:
        d["payload"] = {}
    return d


async def create_scheduled_job(
    *,
    task: str,
    name: str | None = None,
    schedule: str = "every_hour",
    model: str | None = None,
    llm_provider: str | None = None,
    max_steps: int = 100,
    start_url: str | None = None,
    system_prompt: str | None = None,
    next_run_at: str | None = None,
    enabled: bool = True,
    job_type: str = "agent",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    jid = str(uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO scheduled_jobs (
                id, name, task, schedule, model, llm_provider, max_steps, start_url, system_prompt,
                enabled, status, next_run_at, created_at, updated_at,
                job_type, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
            """,
            (
                jid,
                name,
                task,
                schedule,
                model,
                llm_provider,
                max_steps,
                start_url,
                system_prompt,
                1 if enabled else 0,
                next_run_at or now,
                now,
                now,
                job_type or "agent",
                json.dumps(payload or {}),
            ),
        )
        await db.commit()
    return await get_scheduled_job(jid)  # type: ignore[return-value]


async def find_api_test_scheduled_job(project_id: str) -> dict[str, Any] | None:
    """Find the scheduled_jobs row for an API test project (by payload.project_id)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM scheduled_jobs WHERE job_type = 'api_test' ORDER BY updated_at DESC"
        )
        rows = await cur.fetchall()
    for row in rows:
        job = _job_row(row)
        if str((job.get("payload") or {}).get("project_id") or "") == project_id:
            return job
    return None


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
    if "payload" in fields:
        fields["payload_json"] = json.dumps(fields.pop("payload") or {})
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


# ── API Test Console ─────────────────────────────────────────────────────────


def _default_api_config() -> dict[str, Any]:
    return {
        "generation_budget": 40,
        "flaky_threshold": 0.3,
        "allow_private_urls": False,
        "latency_budget_ms": 5000,
        "include_negative": True,
        "include_edge": True,
    }


def _parse_json(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _project_row(row: aiosqlite.Row) -> dict[str, Any]:
    d = dict(row)
    d["config"] = {**_default_api_config(), **_parse_json(d.pop("config_json", "{}"), {})}
    d["security_schemes"] = _parse_json(d.pop("security_schemes_json", "{}"), {})
    # omit huge raw from list views — callers can request full
    return d


def _slugify_service_key(key: str) -> str:
    import re

    s = re.sub(r"[^a-zA-Z0-9_-]+", "", (key or "").strip().lower().replace(" ", "_"))
    s = re.sub(r"_+", "_", s).strip("_-")
    return s or "default"


def _service_row(row: aiosqlite.Row, *, include_raw: bool = True) -> dict[str, Any]:
    d = dict(row)
    d["security_schemes"] = _parse_json(d.pop("security_schemes_json", "{}"), {})
    if not include_raw:
        d.pop("openapi_raw", None)
    return d


async def create_api_project(
    *,
    name: str,
    base_url: str = "",
    openapi_url: str = "",
    config: dict[str, Any] | None = None,
    seed_services: bool = True,
) -> dict[str, Any]:
    pid = str(uuid4())
    now = _now()
    cfg = {**_default_api_config(), **(config or {})}
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO api_projects (
                id, name, base_url, openapi_url, openapi_raw, config_json,
                security_schemes_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, '', ?, '{}', ?, ?)
            """,
            (pid, name, base_url, openapi_url, json.dumps(cfg), now, now),
        )
        await db.commit()
    if seed_services:
        # Suggested dual-service starter; user can edit/remove.
        await _insert_api_service(
            pid,
            key="backend",
            name="Backend",
            base_url=base_url,
            openapi_url=openapi_url,
            openapi_raw="",
            security_schemes={},
            sort_order=0,
        )
        await _insert_api_service(
            pid,
            key="ai",
            name="AI",
            base_url="",
            openapi_url="",
            openapi_raw="",
            security_schemes={},
            sort_order=1,
        )
        await mirror_primary_service_to_project(pid)
    elif base_url or openapi_url:
        await _insert_api_service(
            pid,
            key="default",
            name="Default",
            base_url=base_url,
            openapi_url=openapi_url,
            openapi_raw="",
            security_schemes={},
            sort_order=0,
        )
    return await get_api_project(pid)  # type: ignore[return-value]


async def get_api_project(project_id: str, *, include_raw: bool = True) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM api_projects WHERE id = ?", (project_id,))
        row = await cur.fetchone()
        if not row:
            return None
        d = _project_row(row)
        if not include_raw:
            d.pop("openapi_raw", None)
        return d


async def list_api_projects() -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM api_projects ORDER BY updated_at DESC")
        out = []
        for r in await cur.fetchall():
            d = _project_row(r)
            d.pop("openapi_raw", None)
            out.append(d)
        return out


async def update_api_project(project_id: str, **fields: Any) -> dict[str, Any] | None:
    if "config" in fields:
        incoming = fields.pop("config") or {}
        existing = await get_api_project(project_id, include_raw=False)
        prev = (existing or {}).get("config") or {}
        fields["config_json"] = json.dumps({**_default_api_config(), **prev, **incoming})
    if "security_schemes" in fields:
        fields["security_schemes_json"] = json.dumps(fields.pop("security_schemes") or {})
    if not fields:
        return await get_api_project(project_id)
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [project_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE api_projects SET {cols} WHERE id = ?", values)
        await db.commit()
    return await get_api_project(project_id)


async def delete_api_project(project_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        cur = await db.execute("DELETE FROM api_projects WHERE id = ?", (project_id,))
        await db.commit()
        return cur.rowcount > 0


async def list_api_services(
    project_id: str, *, include_raw: bool = False, synthesize_legacy: bool = True
) -> list[dict[str, Any]]:
    """List named services. If none exist, optionally synthesize a legacy default from project columns."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM api_services
            WHERE project_id = ?
            ORDER BY sort_order ASC, created_at ASC
            """,
            (project_id,),
        )
        rows = await cur.fetchall()
    if rows:
        return [_service_row(r, include_raw=include_raw) for r in rows]
    if not synthesize_legacy:
        return []
    project = await get_api_project(project_id, include_raw=True)
    if not project:
        return []
    has_legacy = bool(
        (project.get("base_url") or "").strip()
        or (project.get("openapi_url") or "").strip()
        or (project.get("openapi_raw") or "").strip()
    )
    if not has_legacy:
        return []
    synthetic = {
        "id": f"legacy:{project_id}",
        "project_id": project_id,
        "key": "default",
        "name": "Default",
        "base_url": project.get("base_url") or "",
        "openapi_url": project.get("openapi_url") or "",
        "security_schemes": project.get("security_schemes") or {},
        "sort_order": 0,
        "created_at": project.get("created_at") or "",
        "updated_at": project.get("updated_at") or "",
        "synthetic": True,
    }
    if include_raw:
        synthetic["openapi_raw"] = project.get("openapi_raw") or ""
    return [synthetic]


async def get_api_service(service_id: str, *, include_raw: bool = True) -> dict[str, Any] | None:
    if service_id.startswith("legacy:"):
        project_id = service_id.split(":", 1)[1]
        services = await list_api_services(project_id, include_raw=include_raw, synthesize_legacy=True)
        return next((s for s in services if s.get("id") == service_id), None)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM api_services WHERE id = ?", (service_id,))
        row = await cur.fetchone()
        if not row:
            return None
        return _service_row(row, include_raw=include_raw)


async def create_api_service(
    project_id: str,
    *,
    key: str,
    name: str = "",
    base_url: str = "",
    openapi_url: str = "",
    sort_order: int | None = None,
) -> dict[str, Any]:
    # Persist legacy project into a real default row before adding more services.
    existing = await list_api_services(project_id, include_raw=True, synthesize_legacy=False)
    if not existing:
        project = await get_api_project(project_id, include_raw=True)
        if project and (
            (project.get("base_url") or "").strip()
            or (project.get("openapi_url") or "").strip()
            or (project.get("openapi_raw") or "").strip()
        ):
            await _insert_api_service(
                project_id,
                key="default",
                name="Default",
                base_url=project.get("base_url") or "",
                openapi_url=project.get("openapi_url") or "",
                openapi_raw=project.get("openapi_raw") or "",
                security_schemes=project.get("security_schemes") or {},
                sort_order=0,
            )
            existing = await list_api_services(project_id, include_raw=False, synthesize_legacy=False)

    slug = _slugify_service_key(key)
    if any(s.get("key") == slug for s in existing):
        raise ValueError(f"Service key already exists: {slug}")
    if sort_order is None:
        sort_order = (max((int(s.get("sort_order") or 0) for s in existing), default=-1) + 1)
    sid = await _insert_api_service(
        project_id,
        key=slug,
        name=(name or slug).strip() or slug,
        base_url=(base_url or "").strip(),
        openapi_url=(openapi_url or "").strip(),
        openapi_raw="",
        security_schemes={},
        sort_order=int(sort_order),
    )
    await mirror_primary_service_to_project(project_id)
    return await get_api_service(sid)  # type: ignore[return-value]


async def _insert_api_service(
    project_id: str,
    *,
    key: str,
    name: str,
    base_url: str,
    openapi_url: str,
    openapi_raw: str,
    security_schemes: dict[str, Any],
    sort_order: int,
) -> str:
    sid = str(uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO api_services (
                id, project_id, key, name, base_url, openapi_url, openapi_raw,
                security_schemes_json, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                project_id,
                key,
                name,
                base_url,
                openapi_url,
                openapi_raw,
                json.dumps(security_schemes or {}),
                sort_order,
                now,
                now,
            ),
        )
        await db.commit()
    return sid


async def update_api_service(service_id: str, **fields: Any) -> dict[str, Any] | None:
    # Materialize synthetic legacy service on first write.
    if service_id.startswith("legacy:"):
        project_id = service_id.split(":", 1)[1]
        project = await get_api_project(project_id, include_raw=True)
        if not project:
            return None
        service_id = await _insert_api_service(
            project_id,
            key="default",
            name="Default",
            base_url=project.get("base_url") or "",
            openapi_url=project.get("openapi_url") or "",
            openapi_raw=project.get("openapi_raw") or "",
            security_schemes=project.get("security_schemes") or {},
            sort_order=0,
        )

    svc = await get_api_service(service_id, include_raw=False)
    if not svc:
        return None
    project_id = svc["project_id"]

    if "key" in fields and fields["key"] is not None:
        fields["key"] = _slugify_service_key(str(fields["key"]))
        others = await list_api_services(project_id, synthesize_legacy=False)
        if any(s["id"] != service_id and s.get("key") == fields["key"] for s in others):
            raise ValueError(f"Service key already exists: {fields['key']}")
    if "security_schemes" in fields:
        fields["security_schemes_json"] = json.dumps(fields.pop("security_schemes") or {})
    for col in ("base_url", "openapi_url", "name"):
        if col in fields and fields[col] is not None:
            fields[col] = str(fields[col]).strip()
    if not fields:
        return await get_api_service(service_id)
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [service_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE api_services SET {cols} WHERE id = ?", values)
        await db.commit()
    await mirror_primary_service_to_project(project_id)
    return await get_api_service(service_id)


async def delete_api_service(service_id: str) -> bool:
    if service_id.startswith("legacy:"):
        return False
    svc = await get_api_service(service_id, include_raw=False)
    if not svc:
        return False
    project_id = svc["project_id"]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        cur = await db.execute("DELETE FROM api_services WHERE id = ?", (service_id,))
        await db.commit()
        deleted = cur.rowcount > 0
    if deleted:
        await mirror_primary_service_to_project(project_id)
    return deleted


async def get_primary_api_service(
    project_id: str, *, include_raw: bool = True, ensure: bool = False
) -> dict[str, Any] | None:
    services = await list_api_services(project_id, include_raw=include_raw, synthesize_legacy=True)
    if services:
        primary = services[0]
        if ensure and primary.get("synthetic"):
            return await ensure_primary_api_service(project_id, include_raw=include_raw)
        return primary
    if ensure:
        return await ensure_primary_api_service(project_id, include_raw=include_raw)
    return None


async def ensure_primary_api_service(
    project_id: str, *, include_raw: bool = True, key: str = "default", name: str = "Default"
) -> dict[str, Any]:
    """Ensure a persisted primary service exists (materialize legacy columns if needed)."""
    existing = await list_api_services(project_id, include_raw=include_raw, synthesize_legacy=False)
    if existing:
        return existing[0]
    project = await get_api_project(project_id, include_raw=True)
    if not project:
        raise ValueError("Project not found")
    sid = await _insert_api_service(
        project_id,
        key=_slugify_service_key(key),
        name=name or key,
        base_url=project.get("base_url") or "",
        openapi_url=project.get("openapi_url") or "",
        openapi_raw=project.get("openapi_raw") or "",
        security_schemes=project.get("security_schemes") or {},
        sort_order=0,
    )
    return await get_api_service(sid, include_raw=include_raw)  # type: ignore[return-value]


async def mirror_primary_service_to_project(project_id: str) -> None:
    """Keep legacy project columns in sync with the primary (first) service for old clients."""
    services = await list_api_services(project_id, include_raw=True, synthesize_legacy=False)
    if not services:
        return
    primary = services[0]
    merged_schemes: dict[str, Any] = {}
    for s in services:
        for k, v in (s.get("security_schemes") or {}).items():
            merged_schemes[k] = v
    await update_api_project(
        project_id,
        base_url=primary.get("base_url") or "",
        openapi_url=primary.get("openapi_url") or "",
        openapi_raw=primary.get("openapi_raw") or "",
        security_schemes=merged_schemes,
    )


async def replace_api_endpoints(project_id: str, endpoints: list[dict[str, Any]]) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM api_endpoints WHERE project_id = ?", (project_id,))
        for ep in endpoints:
            await db.execute(
                """
                INSERT INTO api_endpoints (
                    id, project_id, method, path, operation_id, tags_json, summary, meta_json, last_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    project_id,
                    ep["method"],
                    ep["path"],
                    ep["operation_id"],
                    json.dumps(ep.get("tags") or []),
                    ep.get("summary") or "",
                    json.dumps(ep.get("meta") or {}),
                    ep.get("last_status"),
                ),
            )
        await db.commit()


async def list_api_endpoints(project_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM api_endpoints WHERE project_id = ? ORDER BY path, method",
            (project_id,),
        )
        out = []
        for r in await cur.fetchall():
            d = dict(r)
            d["tags"] = _parse_json(d.pop("tags_json", "[]"), [])
            d["meta"] = _parse_json(d.pop("meta_json", "{}"), {})
            out.append(d)
        return out


async def update_endpoint_statuses(project_id: str, status_map: dict[str, str]) -> None:
    """status_map keys like 'GET /v1/orders' or operation_id."""
    endpoints = await list_api_endpoints(project_id)
    async with aiosqlite.connect(DB_PATH) as db:
        for ep in endpoints:
            key = f"{ep['method']} {ep['path']}"
            st = status_map.get(key) or status_map.get(ep["operation_id"])
            if st:
                await db.execute(
                    "UPDATE api_endpoints SET last_status = ? WHERE id = ?",
                    (st, ep["id"]),
                )
        await db.commit()


async def get_api_baseline(project_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM api_baselines WHERE project_id = ? ORDER BY created_at ASC LIMIT 1",
            (project_id,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def set_api_baseline(project_id: str, schema_json: str) -> dict[str, Any]:
    existing = await get_api_baseline(project_id)
    if existing:
        return existing
    bid = str(uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO api_baselines (id, project_id, schema_json, created_at) VALUES (?, ?, ?, ?)",
            (bid, project_id, schema_json, now),
        )
        await db.commit()
    return {"id": bid, "project_id": project_id, "schema_json": schema_json, "created_at": now}


async def replace_api_baseline(project_id: str, schema_json: str) -> dict[str, Any]:
    """Overwrite baseline with the current schema (accept drift as new truth)."""
    now = _now()
    existing = await get_api_baseline(project_id)
    async with aiosqlite.connect(DB_PATH) as db:
        if existing:
            await db.execute(
                "UPDATE api_baselines SET schema_json = ?, created_at = ? WHERE id = ?",
                (schema_json, now, existing["id"]),
            )
            await db.commit()
            return {
                "id": existing["id"],
                "project_id": project_id,
                "schema_json": schema_json,
                "created_at": now,
            }
        bid = str(uuid4())
        await db.execute(
            "INSERT INTO api_baselines (id, project_id, schema_json, created_at) VALUES (?, ?, ?, ?)",
            (bid, project_id, schema_json, now),
        )
        await db.commit()
        return {"id": bid, "project_id": project_id, "schema_json": schema_json, "created_at": now}


async def upsert_api_auth(
    project_id: str,
    scheme_name: str,
    scheme_type: str,
    secrets: dict[str, Any],
    *,
    merge: bool = True,
) -> dict[str, Any]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM api_auth WHERE project_id = ? AND scheme_name = ?",
            (project_id, scheme_name),
        )
        row = await cur.fetchone()
        if row:
            existing = _parse_json(row["secrets_json"], {})
            if merge:
                # empty string means "leave unchanged" for secret fields
                merged = dict(existing)
                for k, v in secrets.items():
                    if v is None or v == "":
                        continue
                    merged[k] = v
                secrets = merged
            await db.execute(
                """
                UPDATE api_auth SET scheme_type = ?, secrets_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (scheme_type, json.dumps(secrets), now, row["id"]),
            )
            aid = row["id"]
        else:
            aid = str(uuid4())
            await db.execute(
                """
                INSERT INTO api_auth (id, project_id, scheme_name, scheme_type, secrets_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (aid, project_id, scheme_name, scheme_type, json.dumps(secrets), now),
            )
        await db.commit()
    return {
        "id": aid,
        "project_id": project_id,
        "scheme_name": scheme_name,
        "scheme_type": scheme_type,
        "secrets": secrets,
        "updated_at": now,
    }


async def list_api_auth(project_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM api_auth WHERE project_id = ?", (project_id,))
        out = []
        for r in await cur.fetchall():
            d = dict(r)
            d["secrets"] = _parse_json(d.pop("secrets_json", "{}"), {})
            out.append(d)
        return out


async def replace_api_flows(project_id: str, flows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM api_flows WHERE project_id = ?", (project_id,))
        saved = []
        for fl in flows:
            fid = str(uuid4())
            await db.execute(
                """
                INSERT INTO api_flows (id, project_id, name, kind, resource, steps_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    fid,
                    project_id,
                    fl.get("name") or "flow",
                    fl.get("kind") or "happy",
                    fl.get("resource") or "",
                    json.dumps(fl.get("steps") or []),
                    now,
                ),
            )
            saved.append(
                {
                    "id": fid,
                    "project_id": project_id,
                    "name": fl.get("name") or "flow",
                    "kind": fl.get("kind") or "happy",
                    "resource": fl.get("resource") or "",
                    "steps": fl.get("steps") or [],
                    "created_at": now,
                }
            )
        await db.commit()
    return saved


async def list_api_flows(project_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM api_flows WHERE project_id = ? ORDER BY created_at ASC",
            (project_id,),
        )
        out = []
        for r in await cur.fetchall():
            d = dict(r)
            d["steps"] = _parse_json(d.pop("steps_json", "[]"), [])
            out.append(d)
        return out


async def insert_api_flow(project_id: str, flow: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    fid = str(uuid4())
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO api_flows (id, project_id, name, kind, resource, steps_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fid,
                project_id,
                flow.get("name") or "flow",
                flow.get("kind") or "happy",
                flow.get("resource") or "",
                json.dumps(flow.get("steps") or []),
                now,
            ),
        )
        await db.commit()
    return {
        "id": fid,
        "project_id": project_id,
        "name": flow.get("name") or "flow",
        "kind": flow.get("kind") or "happy",
        "resource": flow.get("resource") or "",
        "steps": flow.get("steps") or [],
        "created_at": now,
    }


async def update_api_flow_steps(flow_id: str, steps: list[dict[str, Any]]) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM api_flows WHERE id = ?", (flow_id,))
        row = await cur.fetchone()
        if not row:
            return None
        await db.execute(
            "UPDATE api_flows SET steps_json = ? WHERE id = ?",
            (json.dumps(steps or []), flow_id),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM api_flows WHERE id = ?", (flow_id,))
        r = await cur.fetchone()
        if not r:
            return None
        d = dict(r)
        d["steps"] = _parse_json(d.pop("steps_json", "[]"), [])
        return d


async def create_api_run(project_id: str) -> dict[str, Any]:
    rid = str(uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO api_runs (id, project_id, status, summary_json, created_at, started_at)
            VALUES (?, ?, 'queued', '{}', ?, ?)
            """,
            (rid, project_id, now, now),
        )
        await db.commit()
    return await get_api_run(rid)  # type: ignore[return-value]


async def get_api_run(run_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM api_runs WHERE id = ?", (run_id,))
        row = await cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["summary"] = _parse_json(d.pop("summary_json", "{}"), {})
        return d


async def update_api_run(run_id: str, **fields: Any) -> dict[str, Any] | None:
    if "summary" in fields:
        fields["summary_json"] = json.dumps(fields.pop("summary") or {})
    if not fields:
        return await get_api_run(run_id)
    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [run_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE api_runs SET {cols} WHERE id = ?", values)
        await db.commit()
    return await get_api_run(run_id)


async def list_api_runs(project_id: str, limit: int = 50) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM api_runs WHERE project_id = ?
            ORDER BY created_at DESC LIMIT ?
            """,
            (project_id, limit),
        )
        out = []
        for r in await cur.fetchall():
            d = dict(r)
            d["summary"] = _parse_json(d.pop("summary_json", "{}"), {})
            out.append(d)
        return out


async def delete_api_run(run_id: str) -> bool:
    """Delete one API run and its steps/events/anomalies. Returns False if missing."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        cur = await db.execute("SELECT id FROM api_runs WHERE id = ?", (run_id,))
        if not await cur.fetchone():
            return False
        await db.execute("DELETE FROM api_run_steps WHERE run_id = ?", (run_id,))
        await db.execute("DELETE FROM api_run_events WHERE run_id = ?", (run_id,))
        await db.execute("DELETE FROM api_anomalies WHERE run_id = ?", (run_id,))
        await db.execute("DELETE FROM api_runs WHERE id = ?", (run_id,))
        await db.commit()
    return True


async def clear_api_runs(project_id: str) -> int:
    """Delete all API runs for a project. Returns number of runs removed."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        cur = await db.execute(
            "SELECT id FROM api_runs WHERE project_id = ?", (project_id,)
        )
        run_ids = [str(r[0]) for r in await cur.fetchall()]
        if not run_ids:
            return 0
        for rid in run_ids:
            await db.execute("DELETE FROM api_run_steps WHERE run_id = ?", (rid,))
            await db.execute("DELETE FROM api_run_events WHERE run_id = ?", (rid,))
            await db.execute("DELETE FROM api_anomalies WHERE run_id = ?", (rid,))
        await db.execute("DELETE FROM api_runs WHERE project_id = ?", (project_id,))
        await db.commit()
    return len(run_ids)


async def add_api_run_step(run_id: str, idx: int, step: dict[str, Any]) -> dict[str, Any]:
    sid = str(uuid4())
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO api_run_steps (
                id, run_id, idx, flow_name, method, path, operation_id, status, latency_ms, detail_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                run_id,
                idx,
                step.get("flow") or "",
                step.get("method") or "",
                step.get("path") or "",
                step.get("operation_id"),
                step.get("status") or "fail",
                float(step.get("latency_ms") or 0),
                json.dumps(step),
            ),
        )
        await db.commit()
    return {"id": sid, "run_id": run_id, **step}


async def list_api_run_steps(run_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM api_run_steps WHERE run_id = ? ORDER BY idx ASC",
            (run_id,),
        )
        out = []
        for r in await cur.fetchall():
            d = dict(r)
            detail = _parse_json(d.pop("detail_json", "{}"), {})
            d["detail"] = detail
            out.append(d)
        return out


async def replace_api_anomalies(project_id: str, run_id: str, anomalies: list[dict[str, Any]]) -> None:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM api_anomalies WHERE project_id = ?", (project_id,))
        for a in anomalies:
            await db.execute(
                """
                INSERT INTO api_anomalies (
                    id, project_id, run_id, endpoint, finding, confidence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    project_id,
                    run_id,
                    a.get("endpoint"),
                    a.get("finding") or "",
                    int(a.get("confidence") or 0),
                    now,
                ),
            )
        await db.commit()


async def list_api_anomalies(project_id: str, limit: int = 40) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM api_anomalies WHERE project_id = ?
            ORDER BY confidence DESC LIMIT ?
            """,
            (project_id, limit),
        )
        return [dict(r) for r in await cur.fetchall()]


async def add_api_run_event(run_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    eid = str(uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO api_run_events (id, run_id, type, payload, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (eid, run_id, event_type, json.dumps(payload), now),
        )
        await db.commit()
    return {"id": eid, "run_id": run_id, "type": event_type, "payload": payload, "created_at": now}


async def list_api_run_events(run_id: str, limit: int = 500) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM api_run_events WHERE run_id = ?
            ORDER BY created_at ASC LIMIT ?
            """,
            (run_id, limit),
        )
        out = []
        for r in await cur.fetchall():
            d = dict(r)
            d["payload"] = _parse_json(d["payload"], {})
            out.append(d)
        return out


async def collect_endpoint_pass_history(project_id: str, limit_runs: int = 10) -> list[dict[str, Any]]:
    runs = await list_api_runs(project_id, limit=limit_runs)
    rows: list[dict[str, Any]] = []
    for run in runs:
        if run.get("status") != "completed":
            continue
        steps = await list_api_run_steps(run["id"])
        for s in steps:
            rows.append(
                {
                    "endpoint": f"{s.get('method')} {s.get('path')}",
                    "passed": s.get("status") == "pass",
                    "run_id": run["id"],
                }
            )
    return rows
