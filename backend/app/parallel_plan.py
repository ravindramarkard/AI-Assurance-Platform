from __future__ import annotations

import json
import re
from typing import Any, Literal

_URL_RE = re.compile(r"https?://[^\s]+", re.I)
_CHECK_RE = re.compile(r"(?m)^\s*(?:\d+[\.)]|[-*•])\s+\S+")
_KEYWORD_RE = re.compile(
    r"\b(and then|in parallel|also verify|jira\b.*\bconfluence|confluence\b.*\bjira)\b",
    re.I,
)


class PlanValidationError(ValueError):
    pass


def task_looks_large(task: str) -> bool:
    text = (task or "").strip()
    if len(text) >= 400:
        return True
    urls = {m.group(0).rstrip(".,);]") for m in _URL_RE.finditer(text)}
    if len(urls) >= 2:
        return True
    if len(_CHECK_RE.findall(text)) >= 3:
        return True
    if _KEYWORD_RE.search(text):
        return True
    return False


def resolve_parallel_intent(
    mode: str, force_parallel: bool, task: str
) -> Literal["skip", "plan"]:
    mode = (mode or "auto").strip().lower()
    if force_parallel:
        return "plan"
    if mode == "off":
        return "skip"
    if mode == "always":
        return "plan"
    # auto
    return "plan" if task_looks_large(task) else "skip"


def _as_dict(raw: str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise PlanValidationError(f"invalid JSON: {e}") from e
    if not isinstance(data, dict):
        raise PlanValidationError("plan root must be object")
    return data


def parse_plan(raw: str | dict[str, Any], *, max_branches: int) -> dict[str, Any]:
    max_branches = max(1, min(int(max_branches), 8))
    data = _as_dict(raw)
    phases_in = data.get("phases")
    if not isinstance(phases_in, list) or not phases_in:
        if data.get("should_parallelize"):
            raise PlanValidationError("phases required when should_parallelize")
        return {
            "should_parallelize": False,
            "reason": str(data.get("reason") or "no phases"),
            "phases": [],
        }

    phases: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    total = 0
    truncated = False

    for ph in phases_in:
        if not isinstance(ph, dict):
            raise PlanValidationError("phase must be object")
        pid = str(ph.get("id") or "").strip()
        mode = str(ph.get("mode") or "").strip().lower()
        if mode not in ("serial", "parallel"):
            raise PlanValidationError(f"bad phase mode: {mode}")
        branches_in = ph.get("branches")
        if not isinstance(branches_in, list) or not branches_in:
            raise PlanValidationError(f"phase {pid} needs branches")
        branches: list[dict[str, Any]] = []
        for br in branches_in:
            if total >= max_branches:
                truncated = True
                break
            if not isinstance(br, dict):
                raise PlanValidationError("branch must be object")
            bid = str(br.get("id") or "").strip()
            title = str(br.get("title") or "").strip()
            task = str(br.get("task") or "").strip()
            if not bid or not title or not task:
                raise PlanValidationError("branch needs id, title, task")
            if bid in seen_ids:
                raise PlanValidationError(f"duplicate branch id {bid}")
            seen_ids.add(bid)
            branches.append({"id": bid, "title": title, "task": task})
            total += 1
        if branches:
            phases.append({"id": pid or f"p{len(phases)+1}", "mode": mode, "branches": branches})
        if truncated:
            break

    should = bool(data.get("should_parallelize")) and total >= 2
    return {
        "should_parallelize": should,
        "reason": str(data.get("reason") or ""),
        "phases": phases if should else phases,
        "truncated": truncated,
    }
