"""System hint + ActionResult payload for human-in-the-loop OTP/input."""

from __future__ import annotations

HITL_SYSTEM_MESSAGE = """
# Human input (mandatory)

When a page asks for OTP, MFA, verification codes, or any one-time value only a human can provide:
- Call the **request_human_input** action with a clear prompt (and input_type \"otp\" when appropriate).
- Wait for the returned value, then type it into the correct field and continue.
- Never invent or guess one-time codes.
- After the value is returned, your **next** model output MUST be valid AgentOutput JSON
  (with an input_text / send_keys / click action as needed). Never reply in prose only.
""".strip()


def human_input_result_payload(value: str) -> dict[str, str | bool]:
    """Build ActionResult fields so the OTP survives JSON parse retries.

    browser-use puts include_extracted_content_only_once content into a one-shot
    read_state. If that is True and long_term_memory omits the value, consecutive
    Invalid-JSON failures (max_failures=5) lose the code and the agent dies.
    """
    trimmed = (value or "").strip()
    guidance = (
        f"Operator provided the exact value to enter: {trimmed}\n"
        "Next action: use input_text (or the matching fill/send_keys action) on the "
        "OTP/verification field with this exact value, then continue login. "
        "Respond with valid AgentOutput JSON only — no prose."
    )
    return {
        "extracted_content": guidance,
        "long_term_memory": f"Human verification/OTP value to type exactly: {trimmed}",
        "include_extracted_content_only_once": False,
    }
