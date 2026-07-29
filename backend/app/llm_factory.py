from __future__ import annotations

import json
import os
from typing import Any

from . import db
from .config import settings
from .llm_models_catalog import (
    empty_catalog,
    ensure_model_in_catalog,
    normalize_catalog,
    parse_catalog_json,
)


async def effective_settings() -> dict[str, Any]:
    """Merge env settings with DB overrides (DB wins when set)."""
    from .local_llm import resolve_temperature
    from .vision_probe import migrate_llm_use_vision_value, resolve_vision_mode

    stored = await db.get_all_settings()
    # One-time migrate llm_use_vision → llm_vision_mode
    if "llm_use_vision" in stored and "llm_vision_mode" not in stored:
        mode = migrate_llm_use_vision_value(stored.get("llm_use_vision"))
        if mode:
            await db.set_setting("llm_vision_mode", mode)
        await db.delete_setting("llm_use_vision")
        stored = await db.get_all_settings()

    out: dict[str, Any] = {
        "llm_provider": settings.llm_provider,
        "llm_base_url": settings.llm_base_url,
        "llm_api_key": settings.llm_api_key,
        "llm_model": settings.llm_model,
        "llm_vision_mode": settings.llm_vision_mode,
        "llm_temperature": float(settings.llm_temperature),
        "llm_vision_probe_ok": None,
        "llm_vision_probe_at": None,
        "llm_vision_probe_key": None,
        "browser_use_api_key": settings.browser_use_api_key,
        "openai_api_key": settings.openai_api_key,
        "anthropic_api_key": settings.anthropic_api_key,
        "headless": settings.headless,
        "browser_engine": settings.browser_engine,
        "browser_executable": settings.browser_executable,
        "application_url": settings.application_url,
        "max_concurrent_agents": settings.max_concurrent_agents,
        "ui_theme": settings.ui_theme,
        "ui_locale": settings.ui_locale,
        "atlassian_deployment": settings.atlassian_deployment,
        "jira_base_url": settings.jira_base_url,
        "jira_email": settings.jira_email,
        "jira_api_token": settings.jira_api_token,
        "jira_project_key": settings.jira_project_key,
        "confluence_base_url": settings.confluence_base_url,
        "confluence_space_key": settings.confluence_space_key,
        "keycloak_enabled": settings.keycloak_enabled,
        "keycloak_base_url": settings.keycloak_base_url,
        "keycloak_realm": settings.keycloak_realm,
        "keycloak_client_id": settings.keycloak_client_id,
        "keycloak_client_secret": settings.keycloak_client_secret,
        "keycloak_username": settings.keycloak_username,
        "keycloak_password": settings.keycloak_password,
        "keycloak_redirect_uri": settings.keycloak_redirect_uri,
    }
    for k, v in stored.items():
        if k in ("headless", "keycloak_enabled"):
            out[k] = v.lower() in ("1", "true", "yes")
        elif k == "llm_vision_probe_ok":
            out[k] = v.lower() in ("1", "true", "yes")
        elif k == "llm_temperature":
            out[k] = resolve_temperature(v)
        elif k == "llm_vision_mode":
            out[k] = resolve_vision_mode(v)
        elif k == "max_concurrent_agents":
            try:
                out[k] = max(1, min(int(v), 8))
            except (TypeError, ValueError):
                pass
        else:
            out[k] = v
    out["llm_vision_mode"] = resolve_vision_mode(out.get("llm_vision_mode"))
    raw_models = stored.get("llm_models")
    if raw_models is None:
        catalog = empty_catalog()
        migrated = True
    else:
        catalog = parse_catalog_json(raw_models)
        migrated = False
    provider = str(out.get("llm_provider") or "local")
    model = str(out.get("llm_model") or "")
    if migrated and model.strip():
        catalog = ensure_model_in_catalog(catalog, provider, model)
        await db.set_setting("llm_models", json.dumps(catalog))
    out["llm_models"] = catalog
    return out


def _mask(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) <= 8:
        return "••••"
    return key[:3] + "••••" + key[-2:]


async def public_settings() -> dict[str, Any]:
    from .browser_factory import detect_browsers
    from .local_llm import resolve_temperature
    from .vision_probe import effective_vision_from_cache, resolve_vision_mode

    s = await effective_settings()
    detected = detect_browsers()
    mode = resolve_vision_mode(s.get("llm_vision_mode"))
    vision_effective = effective_vision_from_cache(s)
    probe_ok = s.get("llm_vision_probe_ok")
    if not isinstance(probe_ok, bool):
        probe_ok = None
    temp = resolve_temperature(s.get("llm_temperature"))
    # Legacy compat fields
    legacy_vision = None if mode == "auto" else (mode == "on")
    return {
        "llm_provider": s["llm_provider"],
        "llm_base_url": s["llm_base_url"],
        "llm_model": s["llm_model"],
        "llm_models": normalize_catalog(s.get("llm_models")),
        "llm_api_key": _mask(s.get("llm_api_key")),
        "llm_vision_mode": mode,
        "llm_vision_effective": vision_effective,
        "llm_vision_probe_ok": probe_ok,
        "llm_vision_probe_at": s.get("llm_vision_probe_at"),
        "llm_use_vision": legacy_vision,
        "llm_use_vision_effective": bool(vision_effective) if vision_effective is not None else False,
        "llm_temperature": temp,
        "browser_use_api_key": _mask(s.get("browser_use_api_key")),
        "openai_api_key": _mask(s.get("openai_api_key")),
        "anthropic_api_key": _mask(s.get("anthropic_api_key")),
        "headless": s["headless"],
        "browser_engine": s.get("browser_engine") or "chromium",
        "browser_executable": s.get("browser_executable") or "",
        "application_url": s.get("application_url") or "",
        "max_concurrent_agents": int(s.get("max_concurrent_agents") or 2),
        "ui_theme": (
            "light"
            if (s.get("ui_theme") or "") == "contrast"
            else (s.get("ui_theme") or "dark")
        ),
        "ui_locale": s.get("ui_locale") or "en",
        "atlassian_deployment": s.get("atlassian_deployment") or "server",
        "jira_base_url": s.get("jira_base_url") or "",
        "jira_email": s.get("jira_email") or "",
        "jira_api_token": _mask(s.get("jira_api_token")),
        "jira_project_key": s.get("jira_project_key") or "",
        "confluence_base_url": s.get("confluence_base_url") or "",
        "confluence_space_key": s.get("confluence_space_key") or "",
        "keycloak_enabled": bool(s.get("keycloak_enabled")),
        "keycloak_base_url": s.get("keycloak_base_url") or "",
        "keycloak_realm": s.get("keycloak_realm") or "",
        "keycloak_client_id": s.get("keycloak_client_id") or "",
        "keycloak_client_secret": _mask(s.get("keycloak_client_secret")),
        "keycloak_username": s.get("keycloak_username") or "",
        "keycloak_password": _mask(s.get("keycloak_password")),
        "keycloak_redirect_uri": s.get("keycloak_redirect_uri") or "",
        "detected_browsers": detected,
        "has_llm_api_key": bool(s.get("llm_api_key")),
        "has_browser_use_api_key": bool(s.get("browser_use_api_key")),
        "has_openai_api_key": bool(s.get("openai_api_key")),
        "has_anthropic_api_key": bool(s.get("anthropic_api_key")),
        "has_jira_api_token": bool(s.get("jira_api_token")),
        "has_keycloak_password": bool(s.get("keycloak_password")),
        "has_keycloak_client_secret": bool(s.get("keycloak_client_secret")),
        "jira_configured": bool(
            s.get("jira_base_url")
            and s.get("jira_api_token")
            and s.get("jira_project_key")
            and (
                s.get("jira_email")
                or (s.get("atlassian_deployment") or "server") == "server"
            )
        ),
        "keycloak_configured": bool(
            s.get("keycloak_enabled")
            and s.get("keycloak_base_url")
            and s.get("keycloak_realm")
            and s.get("keycloak_client_id")
            and s.get("keycloak_username")
            and s.get("keycloak_password")
        ),
        "confluence_configured": bool(
            (s.get("confluence_base_url") or s.get("jira_base_url"))
            and s.get("jira_api_token")
            and s.get("confluence_space_key")
            and (
                s.get("jira_email")
                or (s.get("atlassian_deployment") or "server") == "server"
            )
        ),
    }


def build_llm(cfg: dict[str, Any]):
    """Construct a browser-use compatible chat model from config."""
    from .local_llm import build_local_chat_openai, resolve_temperature

    provider = cfg.get("llm_provider") or "local"
    model = cfg.get("llm_model") or "local-model"
    temp = resolve_temperature(cfg.get("llm_temperature"))

    if provider == "browser_use":
        key = cfg.get("browser_use_api_key") or os.environ.get("BROWSER_USE_API_KEY", "")
        if key:
            os.environ["BROWSER_USE_API_KEY"] = key
        from browser_use import ChatBrowserUse

        return ChatBrowserUse(model=model) if model and model != "local-model" else ChatBrowserUse()

    if provider == "anthropic":
        key = cfg.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY", "")
        if key:
            os.environ["ANTHROPIC_API_KEY"] = key
        try:
            from browser_use import ChatAnthropic
        except ImportError:
            from browser_use.llm import ChatAnthropic  # type: ignore
        try:
            return ChatAnthropic(model=model or "claude-sonnet-4-0", temperature=temp)
        except TypeError:
            return ChatAnthropic(model=model or "claude-sonnet-4-0")

    if provider == "openai":
        key = cfg.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
        if key:
            os.environ["OPENAI_API_KEY"] = key
        try:
            from browser_use import ChatOpenAI
        except ImportError:
            from browser_use.llm import ChatOpenAI  # type: ignore
        try:
            return ChatOpenAI(model=model or "gpt-4o", temperature=temp)
        except TypeError:
            return ChatOpenAI(model=model or "gpt-4o")

    # local OpenAI-compatible (LM Studio / Ollama)
    # Qwen reasoning models often put AgentOutput JSON in reasoning_content
    # with empty content — LocalChatOpenAI hoists it so browser-use can parse.
    return build_local_chat_openai(
        model=model,
        api_key=str(cfg.get("llm_api_key") or "lm-studio"),
        base_url=cfg.get("llm_base_url"),
        temperature=temp,
    )


async def test_llm_connection(cfg: dict[str, Any]) -> dict[str, Any]:
    """Send a tiny prompt to verify the configured LLM is reachable."""
    import asyncio
    from browser_use.llm.messages import SystemMessage, UserMessage

    provider = str(cfg.get("llm_provider") or "local")
    model = str(cfg.get("llm_model") or "local-model")
    llm = build_llm(cfg)
    if hasattr(llm, "dont_force_structured_output"):
        try:
            llm.dont_force_structured_output = True  # type: ignore[attr-defined]
        except Exception:
            pass

    async def _invoke():
        return await llm.ainvoke(
            [
                SystemMessage(content="Reply with exactly the word: ok"),
                UserMessage(content="ping"),
            ]
        )

    try:
        result = await asyncio.wait_for(_invoke(), timeout=60.0)
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"LLM connection timed out after 60s. "
            f"Check that your {provider} server at '{cfg.get('llm_base_url')}' is running and reachable."
        )

    text = getattr(result, "completion", None) or getattr(result, "content", None) or result
    reply = str(text or "").strip()

    from .vision_probe import ensure_vision_for_cfg, resolve_vision_mode

    mode = resolve_vision_mode(
        str(cfg.get("llm_vision_mode")) if cfg.get("llm_vision_mode") is not None else None
    )
    vision_supported = await ensure_vision_for_cfg(
        {**cfg, "llm_vision_mode": mode},
        force_refresh=True,
        persist=True,
    )
    return {
        "ok": True,
        "provider": provider,
        "model": model,
        "reply": reply[:200] if reply else None,
        "llm_vision_mode": mode,
        "vision_supported": vision_supported,
    }
