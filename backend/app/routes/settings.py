from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from .. import db
from ..config import settings as env_settings
from ..llm_factory import effective_settings, public_settings, test_llm_connection
from ..models import LlmTestRequest, SettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

ALLOWED = {
    "llm_provider",
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    "llm_models",
    "llm_vision_mode",
    "llm_use_vision",
    "llm_temperature",
    "browser_use_api_key",
    "openai_api_key",
    "anthropic_api_key",
    "headless",
    "browser_engine",
    "browser_executable",
    "application_url",
    "max_concurrent_agents",
    "ui_theme",
    "ui_locale",
    "atlassian_deployment",
    "jira_base_url",
    "jira_email",
    "jira_api_token",
    "jira_project_key",
    "confluence_base_url",
    "confluence_space_key",
    "keycloak_enabled",
    "keycloak_base_url",
    "keycloak_realm",
    "keycloak_client_id",
    "keycloak_client_secret",
    "keycloak_username",
    "keycloak_password",
    "keycloak_redirect_uri",
}


@router.get("")
async def get_settings():
    return await public_settings()


@router.put("")
async def update_settings(body: SettingsUpdate):
    data = body.model_dump(exclude_none=True)
    if body.llm_use_vision_reset:
        await db.set_setting("llm_vision_mode", "auto")
        await db.delete_setting("llm_use_vision")
        data.pop("llm_use_vision", None)
        data.pop("llm_use_vision_reset", None)
    # Legacy bool → mode
    if "llm_use_vision" in data and "llm_vision_mode" not in data:
        data["llm_vision_mode"] = "on" if data.pop("llm_use_vision") else "off"
    else:
        data.pop("llm_use_vision", None)
    for k, v in data.items():
        if k not in ALLOWED:
            continue
        if k == "headless":
            await db.set_setting(k, "true" if v else "false")
            env_settings.headless = bool(v)
        elif k == "keycloak_enabled":
            await db.set_setting(k, "true" if v else "false")
            env_settings.keycloak_enabled = bool(v)
        elif k == "llm_vision_mode":
            mode = str(v).strip().lower()
            if mode not in ("auto", "on", "off"):
                mode = "auto"
            await db.set_setting(k, mode)
            if hasattr(env_settings, "llm_vision_mode"):
                env_settings.llm_vision_mode = mode  # type: ignore[assignment]
        elif k == "llm_temperature":
            t = max(0.0, min(1.0, float(v)))
            await db.set_setting(k, str(t))
        elif k == "max_concurrent_agents":
            n = max(1, min(int(v), 8))
            await db.set_setting(k, str(n))
            env_settings.max_concurrent_agents = n
            from ..queue import scale_workers

            await scale_workers(n)
        elif k == "llm_models":
            from ..llm_models_catalog import normalize_catalog
            import json
            catalog = normalize_catalog(v)
            # If llm_model also in this payload (or already in DB), ensure it is listed
            provider = data.get("llm_provider")
            model = data.get("llm_model")
            if provider is None or model is None:
                cur = await effective_settings()
                provider = provider or cur.get("llm_provider") or "local"
                model = model if model is not None else (cur.get("llm_model") or "")
            from ..llm_models_catalog import ensure_model_in_catalog
            catalog = ensure_model_in_catalog(catalog, str(provider), str(model or ""))
            await db.set_setting(k, json.dumps(catalog))
        else:
            await db.set_setting(k, str(v))
            if hasattr(env_settings, k):
                setattr(env_settings, k, v)
    return await public_settings()


@router.post("/test-llm")
async def test_llm(body: LlmTestRequest | None = None):
    """Verify the LLM provider is reachable (uses form overrides when provided)."""
    cfg = await effective_settings()
    overrides = (body.model_dump(exclude_none=True) if body else {}) or {}
    for k, v in overrides.items():
        if isinstance(v, str) and ("••" in v or not v.strip()):
            continue
        cfg[k] = v
    provider = str(cfg.get("llm_provider") or "local")
    if provider == "browser_use":
        # Cloud provider removed from UI; fall back to local for tests.
        cfg["llm_provider"] = "local"
        provider = "local"
    try:
        return await test_llm_connection(cfg)
    except Exception as e:
        logger.exception("LLM test connection failed")
        raise HTTPException(502, str(e) or f"LLM connection failed ({provider})") from e
