from __future__ import annotations

import asyncio
import base64
import logging
import re
import traceback
from pathlib import Path
from typing import Any

from . import db
from .config import schedular_dir, session_dir
from .llm_factory import build_llm, effective_settings
from .vision_probe import ensure_vision_for_cfg, needs_live_vision_probe, resolve_vision_mode
from .run_opts import pop_run_opts
from .ws import bus

logger = logging.getLogger(__name__)

# Live agents keyed by session_id
_live: dict[str, Any] = {}


def _apply_session_llm(cfg: dict[str, Any], session_row: dict[str, Any] | None) -> None:
    """Overlay session snapshot provider/model onto cfg before build_llm."""
    if not session_row:
        return
    sess_provider = (session_row.get("llm_provider") or "").strip()
    sess_model = (session_row.get("model") or "").strip()
    if sess_provider in ("local", "openai", "anthropic"):
        cfg["llm_provider"] = sess_provider
    if sess_model:
        cfg["llm_model"] = sess_model

_SKIP_FILE_PARTS = frozenset(
    {"browseruse_agent_data", ".git", "__pycache__", "node_modules", ".DS_Store"}
)


def _collect_available_file_paths(*roots: Path) -> list[str]:
    """Concrete absolute file paths for browser-use upload_file (exact-match whitelist)."""
    paths: list[str] = []
    seen: set[str] = set()
    for root in roots:
        if not root or not root.exists():
            continue
        try:
            root = root.resolve()
        except OSError:
            continue
        for p in root.rglob("*"):
            try:
                if not p.is_file():
                    continue
                if any(part in _SKIP_FILE_PARTS for part in p.parts):
                    continue
                if p.name in _SKIP_FILE_PARTS:
                    continue
                abs_path = str(p.resolve())
            except OSError:
                continue
            if abs_path not in seen:
                seen.add(abs_path)
                paths.append(abs_path)
    return paths


def get_live_agent(session_id: str):
    return _live.get(session_id)


def running_count() -> int:
    return len(_live)


async def _emit(session_id: str, event_type: str, payload: dict[str, Any]) -> None:
    event = await db.add_event(session_id, event_type, payload)
    await bus.publish(session_id, event)


async def _auto_recording_gif(session_id: str, sdir: Path) -> None:
    """Build screenshots/recording.gif from sequential frames (no user click)."""
    try:
        cfg = await effective_settings()
        mode = str(cfg.get("screenshot_archive") or "")
        if mode == "never":
            logger.debug("skip recording.gif — screenshot_archive=never")
            return

        from .recording_gif import build_recording_gif

        meta = await asyncio.to_thread(build_recording_gif, sdir)
        await _emit(
            session_id,
            "file_written",
            {
                "path": meta["path"],
                "name": Path(meta["path"]).name,
                "frames": meta.get("frames"),
                "recording_gif": True,
            },
        )
        await _emit(
            session_id,
            "recording_gif",
            {
                "path": meta["path"],
                "frames": meta.get("frames"),
                "duration_ms": meta.get("duration_ms"),
                "size": meta.get("size"),
            },
        )
        logger.info(
            "session %s recording.gif ready (%s frames)",
            session_id,
            meta.get("frames"),
        )
    except FileNotFoundError:
        pass
    except Exception:
        logger.exception("auto recording.gif failed for %s", session_id)


def _extract_actions(model_output: Any) -> list[str]:
    actions: list[str] = []
    try:
        if model_output is None:
            return actions
        raw = getattr(model_output, "action", None) or getattr(model_output, "actions", None) or []
        for a in raw:
            name = getattr(a, "name", None) or type(a).__name__
            if hasattr(a, "model_dump"):
                dumped = a.model_dump(exclude_none=True)
                for k, v in dumped.items():
                    if k in ("name",):
                        continue
                    if isinstance(v, dict):
                        summary = ", ".join(f"{ik}={iv!r}" for ik, iv in list(v.items())[:3])
                        actions.append(f"{k}: {summary}" if summary else str(k))
                        break
                else:
                    actions.append(str(name))
            else:
                actions.append(str(a))
    except Exception as e:
        actions.append(f"(parse error: {e})")
    return actions


def _thought_fields(model_output: Any) -> dict[str, str]:
    """browser-use 0.13 puts thinking fields on AgentOutput (and sometimes current_state)."""
    out: dict[str, str] = {}
    if model_output is None:
        return out
    sources = [model_output]
    nested = getattr(model_output, "current_state", None)
    if nested is not None:
        sources.append(nested)
    for src in sources:
        for key in (
            "thinking",
            "evaluation_previous_goal",
            "memory",
            "next_goal",
            "page_summary",
            "plan_update",
            "current_plan_item",
        ):
            if key in out:
                continue
            val = getattr(src, key, None)
            if val is None and hasattr(src, "model_dump"):
                try:
                    val = src.model_dump(exclude_none=True).get(key)
                except Exception:
                    val = None
            if val is None:
                continue
            if isinstance(val, (list, dict)):
                try:
                    import json

                    out[key] = json.dumps(val)
                except Exception:
                    out[key] = str(val)
            else:
                out[key] = str(val)
    return out


def _extract_thought(model_output: Any) -> str | None:
    fields = _thought_fields(model_output)
    if not fields:
        return None
    # Prefer narrative thinking; fall back to memory/goal
    for key in ("thinking", "memory", "next_goal", "evaluation_previous_goal", "page_summary"):
        if fields.get(key):
            # Keep full multi-field blob for details panel
            pass
    return "\n\n".join(f"{k}: {v}" for k, v in fields.items())


def _extract_final_answer(history: Any) -> str | None:
    """Best-effort final chat reply from agent history (done text / last extract)."""
    if history is None:
        return None
    try:
        if hasattr(history, "final_result"):
            final = history.final_result()
            if final and str(final).strip():
                return str(final).strip()
    except Exception:
        pass

    try:
        items = list(getattr(history, "history", None) or [])
    except Exception:
        items = []

    # Walk newest → oldest for done / substantial extracted_content
    best: str | None = None
    for item in reversed(items):
        results = getattr(item, "result", None) or []
        for r in reversed(list(results)):
            text = getattr(r, "extracted_content", None)
            if not text:
                continue
            s = str(text).strip()
            if not s:
                continue
            if getattr(r, "is_done", False) or s.lower().startswith("task completed"):
                # Prefer full done text (may be longer than the "Task completed: …" memory)
                if len(s) > 40:
                    return s
            if best is None or len(s) > len(best):
                best = s

        # Model output may include done: text='…'
        model_output = getattr(item, "model_output", None)
        for action in _extract_actions(model_output):
            if not action.lower().startswith("done"):
                continue
            # done: text='....', success=True
            m = re.search(r"text=('(?:\\'|[^'])*'|\"(?:\\\"|[^\"])*\"|[^,]+)", action, re.I)
            if not m:
                continue
            raw = m.group(1).strip()
            if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
                raw = raw[1:-1]
            raw = raw.replace("\\n", "\n").strip()
            if len(raw) > 40:
                return raw

    if best and len(best) > 80:
        return best
    return None


def _files_from_actions(actions: list[str], model_output: Any) -> list[str]:
    """Best-effort detect written filenames from tool calls / action summaries."""
    names: list[str] = []
    try:
        raw = getattr(model_output, "action", None) or getattr(model_output, "actions", None) or []
        for a in raw:
            dumped = a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else {}
            for key, val in dumped.items():
                if not isinstance(val, dict):
                    continue
                for fk in ("file_name", "filename", "path", "file_path", "name"):
                    if val.get(fk):
                        names.append(str(val[fk]))
                # write_file / append_file style
                if "write" in key.lower() or "file" in key.lower():
                    for v in val.values():
                        if isinstance(v, str) and ("." in v or "/" in v) and len(v) < 200:
                            names.append(v)
    except Exception:
        pass
    for a in actions:
        # e.g. "write_file: file_name='explore.ts'"
        if "write" in a.lower() or "file" in a.lower():
            for token in a.replace("'", " ").replace('"', " ").replace("=", " ").split():
                if "." in token and "/" not in token[:1] and len(token) < 80:
                    names.append(token.strip(","))
    # dedupe
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        base = Path(n).name
        if base and base not in seen:
            seen.add(base)
            out.append(n)
    return out

def _normalize_b64(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip()
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    return s or None


def _screenshot_from_state(browser_state: Any) -> str | None:
    """browser-use may put bytes in .screenshot or on disk via .screenshot_path / get_screenshot()."""
    if browser_state is None:
        return None
    b64 = _normalize_b64(getattr(browser_state, "screenshot", None))
    if b64:
        return b64
    getter = getattr(browser_state, "get_screenshot", None)
    if callable(getter):
        try:
            b64 = _normalize_b64(getter())
            if b64:
                return b64
        except Exception:
            pass
    path = getattr(browser_state, "screenshot_path", None)
    if path:
        try:
            p = Path(path)
            if p.exists():
                return base64.b64encode(p.read_bytes()).decode("ascii")
        except Exception:
            pass
    return None


async def _save_latest(screenshots: Path, b64: str) -> str | None:
    """Overwrite screenshots/latest.png only (live preview; no numbered archive)."""
    try:
        raw = base64.b64decode(b64)
        screenshots.mkdir(parents=True, exist_ok=True)
        (screenshots / "latest.png").write_bytes(raw)
        return "screenshots/latest.png"
    except Exception as e:
        logger.warning("screenshot latest save failed: %s", e)
        return None


async def _save_shot(screenshots: Path, prefix: str, b64: str) -> str | None:
    """Write latest.png plus a numbered archive file (step_#### / legacy live_####)."""
    try:
        raw = base64.b64decode(b64)
        screenshots.mkdir(parents=True, exist_ok=True)
        latest = screenshots / "latest.png"
        latest.write_bytes(raw)
        n = len(list(screenshots.glob(f"{prefix}_*.png")))
        fname = f"{prefix}_{n:04d}.png"
        (screenshots / fname).write_bytes(raw)
        return f"screenshots/{fname}"
    except Exception as e:
        logger.warning("screenshot save failed: %s", e)
        return None


async def _capture_via_agent(agent: Any) -> tuple[str | None, str | None]:
    """Return (url, screenshot_b64) from a live agent browser session."""
    url = None
    b64 = None
    try:
        session = getattr(agent, "browser_session", None)
        if session is None:
            return None, None
        # Prefer summary API (includes screenshot when vision enabled)
        if hasattr(session, "get_browser_state_summary"):
            try:
                state = await session.get_browser_state_summary(include_screenshot=True)
                url = getattr(state, "url", None)
                b64 = _screenshot_from_state(state)
                if b64:
                    return url, b64
            except TypeError:
                state = await session.get_browser_state_summary()
                url = getattr(state, "url", None)
                b64 = _screenshot_from_state(state)
                if b64:
                    return url, b64
            except Exception as e:
                logger.debug("get_browser_state_summary failed: %s", e)

        # Fallback: ScreenshotEvent
        try:
            from browser_use.browser.events import ScreenshotEvent

            event = session.event_bus.dispatch(ScreenshotEvent(full_page=False))
            await event
            result = await event.event_result(raise_if_any=False, raise_if_none=False)
            if isinstance(result, str):
                b64 = _normalize_b64(result)
            elif isinstance(result, dict):
                b64 = _normalize_b64(result.get("screenshot") or result.get("data"))
        except Exception as e:
            logger.debug("ScreenshotEvent failed: %s", e)
    except Exception as e:
        logger.debug("capture failed: %s", e)
    return url, b64


async def _preview_loop(session_id: str, agent: Any, screenshots: Path, stop: asyncio.Event) -> None:
    """Push live preview frames while the agent runs (independent of step callbacks).

    Updates latest.png only — does not archive live_####.png (Artifacts stay lean).
    """
    # wait briefly for browser to come up
    await asyncio.sleep(1.5)
    while not stop.is_set():
        try:
            url, b64 = await _capture_via_agent(agent)
            if b64:
                rel = await _save_latest(screenshots, b64)
                # Prefer path-based previews; include modest b64 only for live WS paint.
                payload: dict[str, Any] = {"url": url, "screenshot": rel}
                if len(b64) < 400_000:
                    payload["screenshot_b64"] = b64
                await _emit(session_id, "preview", payload)
                if url:
                    await db.update_session(session_id, current_url=url)
        except Exception as e:
            logger.debug("preview loop: %s", e)
        try:
            await asyncio.wait_for(stop.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass


async def run_session(session_id: str, task: str) -> None:
    from .chat_gate import general_chat_reply
    from .queue import clear_cancelled, is_cancelled
    from .response_style import merge_extend_system_message
    from .task_url import apply_urls

    if is_cancelled(session_id):
        clear_cancelled(session_id)
        await db.update_session(session_id, status="stopped")
        await _emit(session_id, "status", {"status": "stopped", "message": "Cancelled before start"})
        return

    cfg = await effective_settings()
    session_row = await db.get_session(session_id) or {}
    _apply_session_llm(cfg, session_row)
    sdir = session_dir(session_id)
    workspace = sdir / "workspace"
    screenshots = sdir / "screenshots"
    opts = pop_run_opts(session_id)
    max_steps = int(opts["max_steps"]) if opts.get("max_steps") is not None else 500
    extend_system = opts.get("extend_system_message")
    use_schedular = bool(opts.get("use_schedular"))
    roots = [schedular_dir(), workspace] if use_schedular else [workspace]
    file_paths = _collect_available_file_paths(*roots)

    extend_system = merge_extend_system_message(
        str(extend_system) if extend_system else None
    )

    from .hitl_message import HITL_SYSTEM_MESSAGE

    extend_system = f"{extend_system}\n\n{HITL_SYSTEM_MESSAGE}"

    # Application login + Keycloak SSO — append instructions / secrets when configured
    from . import app_login as app_login_mod
    from . import keycloak as keycloak_mod

    app_msg = app_login_mod.login_system_message(cfg)
    if app_msg:
        extend_system = f"{extend_system}\n\n{app_msg}"
    kc_msg = keycloak_mod.login_system_message(cfg)
    if kc_msg:
        extend_system = f"{extend_system}\n\n{kc_msg}"

    login_secrets: dict[str, str] = {}
    app_secrets = app_login_mod.sensitive_data_for_agent(cfg)
    if app_secrets:
        login_secrets.update(app_secrets)
    kc_secrets = keycloak_mod.sensitive_data_for_agent(cfg)
    if kc_secrets:
        login_secrets.update(kc_secrets)

    app_url = str(cfg.get("application_url") or "") or None
    runtime_url = opts.get("runtime_url")

    # Greetings / local attached-file analysis / Jira·Confluence — never launch a browser.
    from .chat_gate import browser_decision, is_local_attachment_task

    want_browser, browser_reason = browser_decision(task)
    if not want_browser:
        from .attachment_chat import answer_from_attachments
        from .integration_actions import try_integration_from_chat

        model_name = cfg.get("llm_model") or "default"
        await db.update_session(
            session_id,
            status="running",
            model=str(model_name),
            llm_provider=str(cfg.get("llm_provider") or "local"),
            error=None,
        )

        reply: str | None = None
        if is_local_attachment_task(task):
            await _emit(
                session_id,
                "status",
                {"status": "thinking", "message": f"No browser ({browser_reason}) — reading attached files"},
            )
            reply = await answer_from_attachments(task=task, workspace=workspace, cfg=cfg)
            if reply is None:
                reply = (
                    "Failed. I couldn't read the attached file(s) from the session workspace. "
                    "Re-attach the file and try again."
                )
        else:
            await _emit(
                session_id,
                "status",
                {"status": "running", "message": f"No browser ({browser_reason})"},
            )
            reply = await try_integration_from_chat(session_id, task)
            if reply is None:
                reply = general_chat_reply(task, application_url=app_url)

        await db.add_message(session_id, "assistant", reply)
        await _emit(session_id, "message", {"role": "assistant", "content": reply})
        await db.update_session(session_id, status="completed", step_count=0)
        await _emit(session_id, "status", {"status": "completed"})
        await _emit(
            session_id,
            "done",
            {
                "steps": 0,
                "chat_only": True,
                "attachments_only": is_local_attachment_task(task),
                "browser_reason": browser_reason,
            },
        )
        return

    # Real ask → URL in the task wins; else Runtime / Application URL.
    # Session follow-ups must never bounce to Application URL.
    from .task_url import extract_continuation_url, extract_task_url, is_session_continuation

    original_task = task
    continuation = is_session_continuation(original_task)
    task_dest = (
        extract_continuation_url(original_task)
        if continuation
        else extract_task_url(original_task)
    )
    task, start_url = apply_urls(
        task,
        runtime_url=None if continuation else (str(runtime_url) if runtime_url else None),
        application_url=None if continuation else app_url,
        prefer_url=task_dest if continuation else None,
        skip_default_url=continuation,
    )
    if continuation and start_url:
        task_dest = start_url

    url_label = "none"
    if start_url:
        if continuation:
            url_label = "session"
        elif extract_task_url(original_task):
            url_label = "task"
        elif runtime_url and not continuation:
            url_label = "runtime"
        else:
            url_label = "application"
        await db.update_session(session_id, task=task, current_url=start_url)
        await _emit(
            session_id,
            "status",
            {
                "status": "running",
                "message": f"Browser on ({browser_reason}) · start URL from {url_label}: {start_url}",
            },
        )
    else:
        await _emit(
            session_id,
            "status",
            {
                "status": "running",
                "message": f"Browser on ({browser_reason}) · no start URL (task did not name one; set Application URL in Settings if needed)",
            },
        )

    await db.update_session(session_id, status="running", error=None)
    await _emit(session_id, "status", {"status": "running"})

    llm = build_llm(cfg)
    model_name = cfg.get("llm_model") or "default"
    await db.update_session(
        session_id,
        model=str(model_name),
        llm_provider=str(cfg.get("llm_provider") or "local"),
    )

    step_count = 0
    stop_preview = asyncio.Event()
    preview_task: asyncio.Task | None = None

    async def on_step(browser_state: Any, model_output: Any, step: int) -> None:
        nonlocal step_count
        step_count = step
        url = getattr(browser_state, "url", None) if browser_state is not None else None
        title = getattr(browser_state, "title", None) if browser_state is not None else None
        screenshot_b64 = _screenshot_from_state(browser_state)

        thought_fields = _thought_fields(model_output)
        thought = _extract_thought(model_output)
        actions = _extract_actions(model_output)
        written = _files_from_actions(actions, model_output)

        from .screenshot_archive import should_archive_step_screenshot, step_looks_failed

        cfg_now = await effective_settings()
        mode = str(cfg_now.get("screenshot_archive") or "always")
        failed = step_looks_failed(actions=actions, thought=thought)

        rel_shot = None
        if screenshot_b64:
            await _save_latest(screenshots, screenshot_b64)
            if should_archive_step_screenshot(mode, failed=failed):
                rel_shot = await _save_shot(screenshots, "step", screenshot_b64)

        # Pick up any new files that appeared in the session workspace
        for path in workspace.rglob("*"):
            if path.is_file():
                rel = str(path.relative_to(workspace))
                if rel not in written:
                    # only announce recently touched files (< 15s)
                    try:
                        age = __import__("time").time() - path.stat().st_mtime
                        if age < 15:
                            written.append(rel)
                    except Exception:
                        pass

        # Keep upload_file whitelist in sync (attachments + agent-written files)
        agent = _live.get(session_id)
        if agent is not None:
            try:
                refreshed = _collect_available_file_paths(*roots)
                existing = list(getattr(agent, "available_file_paths", None) or [])
                merged = list(dict.fromkeys([*existing, *refreshed]))
                agent.available_file_paths = merged
            except Exception:
                pass

        await db.update_session(session_id, step_count=step, current_url=url)
        payload: dict[str, Any] = {
            "step": step,
            "url": url,
            "title": title,
            "thought": thought,
            "thought_fields": thought_fields,
            "actions": actions,
            "screenshot": rel_shot,
            "files_written": written,
        }
        # Persist large b64 on step events only when archived (Artifacts evidence)
        if rel_shot and screenshot_b64 and len(screenshot_b64) < 1_500_000:
            payload["screenshot_b64"] = screenshot_b64
        await _emit(session_id, "step", payload)

        for fw in written:
            await _emit(session_id, "file_written", {"path": fw, "name": Path(fw).name})

        if screenshot_b64:
            preview_payload: dict[str, Any] = {
                "url": url,
                "screenshot": rel_shot or "screenshots/latest.png",
            }
            if len(screenshot_b64) < 400_000:
                preview_payload["screenshot_b64"] = screenshot_b64
            await _emit(session_id, "preview", preview_payload)

    async def on_done(history: Any) -> None:
        await _emit(
            session_id,
            "done",
            {
                "steps": getattr(history, "number_of_steps", lambda: step_count)()
                if callable(getattr(history, "number_of_steps", None))
                else step_count,
            },
        )

    try:
        from browser_use import Agent

        from .browser_factory import build_browser, stop_browser

        browser = build_browser(
            sdir,
            headless=bool(cfg.get("headless", True)),
            session_id=session_id,
            engine=str(cfg.get("browser_engine") or "chromium"),
            custom_path=cfg.get("browser_executable") or None,
        )

        provider = str(cfg.get("llm_provider") or "local")
        mode = resolve_vision_mode(
            str(cfg.get("llm_vision_mode")) if cfg.get("llm_vision_mode") is not None else None
        )
        use_vision = await ensure_vision_for_cfg(
            {**cfg, "llm_vision_mode": mode},
            force_refresh=False,
            persist=True,
        )
        logger.info(
            "Agent vision provider=%s mode=%s effective=%s",
            provider,
            mode,
            use_vision,
        )
        if mode == "auto" and not use_vision and needs_live_vision_probe(provider):
            await _emit(
                session_id,
                "status",
                {
                    "status": "thinking",
                    "message": "Vision auto-disabled: endpoint rejected image input.",
                },
            )
        agent_kwargs: dict[str, Any] = {
            "task": task,  # may include Application / Runtime URL preamble
            "llm": llm,
            "browser": browser,
            "use_vision": use_vision,
            "register_new_step_callback": on_step,
            "register_done_callback": on_done,
            "save_conversation_path": str(sdir / "conversation"),
            "available_file_paths": file_paths,
            # Persist artifacts under the session workspace (not /tmp)
            "file_system_path": str(schedular_dir()) if use_schedular else str(workspace),
        }
        # Force first navigation to the task destination — never Application URL first.
        if task_dest:
            agent_kwargs["initial_actions"] = [
                {"navigate": {"url": task_dest, "new_tab": False}}
            ]
        agent_kwargs["extend_system_message"] = extend_system
        if login_secrets:
            agent_kwargs["sensitive_data"] = login_secrets

        from browser_use.agent.views import ActionResult
        from browser_use.tools.service import Tools
        from pydantic import BaseModel, Field

        from . import human_input as hitl

        class RequestHumanInputParams(BaseModel):
            prompt: str = Field(..., description="Message shown to the human operator")
            input_type: str = Field(
                default="text", description='"otp" or "text"'
            )

        tools = Tools()

        @tools.action(
            "Ask the human operator for a value (OTP, MFA code, etc). Blocks until they submit.",
            param_model=RequestHumanInputParams,
        )
        async def request_human_input(params: RequestHumanInputParams) -> ActionResult:
            itype = params.input_type if params.input_type in ("otp", "text") else "text"

            async def _run_wait() -> tuple[str, str]:
                return await hitl.begin_wait(session_id, params.prompt, itype)

            wait_task = asyncio.create_task(_run_wait())
            await asyncio.sleep(0)
            pending = hitl.get_pending(session_id)
            if pending:
                await db.update_session(
                    session_id,
                    status="waiting_for_input",
                    hitl_pending=db.hitl_pending_to_json(pending),
                )
                await _emit(
                    session_id,
                    "human_input_required",
                    {
                        "request_id": pending["request_id"],
                        "prompt": pending["prompt"],
                        "input_type": pending["input_type"],
                    },
                )
                await _emit(session_id, "status", {"status": "waiting_for_input"})
                await db.add_event(
                    session_id,
                    "human_input_required",
                    {
                        "request_id": pending["request_id"],
                        "prompt": pending["prompt"],
                        "input_type": pending["input_type"],
                    },
                )
            try:
                _rid, value = await wait_task
            except hitl.HumanInputCancelled as e:
                return ActionResult(error=f"Human input cancelled ({e.reason})")
            await db.update_session(session_id, hitl_pending=None, status="running")
            await _emit(
                session_id,
                "status",
                {"status": "running", "message": "Human input received"},
            )
            await db.add_event(
                session_id,
                "human_input_resolved",
                {
                    "request_id": pending["request_id"] if pending else None,
                    "redacted": True,
                },
            )
            from .hitl_message import human_input_result_payload

            return ActionResult(**human_input_result_payload(value))

        agent_kwargs["tools"] = tools

        agent = Agent(**agent_kwargs)

        _live[session_id] = agent
        await _emit(session_id, "status", {"status": "thinking", "message": "Agent started"})

        preview_task = asyncio.create_task(_preview_loop(session_id, agent, screenshots, stop_preview))

        history = await agent.run(max_steps=max_steps)
        final = _extract_final_answer(history)

        # If step callbacks never fired (common when local LLM returns empty/invalid JSON),
        # synthesize step events from agent history so the UI can show thinking/actions.
        try:
            hist_items = []
            if history is not None and hasattr(history, "history"):
                hist_items = list(history.history or [])
            if hist_items and step_count == 0:
                for i, item in enumerate(hist_items, start=1):
                    model_output = getattr(item, "model_output", None)
                    state = getattr(item, "state", None)
                    url = getattr(state, "url", None) if state is not None else None
                    title = getattr(state, "title", None) if state is not None else None
                    thought_fields = _thought_fields(model_output)
                    thought = _extract_thought(model_output)
                    actions = _extract_actions(model_output)
                    results = getattr(item, "result", None) or []
                    for r in results:
                        err = getattr(r, "error", None)
                        if err:
                            actions.append(f"error: {err}")
                        extracted = getattr(r, "extracted_content", None)
                        if extracted and not actions:
                            actions.append(f"result: {str(extracted)[:240]}")
                    if not thought and not thought_fields and not actions:
                        thought = (
                            f"Step {i}: model returned no structured output "
                            "(often empty/invalid JSON from the local LLM)."
                        )
                    await _emit(
                        session_id,
                        "step",
                        {
                            "step": i,
                            "url": url,
                            "title": title,
                            "thought": thought,
                            "thought_fields": thought_fields,
                            "actions": actions,
                            "screenshot": None,
                            "files_written": [],
                            "synthetic": True,
                        },
                    )
                step_count = len(hist_items)
                await db.update_session(session_id, step_count=step_count)
        except Exception:
            logger.exception("failed to synthesize step events for %s", session_id)

        if final:
            await db.add_message(session_id, "assistant", str(final))
            await _emit(session_id, "message", {"role": "assistant", "content": str(final)})

        if step_count == 0 and not final:
            # Likely browser never became usable — surface clearly in UI
            msg = (
                "Agent finished with 0 browser steps and no result. "
                "Usually the browser failed to start. Restart with ./start.sh in a normal Terminal "
                "and ensure Chrome for Testing is installed (`uv run browser-use install`)."
            )
            await _emit(session_id, "error", {"error": msg})
            await db.update_session(session_id, status="failed", error=msg)
            await _emit(session_id, "status", {"status": "failed"})
        else:
            await db.update_session(session_id, status="completed", step_count=step_count)
            await _emit(session_id, "status", {"status": "completed"})

        files = [str(p.relative_to(workspace)) for p in workspace.rglob("*") if p.is_file()]
        if files:
            await _emit(session_id, "files", {"files": files})

    except Exception as e:
        logger.exception("session %s failed", session_id)
        err = f"{type(e).__name__}: {e}"
        await db.update_session(session_id, status="failed", error=err)
        await _emit(
            session_id,
            "error",
            {"error": err, "traceback": traceback.format_exc()[-2000:]},
        )
        await _emit(session_id, "status", {"status": "failed"})
    finally:
        # Always drop the live agent first so a hung cleanup cannot block the queue.
        from . import human_input as hitl

        hitl.cancel(session_id)
        try:
            await db.update_session(session_id, hitl_pending=None)
        except Exception:
            pass
        _live.pop(session_id, None)
        stop_preview.set()
        if preview_task is not None:
            preview_task.cancel()
            try:
                await asyncio.wait_for(preview_task, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
        try:
            from .browser_factory import stop_browser

            stop_browser(session_id, session_path=sdir)
        except Exception:
            pass
        # After preview frames are flushed — auto stitch into a playable GIF
        await _auto_recording_gif(session_id, sdir)


async def stop_session_tree(session_id: str) -> bool:
    """
    Stop a session and its descendants (parent first, then children).

    Designed for orchestrators which run out-of-band (not tracked in _live) and
    for stop cascades that must not recurse infinitely.
    """
    from . import human_input as hitl
    from .queue import cancel_queued

    visited: set[str] = set()
    order: list[str] = []
    q: list[str] = [session_id]
    while q:
        sid = q.pop(0)
        if sid in visited:
            continue
        visited.add(sid)
        order.append(sid)
        try:
            kids = await db.list_child_sessions(sid)
        except Exception:
            kids = []
        for ch in kids:
            cid = str(ch.get("id") or "")
            if cid and cid not in visited:
                q.append(cid)

    stopped_any = False
    for sid in order:
        sess = await db.get_session(sid)
        if not sess:
            continue
        status = str(sess.get("status") or "").lower()
        if status in ("completed", "failed", "stopped"):
            continue

        # Mark cancelled so any orchestrator polling notices quickly.
        try:
            await cancel_queued(sid)
        except Exception:
            pass

        agent = _live.get(sid)
        if agent is not None:
            try:
                if hasattr(agent, "stop"):
                    agent.stop()
                elif hasattr(agent, "pause"):
                    agent.pause()
            except Exception:
                pass

        try:
            hitl.cancel(sid)
        except Exception:
            pass

        await db.update_session(sid, hitl_pending=None, status="stopped")
        msg = "Removed from queue" if status == "queued" else "Stopped"
        await _emit(sid, "status", {"status": "stopped", "message": msg})
        stopped_any = True

    return stopped_any


async def control_agent(session_id: str, action: str, *, _cascade: bool = True) -> bool:
    from . import human_input as hitl

    agent = _live.get(session_id)
    try:
        if action == "stop" and _cascade:
            sess = await db.get_session(session_id)
            if sess and str(sess.get("role") or "").lower() == "orchestrator":
                return await stop_session_tree(session_id)
            try:
                kids = await db.list_child_sessions(session_id)
            except Exception:
                kids = []
            if kids:
                return await stop_session_tree(session_id)

        if action == "stop" and not agent:
            # Cancel a session still waiting in the queue
            from .queue import cancel_queued

            sess = await db.get_session(session_id)
            if sess and sess.get("status") == "queued":
                await cancel_queued(session_id)
                hitl.cancel(session_id)
                await db.update_session(session_id, hitl_pending=None, status="stopped")
                await _emit(session_id, "status", {"status": "stopped", "message": "Removed from queue"})
                return True
            # Allow stop while waiting_for_input even if agent briefly missing from _live
            if sess and sess.get("status") == "waiting_for_input":
                hitl.cancel(session_id)
                await db.update_session(session_id, hitl_pending=None, status="stopped")
                await _emit(session_id, "status", {"status": "stopped"})
                return True
            return False

        if not agent:
            return False

        if action == "pause" and hasattr(agent, "pause"):
            agent.pause()
            await db.update_session(session_id, status="paused")
            await _emit(session_id, "status", {"status": "paused"})
            return True
        if action == "resume" and hasattr(agent, "resume"):
            agent.resume()
            await db.update_session(session_id, status="running")
            await _emit(session_id, "status", {"status": "running"})
            return True
        if action == "stop":
            if hasattr(agent, "stop"):
                agent.stop()
            elif hasattr(agent, "pause"):
                agent.pause()
            hitl.cancel(session_id)
            await db.update_session(session_id, hitl_pending=None, status="stopped")
            await _emit(session_id, "status", {"status": "stopped"})
            return True
    except Exception as e:
        logger.warning("control %s failed: %s", action, e)
    return False


async def follow_up(session_id: str, content: str) -> None:
    """Add follow-up task to a live agent, or enqueue a new run if idle."""
    from .chat_gate import browser_decision, general_chat_reply, is_local_attachment_task

    agent = _live.get(session_id)
    await db.add_message(session_id, "user", content)
    await _emit(session_id, "message", {"role": "user", "content": content})

    from .llm_factory import effective_settings

    cfg = await effective_settings()
    session_row = await db.get_session(session_id) or {}
    _apply_session_llm(cfg, session_row)
    app_url = str(cfg.get("application_url") or "") or None

    # Chat-only follow-ups — greet / local files / log to Jira·Confluence; never open the browser.
    want_browser, browser_reason = browser_decision(content)
    if not want_browser:
        from .attachment_chat import answer_from_attachments
        from .integration_actions import try_integration_from_chat

        reply: str | None = None
        if is_local_attachment_task(content):
            await _emit(
                session_id,
                "status",
                {"status": "thinking", "message": f"No browser ({browser_reason}) — reading attached files"},
            )
            reply = await answer_from_attachments(
                task=content,
                workspace=session_dir(session_id) / "workspace",
                cfg=cfg,
            )
            if reply is None:
                reply = (
                    "Failed. I couldn't read the attached file(s) from the session workspace. "
                    "Re-attach the file and try again."
                )
        else:
            await _emit(
                session_id,
                "status",
                {"status": "running", "message": f"No browser ({browser_reason})"},
            )
            reply = await try_integration_from_chat(session_id, content)
            if reply is None:
                reply = general_chat_reply(content, application_url=app_url)
        await db.add_message(session_id, "assistant", reply)
        await _emit(session_id, "message", {"role": "assistant", "content": reply})
        await db.update_session(session_id, status="completed")
        await _emit(session_id, "status", {"status": "completed", "message": f"Chat reply ({browser_reason})"})
        await _emit(session_id, "done", {"steps": 0, "chat_only": True, "browser_reason": browser_reason})
        return

    sess = await db.get_session(session_id)
    current_url = None
    if sess:
        cur = str(sess.get("current_url") or "").strip()
        if cur and not cur.startswith("about:"):
            current_url = cur

    from .followup_chat import answer_from_prior, can_answer_from_prior
    from .task_url import enrich_follow_up, extract_task_url

    # Pull prior turn context so suggestions like "Open the first result…"
    # continue from the last answer — never Application URL.
    prior_user = None
    prior_assistant = None
    try:
        msgs = await db.list_messages(session_id)
        # Last user msg is the follow-up we just added; take the previous user + last assistant
        users = [m for m in msgs if m.get("role") == "user"]
        assistants = [m for m in msgs if m.get("role") == "assistant"]
        if len(users) >= 2:
            prior_user = str(users[-2].get("content") or "")
        elif sess and sess.get("task"):
            prior_user = str(sess.get("task") or "")
        if assistants:
            prior_assistant = str(assistants[-1].get("content") or "")
        if not current_url and prior_user:
            current_url = extract_task_url(prior_user)
        if not current_url and prior_assistant:
            current_url = extract_task_url(prior_assistant)
    except Exception:
        logger.debug("follow_up: could not load prior messages", exc_info=True)

    # Prefer answering from the previous report — do not relaunch the browser.
    if prior_assistant and can_answer_from_prior(content, prior_assistant):
        await _emit(
            session_id,
            "status",
            {"status": "thinking", "message": "Answering from previous result (no browser)"},
        )
        reply = await answer_from_prior(
            follow_up=content,
            prior_user=prior_user,
            prior_assistant=prior_assistant,
            cfg=cfg,
        )
        if reply:
            await db.add_message(session_id, "assistant", reply)
            await _emit(session_id, "message", {"role": "assistant", "content": reply})
            await db.update_session(session_id, status="completed")
            await _emit(
                session_id,
                "status",
                {"status": "completed", "message": "Follow-up answered from prior result"},
            )
            await _emit(session_id, "done", {"steps": 0, "chat_only": True, "from_prior": True})
            return
        # Model said prior content is insufficient → fall through to browser
        await _emit(
            session_id,
            "status",
            {
                "status": "running",
                "message": "Prior result not enough — continuing in browser",
            },
        )

    enriched, continue_url = enrich_follow_up(
        content,
        current_url=current_url,
        prior_user=prior_user,
        prior_assistant=prior_assistant,
    )
    if continue_url:
        await db.update_session(session_id, current_url=continue_url)

    if agent is not None and hasattr(agent, "add_new_task"):
        try:
            agent.add_new_task(enriched)
            await _emit(
                session_id,
                "status",
                {
                    "status": "running",
                    "message": (
                        f"Follow-up queued (continue at {continue_url})"
                        if continue_url
                        else "Follow-up queued"
                    ),
                },
            )
            return
        except Exception as e:
            logger.warning("add_new_task failed: %s", e)

    if sess and sess["status"] in ("completed", "failed", "stopped", "queued"):
        from .queue import enqueue

        await db.update_session(session_id, status="queued", task=enriched)
        await enqueue(session_id, enriched)
