"""Keycloak OpenID Connect helpers (test + agent login context)."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


def normalize_base_url(url: str) -> str:
    return (url or "").strip().rstrip("/")


def realm_urls(base_url: str, realm: str) -> dict[str, str]:
    base = normalize_base_url(base_url)
    realm = (realm or "").strip()
    root = f"{base}/realms/{realm}/protocol/openid-connect"
    return {
        "auth": f"{root}/auth",
        "token": f"{root}/token",
        "logout": f"{root}/logout",
        "userinfo": f"{root}/userinfo",
    }


def is_configured(cfg: dict[str, Any]) -> bool:
    enabled = str(cfg.get("keycloak_enabled") or "").lower() in ("1", "true", "yes")
    if not enabled:
        return False
    return bool(
        normalize_base_url(str(cfg.get("keycloak_base_url") or ""))
        and str(cfg.get("keycloak_realm") or "").strip()
        and str(cfg.get("keycloak_client_id") or "").strip()
        and str(cfg.get("keycloak_username") or "").strip()
        and str(cfg.get("keycloak_password") or "").strip()
    )


def host_from_url(url: str) -> str | None:
    u = (url or "").strip()
    if not u:
        return None
    if "://" not in u:
        u = "https://" + u
    try:
        host = urlparse(u).hostname
        return host or None
    except Exception:
        return None


def sensitive_data_for_agent(cfg: dict[str, Any]) -> dict[str, str] | None:
    """Flat placeholders for browser-use Agent(sensitive_data=...)."""
    if not is_configured(cfg):
        return None
    user = str(cfg.get("keycloak_username") or "").strip()
    password = str(cfg.get("keycloak_password") or "").strip()
    if not user or not password:
        return None
    return {
        "x_keycloak_user": user,
        "x_keycloak_pass": password,
    }


def login_system_message(cfg: dict[str, Any]) -> str | None:
    """Instructions appended to extend_system_message when Keycloak is configured."""
    if not is_configured(cfg):
        return None
    base = normalize_base_url(str(cfg.get("keycloak_base_url") or ""))
    realm = str(cfg.get("keycloak_realm") or "").strip()
    client_id = str(cfg.get("keycloak_client_id") or "").strip()
    redirect = str(cfg.get("keycloak_redirect_uri") or "").strip() or str(
        cfg.get("application_url") or ""
    ).strip()
    urls = realm_urls(base, realm)
    redirect_bit = f"\n- Typical redirect / app URL: `{redirect}`" if redirect else ""
    return f"""
# Keycloak SSO login (configured)

When the application redirects to Keycloak (or you see a Keycloak / SSO login form):
- Username field: type `<secret>x_keycloak_user</secret>`
- Password field: type `<secret>x_keycloak_pass</secret>`
- Then click Sign In / Log In and wait for the redirect back to the application.
- Do not invent credentials. Do not open unrelated sites to log in.
- Keycloak base: `{base}` · realm: `{realm}` · client: `{client_id}`
- Auth endpoint (reference): `{urls["auth"]}`{redirect_bit}
""".strip()


async def test_password_grant(cfg: dict[str, Any]) -> dict[str, Any]:
    """
    Validate Keycloak credentials via Resource Owner Password Credentials grant.
    Requires the client to allow Direct Access Grants.
    """
    base = normalize_base_url(str(cfg.get("keycloak_base_url") or ""))
    realm = str(cfg.get("keycloak_realm") or "").strip()
    client_id = str(cfg.get("keycloak_client_id") or "").strip()
    client_secret = str(cfg.get("keycloak_client_secret") or "").strip()
    username = str(cfg.get("keycloak_username") or "").strip()
    password = str(cfg.get("keycloak_password") or "").strip()

    if not (base and realm and client_id and username and password):
        raise ValueError(
            "Keycloak needs base URL, realm, client id, username, and password."
        )

    token_url = realm_urls(base, realm)["token"]
    data = {
        "grant_type": "password",
        "client_id": client_id,
        "username": username,
        "password": password,
    }
    if client_secret:
        data["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        try:
            r = await client.post(
                token_url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.HTTPError as e:
            raise ValueError(f"Could not reach Keycloak token endpoint: {e}") from e

    if r.status_code >= 400:
        detail = r.text[:400]
        try:
            err = r.json()
            detail = str(err.get("error_description") or err.get("error") or detail)
        except Exception:
            pass
        raise ValueError(f"Keycloak token request failed ({r.status_code}): {detail}")

    body = r.json()
    return {
        "ok": True,
        "token_type": body.get("token_type"),
        "expires_in": body.get("expires_in"),
        "scope": body.get("scope"),
        "has_access_token": bool(body.get("access_token")),
        "has_refresh_token": bool(body.get("refresh_token")),
        "realm": realm,
        "client_id": client_id,
    }
