HITL_SYSTEM_MESSAGE = """
# Human input (mandatory)

When a page asks for OTP, MFA, verification codes, or any one-time value only a human can provide:
- Call the **request_human_input** action with a clear prompt (and input_type \"otp\" when appropriate).
- Wait for the returned value, then type it into the correct field and continue.
- Never invent or guess one-time codes.
""".strip()
