"""Screenshot archive mode helpers (Artifacts step_####.png gating)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

ARCHIVE_ALWAYS = "always"
ARCHIVE_ON_FAILURE = "on_failure"
ARCHIVE_NEVER = "never"
_VALID = {ARCHIVE_ALWAYS, ARCHIVE_ON_FAILURE, ARCHIVE_NEVER}

_ERROR_ACTION = re.compile(r"(?i)^\s*error\b|\berror\b")
_FAILED_THOUGHT = re.compile(r"(?i)^\s*failed\b|\bfailed\.")


def normalize_screenshot_archive(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip().lower()
    return s if s in _VALID else None


def resolve_screenshot_archive(stored: Any, *, headless: bool) -> str:
    n = normalize_screenshot_archive(stored)
    if n:
        return n
    return ARCHIVE_ON_FAILURE if headless else ARCHIVE_ALWAYS


def suggest_screenshot_archive(*, headless: bool) -> str:
    return ARCHIVE_ON_FAILURE if headless else ARCHIVE_ALWAYS


def apply_headless_archive_default(*, headless: bool, archive: str, user_set: bool) -> str:
    if user_set:
        return normalize_screenshot_archive(archive) or suggest_screenshot_archive(
            headless=headless
        )
    return suggest_screenshot_archive(headless=headless)


def step_looks_failed(*, actions: list[str] | None, thought: str | None) -> bool:
    for a in actions or []:
        if _ERROR_ACTION.search(str(a) or ""):
            return True
    t = (thought or "").strip()
    if t and _FAILED_THOUGHT.search(t):
        return True
    return False


def should_archive_step_screenshot(mode: str, *, failed: bool) -> bool:
    m = normalize_screenshot_archive(mode) or ARCHIVE_ALWAYS
    if m == ARCHIVE_NEVER:
        return False
    if m == ARCHIVE_ON_FAILURE:
        return bool(failed)
    return True


def archive_decision(mode: str, *, failed: bool, has_b64: bool) -> bool:
    return bool(has_b64) and should_archive_step_screenshot(mode, failed=failed)


def collect_failed_screenshot_files(
    events: list[dict[str, Any]] | None,
    session_root: Path,
    *,
    max_files: int = 5,
) -> list[Path]:
    """Return the latest failed-step screenshots, with a hard maximum of five."""
    root = Path(session_root)
    found: list[Path] = []
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "step":
            continue
        payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
        actions = payload.get("actions")
        action_list = [str(a) for a in actions] if isinstance(actions, list) else []
        thought = payload.get("thought")
        thought_s = thought if isinstance(thought, str) else None
        if not step_looks_failed(actions=action_list, thought=thought_s):
            continue
        rel = payload.get("screenshot")
        if not isinstance(rel, str) or not rel.strip():
            continue
        clean = rel.replace("\\", "/").lstrip("/")
        if clean == "screenshots/latest.png" or clean.endswith("/latest.png"):
            continue
        path = (root / clean).resolve()
        try:
            path.relative_to(root.resolve())
        except ValueError:
            continue
        if path.is_file() and path.suffix.lower() == ".png":
            found.append(path)
    if max_files is None:
        cap = 5
    else:
        n = int(max_files)
        if n <= 0:
            return []
        cap = min(n, 5)
    return found[-cap:]
