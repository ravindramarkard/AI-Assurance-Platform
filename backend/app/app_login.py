"""Application URL login credentials for browser agents."""

from __future__ import annotations

from typing import Any


def is_configured(cfg: dict[str, Any]) -> bool:
    user = str(cfg.get("application_username") or "").strip()
    password = str(cfg.get("application_password") or "").strip()
    return bool(user and password)


def sensitive_data_for_agent(cfg: dict[str, Any]) -> dict[str, str] | None:
    """Flat placeholders for browser-use Agent(sensitive_data=...)."""
    if not is_configured(cfg):
        return None
    return {
        "x_app_user": str(cfg.get("application_username") or "").strip(),
        "x_app_pass": str(cfg.get("application_password") or "").strip(),
    }


def login_system_message(cfg: dict[str, Any]) -> str | None:
    """Instructions when Application username/password are configured."""
    if not is_configured(cfg):
        return None
    return """
# Application login (configured)

When you see a **normal application login form** (username/email + password on the app itself):
- Username / email field: type `<secret>x_app_user</secret>`
- Password field: type `<secret>x_app_pass</secret>`
- Then submit / Sign In and wait for the app to load.
- Prefer these Application credentials over inventing or guessing passwords.
- Do not type real passwords into thought text — only the `<secret>…</secret>` placeholders.

## Priority vs Keycloak / SSO

- Use Application secrets (`x_app_*`) first on ordinary app login pages.
- Use Keycloak secrets (`x_keycloak_*`) only when the page looks like Keycloak / SSO
  (Keycloak branding, realm auth URL, IdP redirect). If Keycloak is not configured, ignore this note.
""".strip()
