from __future__ import annotations

import json
from typing import Any

try:
    from browser_use.llm.messages import SystemMessage, UserMessage
except ModuleNotFoundError:  # pragma: no cover
    # Unit tests in minimal environments may not have browser-use installed.
    class _Msg:
        def __init__(self, content: str):
            self.content = content

    class SystemMessage(_Msg):
        pass

    class UserMessage(_Msg):
        pass

from .llm_factory import build_llm
from .parallel_plan import PlanValidationError, parse_plan


class PlannerError(RuntimeError):
    pass


def _extract_text(result: Any) -> str:
    # MagicMock exposes any attribute (truthy), so only trust real string fields.
    completion = getattr(result, "completion", None)
    if isinstance(completion, str) and completion.strip():
        return completion.strip()
    content = getattr(result, "content", None)
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(result, str):
        return result.strip()
    if content is not None:
        return str(content).strip()
    if completion is not None:
        return str(completion).strip()
    return str(result or "").strip()


def _wants_hard_fail(*, cfg: dict[str, Any], force: bool) -> bool:
    mode = str(cfg.get("parallel_execution_mode") or "").strip().lower()
    return bool(force) or mode == "always"


def _planner_system_prompt(*, max_branches: int) -> str:
    return (
        "You are a task planner for a browser automation agent.\n"
        "Return ONLY valid JSON matching this schema:\n"
        "{\n"
        '  "should_parallelize": boolean,\n'
        '  "reason": string,\n'
        '  "phases": [\n'
        "    {\n"
        '      "id": string,\n'
        '      "mode": "serial" | "parallel",\n'
        '      "branches": [ { "id": string, "title": string, "task": string } ]\n'
        "    }\n"
        "  ]\n"
        "}\n"
        f"Constraints: total branches across all phases must be <= {int(max_branches)}.\n"
        "Use 'serial' for prerequisites that must run first, then 'parallel' for independent work.\n"
        "If the task is simple or does not benefit from parallelism, set should_parallelize=false and phases=[].\n"
        "Do not wrap JSON in markdown fences. No extra keys. No trailing commentary."
    )


def _repair_system_prompt() -> str:
    return (
        "You fix invalid JSON outputs.\n"
        "Return ONLY corrected JSON (no markdown fences, no explanations)."
    )


async def plan_task(
    task: str,
    *,
    cfg: dict[str, Any],
    max_branches: int,
    force: bool,
) -> dict[str, Any]:
    """
    Ask the configured LLM to produce a parallel execution plan JSON, validate with parse_plan,
    and attempt one repair on validation failure.
    """
    max_branches = max(1, min(int(max_branches), 8))
    llm = build_llm(cfg)
    if hasattr(llm, "dont_force_structured_output"):
        try:
            llm.dont_force_structured_output = True  # type: ignore[attr-defined]
        except Exception:
            pass

    system = _planner_system_prompt(max_branches=max_branches)
    user = f"Task:\n{(task or '').strip()}\n"

    result = await llm.ainvoke([SystemMessage(content=system), UserMessage(content=user)])
    raw = _extract_text(result)

    try:
        return parse_plan(raw, max_branches=max_branches)
    except PlanValidationError as e:
        repair_user = (
            "The previous output was invalid.\n"
            f"Validation error: {str(e)}\n\n"
            "Original task:\n"
            f"{(task or '').strip()}\n\n"
            "Invalid output:\n"
            f"{raw}\n"
        )
        repaired = await llm.ainvoke(
            [
                SystemMessage(content=_repair_system_prompt()),
                UserMessage(content=repair_user),
            ]
        )
        raw2 = _extract_text(repaired)
        try:
            return parse_plan(raw2, max_branches=max_branches)
        except PlanValidationError as e2:
            if _wants_hard_fail(cfg=cfg, force=force):
                raise PlannerError(f"planner failed after repair: {e2}") from e2
            return {
                "should_parallelize": False,
                "reason": "planner_failed",
                "phases": [],
            }


async def aggregate_results(
    parent_task: str,
    branch_results: list[dict[str, Any]],
    *,
    cfg: dict[str, Any],
) -> str:
    """
    Ask the configured LLM to generate a markdown report from branch results.
    """
    llm = build_llm(cfg)
    if hasattr(llm, "dont_force_structured_output"):
        try:
            llm.dont_force_structured_output = True  # type: ignore[attr-defined]
        except Exception:
            pass

    system = (
        "You are an aggregator that writes a concise markdown report from parallel branch results.\n"
        "Output markdown only.\n"
        "Include: overall status, per-branch bullets, and a short 'Next steps' section when errors exist.\n"
        "Do not claim you ran tools or opened pages. Use only the provided data."
    )
    payload = {
        "parent_task": (parent_task or "").strip(),
        "branch_results": branch_results,
    }
    user = "Aggregate the following results into a helpful report:\n" + json.dumps(
        payload, indent=2, ensure_ascii=False
    )

    result = await llm.ainvoke([SystemMessage(content=system), UserMessage(content=user)])
    return _extract_text(result)

