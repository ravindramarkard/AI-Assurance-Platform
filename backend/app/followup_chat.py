"""Answer follow-ups from prior chat results without relaunching the browser."""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Hard browser / workspace work — must not be answered from prior chat alone
_NEEDS_BROWSER = re.compile(
    r"("
    r"https?://|"
    r"\bwww\.|"
    r"\bgo\s+to\b|"
    r"\bnavigate\b|"
    r"\bvisit\b|"
    r"\bbrowse\b|"
    r"\bclick\b|"
    r"\bfill\b|"
    r"\btype\b|"
    r"\bsubmit\b|"
    r"\blog\s?in\b|"
    r"\bsign\s?in\b|"
    r"\bscreenshot\b|"
    r"\bscrape\b|"
    r"\bupload\b|"
    r"\bplaywright\b|"
    r"\brefresh\b|"
    r"\breload\b|"
    r"\bon the (page|site|website|form)\b|"
    r"\bopen\s+(the\s+)?(first|second|next|link|url|page|result|tab)\b|"
    r"\bopen\s+https?://|"
    # Workspace file writes (todo.md, reports, …)
    r"\b(update|write|edit|append|create|save)\b.{0,40}\b[\w./-]+\.(md|html?|txt|csv|json|pdf)\b|"
    r"\b[\w./-]+\.(md|html?|txt|csv|json|pdf)\b.{0,40}\b(update|write|edit|append|create|save)\b|"
    r"\btodo\.md\b|"
    r"\bfile\s+system\b|"
    r"\bworkspace\b"
    r")",
    re.IGNORECASE,
)

# Can be answered from an existing assistant report
_FROM_PRIOR = re.compile(
    r"("
    r"\bsummar(y|ize|ise)\b|"
    r"\bsentiment\b|"
    r"\bexplain\b|"
    r"\bclarify\b|"
    r"\brewrite\b|"
    r"\brephrase\b|"
    r"\btranslate\b|"
    r"\bbullet\b|"
    r"\bshorten\b|"
    r"\bexpand\b|"
    r"\bcompare\b|"
    r"\bconclusion\b|"
    r"\bkey\s+points?\b|"
    r"\btakeaways?\b|"
    r"\bas\s+per\b|"
    r"\bbased\s+on\b|"
    r"\bfrom\s+(the\s+)?(above|previous|prior|earlier|last)\b|"
    r"\b(above|previous|prior|earlier)\s+(content|result|report|answer|analysis|data)\b|"
    r"\bthis\s+(report|analysis|summary|content|result)\b|"
    r"\bmarket\s+trend\b|"
    r"\bwhat\s+(does|do|is|are)\b|"
    r"\bwhy\b|"
    r"\bhow\s+(does|do|is|are|would|should)\b|"
    r"\btell\s+me\s+more\b|"
    r"\bin\s+simpler\s+terms\b|"
    r"\belaborate\b"
    r")",
    re.IGNORECASE,
)

_NOT_IN_PRIOR = re.compile(r"^\s*NOT_IN_PRIOR\b", re.IGNORECASE)


def can_answer_from_prior(follow_up: str, prior_assistant: str | None) -> bool:
    """True when the follow-up should use the last result instead of browsing."""
    text = (follow_up or "").strip()
    prior = (prior_assistant or "").strip()
    if not text or len(prior) < 120:
        return False
    if _NEEDS_BROWSER.search(text):
        return False
    if _FROM_PRIOR.search(text):
        return True
    # Short analytical follow-ups on an existing long report (e.g. "bullish or bearish?")
    if len(text) <= 220 and not re.search(r"https?://|\bgo\s+to\b|\bnavigate\b", text, re.I):
        if re.search(
            r"\b(report|analysis|tesla|tsla|stock|headline|news|price|sentiment|trend)\b",
            prior,
            re.I,
        ):
            return True
    return False


async def answer_from_prior(
    *,
    follow_up: str,
    prior_user: str | None,
    prior_assistant: str,
    cfg: dict[str, Any],
) -> str | None:
    """
    Ask the configured LLM to answer using only prior_assistant.
    Returns None when the model says the prior content is insufficient (caller may browse).
    """
    from browser_use.llm.messages import SystemMessage, UserMessage

    from .llm_factory import build_llm

    system = (
        "You answer follow-up questions using ONLY the prior assistant result below. "
        "Do not invent browser actions or claim you opened a page. "
        "If the prior result does not contain enough information to answer, "
        "reply with exactly this first line:\n"
        "NOT_IN_PRIOR: <one short reason>\n"
        "Otherwise answer clearly with tables/bullets when helpful. "
        "Lead with the answer — no filler."
    )
    prior_user_bit = (prior_user or "").strip()
    if len(prior_user_bit) > 500:
        prior_user_bit = prior_user_bit[:500] + "…"
    prior = prior_assistant.strip()
    if len(prior) > 12000:
        prior = prior[:12000] + "\n…"

    user_prompt = (
        f"## Original request\n{prior_user_bit or '(not available)'}\n\n"
        f"## Prior assistant result (source of truth)\n{prior}\n\n"
        f"## Follow-up question\n{follow_up.strip()}\n"
    )

    try:
        llm = build_llm(cfg)
        # Avoid structured AgentOutput schema for this chat-only path
        if hasattr(llm, "dont_force_structured_output"):
            try:
                llm.dont_force_structured_output = True  # type: ignore[attr-defined]
            except Exception:
                pass
        result = await llm.ainvoke(
            [
                SystemMessage(content=system),
                UserMessage(content=user_prompt),
            ]
        )
        text = getattr(result, "completion", None) or getattr(result, "content", None) or result
        reply = str(text or "").strip()
        if not reply:
            return None
        if _NOT_IN_PRIOR.match(reply):
            logger.info("Follow-up not answerable from prior: %s", reply[:160])
            return None
        return reply
    except Exception:
        logger.exception("answer_from_prior failed")
        return None
