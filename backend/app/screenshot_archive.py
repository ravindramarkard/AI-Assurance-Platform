"""Screenshot archive mode helpers (Artifacts step_####.png gating)."""

from __future__ import annotations

import re
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
