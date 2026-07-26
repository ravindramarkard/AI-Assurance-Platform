"""Local LM Studio / Ollama helpers.

Qwen (and similar) reasoning models often put the AgentOutput JSON in
`reasoning_content` while leaving `content` empty. browser-use then fails with:

  Invalid JSON: EOF while parsing a value ... input_value=''

This module wraps the OpenAI client to hoist that JSON into `content`.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_ACTION_JSON_RE = re.compile(r"\{[\s\S]*\"action\"\s*:\s*\[[\s\S]*\}", re.MULTILINE)


def extract_agent_json(text: str | None) -> str | None:
    """Return a JSON object string that looks like AgentOutput, or None."""
    if not text:
        return None
    s = text.strip()
    if not s:
        return None

    # Direct JSON
    if s.startswith("{") and '"action"' in s:
        try:
            json.loads(s)
            return s
        except Exception:
            pass

    # Fenced ```json ... ```
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", s)
    if fence:
        candidate = fence.group(1).strip()
        try:
            json.loads(candidate)
            return candidate
        except Exception:
            pass

    # Best-effort: first {...} block that contains "action"
    match = _ACTION_JSON_RE.search(s)
    if match:
        candidate = match.group(0)
        # Trim to last balanced brace if over-matched
        depth = 0
        end = None
        for i, ch in enumerate(candidate):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end:
            candidate = candidate[:end]
        try:
            json.loads(candidate)
            return candidate
        except Exception:
            return None
    return None


def looks_like_final_answer(text: str) -> bool:
    """True when the model wrote a report/summary instead of AgentOutput JSON."""
    s = (text or "").strip()
    if len(s) < 180:
        return False
    # Short mid-task planning — do not force done
    if re.search(
        r"\b(I need to|let me scroll|next I will|going to navigate|click (on|the)|scroll down)\b",
        s,
        re.I,
    ) and len(s) < 700:
        return False
    score = 0
    if re.search(r"^#{1,3}\s", s, re.M):
        score += 2
    if "|" in s and re.search(r"^\s*\|?\s*-{3,}", s, re.M):
        score += 2
    if re.search(
        r"\b(summary|sentiment|conclusion|analysis|report|successfully completed|"
        r"based on the (data|page|results)|market trend)\b",
        s,
        re.I,
    ):
        score += 2
    if len(s) > 500:
        score += 1
    if len(s) > 1200:
        score += 1
    return score >= 3


def wrap_prose_as_done(text: str, thinking: str | None = None) -> str:
    """Turn a free-form answer into AgentOutput with a done action."""
    payload = {
        "thinking": (thinking or "Providing the final answer from the model response.")[:2500],
        "evaluation_previous_goal": "Complete — answer ready",
        "memory": "Final answer captured from prose model response.",
        "next_goal": "Done",
        "action": [{"done": {"text": text.strip(), "success": True}}],
    }
    return json.dumps(payload, ensure_ascii=False)


def hoist_reasoning_content(response: Any) -> Any:
    """Normalize local LLM replies into AgentOutput JSON browser-use can parse.

    Handles:
    - JSON stuck in reasoning_content while content is empty
    - Prose final answers in content (no tool JSON) — wrap as done so chat gets the reply
    """
    try:
        choices = getattr(response, "choices", None) or []
        for choice in choices:
            msg = getattr(choice, "message", None)
            if msg is None:
                continue
            content = getattr(msg, "content", None)
            reasoning = getattr(msg, "reasoning_content", None) or getattr(msg, "reasoning", None)
            reasoning_s = reasoning if isinstance(reasoning, str) else None

            if isinstance(content, str) and content.strip():
                if extract_agent_json(content) is not None:
                    continue
                lifted = extract_agent_json(reasoning_s)
                if lifted:
                    logger.info("Local LLM: replaced non-JSON content with JSON from reasoning_content")
                    msg.content = lifted
                    continue
                if looks_like_final_answer(content):
                    logger.info(
                        "Local LLM: wrapping prose answer as done action (%d chars)",
                        len(content),
                    )
                    msg.content = wrap_prose_as_done(content, reasoning_s)
                continue

            lifted = extract_agent_json(reasoning_s)
            if lifted:
                logger.info(
                    "Local LLM: hoisted AgentOutput JSON from reasoning_content (%d chars)",
                    len(lifted),
                )
                msg.content = lifted
            elif reasoning_s and looks_like_final_answer(reasoning_s):
                logger.info(
                    "Local LLM: wrapping reasoning_content prose as done action (%d chars)",
                    len(reasoning_s),
                )
                msg.content = wrap_prose_as_done(reasoning_s)
            elif reasoning_s and reasoning_s.strip():
                logger.warning(
                    "Local LLM: content empty; reasoning_content present but no AgentOutput JSON found"
                )
    except Exception:
        logger.exception("hoist_reasoning_content failed")
    return response


class _CompletionsProxy:
    def __init__(self, inner: Any):
        self._inner = inner

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        resp = await self._inner.create(*args, **kwargs)
        return hoist_reasoning_content(resp)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class _ChatProxy:
    def __init__(self, inner: Any):
        self._inner = inner

    @property
    def completions(self) -> _CompletionsProxy:
        return _CompletionsProxy(self._inner.completions)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class ReasoningHoistClient:
    """AsyncOpenAI-compatible wrapper that fixes empty-content reasoning responses."""

    def __init__(self, client: Any):
        self._client = client

    @property
    def chat(self) -> _ChatProxy:
        return _ChatProxy(self._client.chat)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


def build_local_chat_openai(
    *,
    model: str,
    api_key: str,
    base_url: str | None,
):
    """ChatOpenAI tuned for LM Studio / Ollama reasoning models."""
    try:
        from browser_use import ChatOpenAI
    except ImportError:
        from browser_use.llm import ChatOpenAI  # type: ignore

    class LocalChatOpenAI(ChatOpenAI):
        def get_client(self):  # type: ignore[override]
            return ReasoningHoistClient(super().get_client())

    kwargs: dict[str, Any] = {
        "model": model,
        "api_key": api_key or "lm-studio",
        # Avoid response_format=json_schema — many local models dump JSON into reasoning_content.
        "dont_force_structured_output": True,
        "add_schema_to_system_prompt": True,
        "remove_min_items_from_schema": True,
        "remove_defaults_from_schema": True,
        "temperature": 0.1,
        "frequency_penalty": 0.0,
        "max_completion_tokens": 8192,
    }
    if base_url:
        kwargs["base_url"] = base_url

    return LocalChatOpenAI(**kwargs)
