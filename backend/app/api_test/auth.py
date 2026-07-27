"""Resolve OpenAPI securitySchemes and obtain / apply tokens."""

from __future__ import annotations

import base64
import logging
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from .ssrf import assert_safe_url

logger = logging.getLogger(__name__)


def classify_scheme(name: str, scheme: dict[str, Any]) -> dict[str, Any]:
    """Normalize scheme metadata for the UI (no secrets)."""
    stype = (scheme.get("type") or "").lower()
    info: dict[str, Any] = {
        "name": name,
        "type": stype,
        "description": scheme.get("description") or "",
        "flows": [],
        "in": scheme.get("in"),
        "param_name": scheme.get("name"),
        "scheme": scheme.get("scheme"),
        "authorize_url": None,
        "token_url": None,
        "scopes": [],
    }
    if stype == "oauth2":
        flows = scheme.get("flows") or {}
        # Swagger 2 style
        if scheme.get("flow"):
            flow_name = scheme["flow"]
            flows = {
                flow_name: {
                    "authorizationUrl": scheme.get("authorizationUrl"),
                    "tokenUrl": scheme.get("tokenUrl"),
                    "scopes": scheme.get("scopes") or {},
                }
            }
        for flow_name, flow in flows.items():
            if not isinstance(flow, dict):
                continue
            info["flows"].append(flow_name)
            if flow.get("authorizationUrl"):
                info["authorize_url"] = flow["authorizationUrl"]
            if flow.get("tokenUrl"):
                info["token_url"] = flow["tokenUrl"]
            scopes = flow.get("scopes") or {}
            if isinstance(scopes, dict):
                info["scopes"] = list(scopes.keys())
    elif stype == "http":
        info["scheme"] = (scheme.get("scheme") or "bearer").lower()
    return info


def public_security(schemes: dict[str, Any], auth_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_name = {r["scheme_name"]: r for r in auth_rows}
    out = []
    for name, scheme in schemes.items():
        meta = classify_scheme(name, scheme)
        row = by_name.get(name) or {}
        secrets = row.get("secrets") or {}
        if isinstance(secrets, str):
            import json

            try:
                secrets = json.loads(secrets)
            except Exception:
                secrets = {}
        meta["configured"] = bool(
            secrets.get("access_token")
            or secrets.get("api_key")
            or secrets.get("client_id")
            or secrets.get("password")
            or secrets.get("bearer_token")
            or secrets.get("username")
        )
        meta["has_access_token"] = bool(secrets.get("access_token") or secrets.get("bearer_token"))
        meta["has_refresh_token"] = bool(secrets.get("refresh_token"))
        meta["has_client_secret"] = bool(secrets.get("client_secret"))
        meta["has_password"] = bool(secrets.get("password"))
        meta["has_api_key"] = bool(secrets.get("api_key"))
        meta["token_expires_at"] = secrets.get("expires_at")
        out.append(meta)
    return out


async def obtain_token(
    scheme: dict[str, Any],
    secrets: dict[str, Any],
    *,
    grant: str | None = None,
    allow_private: bool = False,
    redirect_uri: str | None = None,
    code: str | None = None,
) -> dict[str, Any]:
    """Exchange credentials for tokens. Returns updated secrets dict."""
    stype = (scheme.get("type") or "").lower()
    if stype != "oauth2":
        raise ValueError("Token exchange only applies to oauth2 schemes")

    flows = scheme.get("flows") or {}
    if scheme.get("flow"):  # swagger2
        flows = {
            scheme["flow"]: {
                "tokenUrl": scheme.get("tokenUrl"),
                "authorizationUrl": scheme.get("authorizationUrl"),
            }
        }

    preferred = grant or (
        "clientCredentials"
        if "clientCredentials" in flows or "application" in flows
        else "password"
        if "password" in flows
        else "refresh"
        if secrets.get("refresh_token")
        else "authorizationCode"
        if code
        else None
    )
    # swagger2 names
    flow_key_map = {
        "clientCredentials": ("clientCredentials", "application"),
        "password": ("password",),
        "authorizationCode": ("authorizationCode", "accessCode"),
        "refresh": ("refresh",),
    }
    token_url = None
    flow = None
    if preferred == "refresh" and secrets.get("refresh_token"):
        for keys in flow_key_map.values():
            for k in keys:
                if k in flows and flows[k].get("tokenUrl"):
                    token_url = flows[k]["tokenUrl"]
                    flow = flows[k]
                    break
            if token_url:
                break
        preferred = "refresh_token"
    else:
        keys = flow_key_map.get(preferred or "", (preferred,)) if preferred else ()
        for k in keys:
            if k in flows:
                flow = flows[k]
                token_url = flow.get("tokenUrl")
                preferred = "client_credentials" if k in ("clientCredentials", "application") else (
                    "password" if k == "password" else "authorization_code"
                )
                break

    if not token_url:
        raise ValueError("No token URL found for OAuth2 scheme")
    assert_safe_url(token_url, allow_private=allow_private)

    data: dict[str, str] = {}
    if preferred == "client_credentials":
        data = {
            "grant_type": "client_credentials",
            "client_id": str(secrets.get("client_id") or ""),
            "client_secret": str(secrets.get("client_secret") or ""),
        }
        if secrets.get("scope"):
            data["scope"] = str(secrets["scope"])
    elif preferred == "password":
        data = {
            "grant_type": "password",
            "username": str(secrets.get("username") or ""),
            "password": str(secrets.get("password") or ""),
            "client_id": str(secrets.get("client_id") or ""),
        }
        if secrets.get("client_secret"):
            data["client_secret"] = str(secrets["client_secret"])
        if secrets.get("scope"):
            data["scope"] = str(secrets["scope"])
    elif preferred == "authorization_code":
        if not code:
            raise ValueError("authorization_code grant requires code")
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": str(secrets.get("client_id") or ""),
            "redirect_uri": redirect_uri or str(secrets.get("redirect_uri") or ""),
        }
        if secrets.get("client_secret"):
            data["client_secret"] = str(secrets["client_secret"])
    elif preferred == "refresh_token":
        data = {
            "grant_type": "refresh_token",
            "refresh_token": str(secrets.get("refresh_token") or ""),
            "client_id": str(secrets.get("client_id") or ""),
        }
        if secrets.get("client_secret"):
            data["client_secret"] = str(secrets["client_secret"])
    else:
        raise ValueError(f"Unsupported grant: {preferred}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            token_url,
            data=data,
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code >= 400:
            raise ValueError(f"Token endpoint error {resp.status_code}: {resp.text[:400]}")
        body = resp.json()

    updated = dict(secrets)
    if body.get("access_token"):
        updated["access_token"] = body["access_token"]
        updated["bearer_token"] = body["access_token"]
    if body.get("refresh_token"):
        updated["refresh_token"] = body["refresh_token"]
    if body.get("token_type"):
        updated["token_type"] = body["token_type"]
    expires_in = body.get("expires_in")
    if expires_in is not None:
        try:
            updated["expires_at"] = time.time() + float(expires_in)
        except (TypeError, ValueError):
            pass
    return updated


def build_authorize_url(
    scheme: dict[str, Any],
    secrets: dict[str, Any],
    *,
    redirect_uri: str,
    state: str,
) -> str:
    flows = scheme.get("flows") or {}
    if scheme.get("flow"):
        flows = {
            "authorizationCode": {
                "authorizationUrl": scheme.get("authorizationUrl"),
                "scopes": scheme.get("scopes") or {},
            }
        }
    flow = flows.get("authorizationCode") or flows.get("accessCode")
    if not flow or not flow.get("authorizationUrl"):
        raise ValueError("No authorizationCode flow / authorize URL")
    params = {
        "response_type": "code",
        "client_id": str(secrets.get("client_id") or ""),
        "redirect_uri": redirect_uri,
        "state": state,
    }
    if secrets.get("scope"):
        params["scope"] = str(secrets["scope"])
    elif isinstance(flow.get("scopes"), dict) and flow["scopes"]:
        params["scope"] = " ".join(flow["scopes"].keys())
    return f"{flow['authorizationUrl']}?{urlencode(params)}"


async def ensure_access_token(
    scheme: dict[str, Any],
    secrets: dict[str, Any],
    *,
    allow_private: bool = False,
) -> dict[str, Any]:
    """Refresh token if expired / missing when possible."""
    expires_at = secrets.get("expires_at")
    token = secrets.get("access_token") or secrets.get("bearer_token")
    if token and expires_at:
        try:
            if float(expires_at) > time.time() + 30:
                return secrets
        except (TypeError, ValueError):
            return secrets
    if token and not expires_at and not secrets.get("refresh_token"):
        return secrets
    stype = (scheme.get("type") or "").lower()
    if stype != "oauth2":
        return secrets
    try:
        if secrets.get("refresh_token"):
            return await obtain_token(scheme, secrets, grant="refresh", allow_private=allow_private)
        flows = scheme.get("flows") or {}
        if "clientCredentials" in flows or "application" in flows or scheme.get("flow") in (
            "application",
            "clientCredentials",
        ):
            return await obtain_token(scheme, secrets, grant="clientCredentials", allow_private=allow_private)
        if "password" in flows or scheme.get("flow") == "password":
            return await obtain_token(scheme, secrets, grant="password", allow_private=allow_private)
    except Exception as exc:
        logger.warning("Token refresh failed: %s", exc)
    return secrets


def apply_security(
    headers: dict[str, str],
    query: dict[str, str],
    scheme_name: str,
    scheme: dict[str, Any],
    secrets: dict[str, Any],
) -> bool:
    """Mutate headers/query with auth material. Returns True if credentials were applied."""
    stype = (scheme.get("type") or "").lower()
    if stype in ("apikey", "api_key"):
        key = str(secrets.get("api_key") or secrets.get("access_token") or "").strip()
        if not key:
            return False
        loc = (scheme.get("in") or "header").lower()
        pname = scheme.get("name") or "X-API-Key"
        if loc == "query":
            query[pname] = key
        else:
            headers[pname] = key
        return True
    if stype == "http":
        sub = (scheme.get("scheme") or "bearer").lower()
        if sub == "basic":
            user = str(secrets.get("username") or "")
            pwd = str(secrets.get("password") or "")
            if not user and not pwd:
                return False
            token = base64.b64encode(f"{user}:{pwd}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"
            return True
        tok = str(secrets.get("bearer_token") or secrets.get("access_token") or "").strip()
        if not tok:
            return False
        headers["Authorization"] = f"Bearer {tok}"
        return True
    if stype == "oauth2":
        tok = str(secrets.get("access_token") or secrets.get("bearer_token") or "").strip()
        if not tok:
            return False
        headers["Authorization"] = f"Bearer {tok}"
        return True
    return False
