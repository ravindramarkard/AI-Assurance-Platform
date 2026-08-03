# Application Login Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Application username/password next to Application URL and inject them into browser agents when login is required, while keeping Keycloak SSO credentials separate (Application first; Keycloak only on SSO-looking pages).

**Architecture:** Mirror the existing Keycloak pattern: new settings keys + `app_login.py` helpers for `sensitive_data` / system message; merge with Keycloak secrets in `agent_runner`; Configuration UI fields under Application URL with masked password save semantics.

**Tech Stack:** Python/FastAPI backend, React/TypeScript frontend, unittest, existing settings DB + `sensitive_data` browser-use injection.

**Spec:** `docs/superpowers/specs/2026-08-03-application-login-credentials-design.md`

## Global Constraints

- Prefer Application credentials first; Keycloak only when the page looks like Keycloak/SSO
- Both credential sets may be configured (do not remove Keycloak)
- Empty password on save must keep the previously stored password
- Partial Application credentials (user XOR password) → not configured; inject nothing
- No per-run username/password on New Agent
- URL priority unchanged (task → Runtime → Application URL)
- Never return raw `application_password` from the public settings API

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/app_login.py` | `is_configured`, `sensitive_data_for_agent`, `login_system_message` |
| `backend/tests/test_app_login.py` | Unit tests for helper + merge behavior |
| `backend/app/config.py` | Default env fields |
| `backend/app/models.py` | `SettingsUpdate` fields |
| `backend/app/routes/settings.py` | `ALLOWED` keys |
| `backend/app/llm_factory.py` | `effective_settings` / `public_settings` mask + flags |
| `backend/app/agent_runner.py` | Merge Application + Keycloak secrets/messages |
| `backend/app/response_style.py` | Mention Application login secrets |
| `backend/.env.example` | Optional documented keys |
| `frontend/src/api.ts` | Types |
| `frontend/src/components/AgentBrowserConfiguration.tsx` | Username/password fields + save |
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | Labels / help |

---

### Task 1: Application login helper (TDD)

**Files:**
- Create: `backend/app/app_login.py`
- Create: `backend/tests/test_app_login.py`

**Interfaces:**
- Produces:
  - `is_configured(cfg: dict[str, Any]) -> bool`
  - `sensitive_data_for_agent(cfg: dict[str, Any]) -> dict[str, str] | None`
  - `login_system_message(cfg: dict[str, Any]) -> str | None`
  - Secret keys: `x_app_user`, `x_app_pass`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_app_login.py`:

```python
"""Application login secrets for browser agents."""

import unittest

from app import app_login


class TestAppLogin(unittest.TestCase):
    def test_not_configured_when_missing(self):
        self.assertFalse(app_login.is_configured({}))
        self.assertFalse(app_login.is_configured({"application_username": "u"}))
        self.assertFalse(app_login.is_configured({"application_password": "p"}))
        self.assertIsNone(app_login.sensitive_data_for_agent({}))
        self.assertIsNone(app_login.login_system_message({}))

    def test_configured_injects_secrets(self):
        cfg = {"application_username": "demo", "application_password": "s3cret"}
        self.assertTrue(app_login.is_configured(cfg))
        secrets = app_login.sensitive_data_for_agent(cfg)
        self.assertEqual(
            secrets,
            {"x_app_user": "demo", "x_app_pass": "s3cret"},
        )
        msg = app_login.login_system_message(cfg)
        self.assertIsNotNone(msg)
        assert msg is not None
        self.assertIn("x_app_user", msg)
        self.assertIn("x_app_pass", msg)
        self.assertIn("Application login", msg)
        self.assertIn("Keycloak", msg)  # priority note vs SSO

    def test_merge_with_keycloak_keys(self):
        cfg = {
            "application_username": "appu",
            "application_password": "appp",
            "keycloak_enabled": True,
            "keycloak_base_url": "https://kc.example",
            "keycloak_realm": "r",
            "keycloak_client_id": "c",
            "keycloak_username": "kcu",
            "keycloak_password": "kcp",
        }
        from app import keycloak

        merged = {}
        app_s = app_login.sensitive_data_for_agent(cfg)
        kc_s = keycloak.sensitive_data_for_agent(cfg)
        if app_s:
            merged.update(app_s)
        if kc_s:
            merged.update(kc_s)
        self.assertEqual(merged["x_app_user"], "appu")
        self.assertEqual(merged["x_keycloak_user"], "kcu")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && .venv/bin/python -m unittest tests.test_app_login -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.app_login'` (or import error).

- [ ] **Step 3: Implement `app_login.py`**

Create `backend/app/app_login.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && .venv/bin/python -m unittest tests.test_app_login -v
```

Expected: OK (all tests PASS).

- [ ] **Step 5: Commit**

```bash
git add backend/app/app_login.py backend/tests/test_app_login.py
git commit -m "feat: add Application login secret helpers for browser agents"
```

---

### Task 2: Persist settings keys (backend wire-up)

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/routes/settings.py`
- Modify: `backend/app/llm_factory.py`
- Modify: `backend/.env.example`
- Test: `backend/tests/test_app_login.py` (extend with public-settings shape if practical) or add assertions via a small unittest that imports `public_settings` helpers — prefer extending with a pure `_mask` / dict-shape unit test on `llm_factory` public payload construction if async DB is heavy; otherwise manual verify via steps below.

**Interfaces:**
- Consumes: none from Task 1 for persistence
- Produces: settings keys `application_username`, `application_password`; public flag `has_application_password`

- [ ] **Step 1: Write a failing unit check for public payload fields**

Append to `backend/tests/test_app_login.py`:

```python
class TestAppLoginPublicShape(unittest.TestCase):
    def test_mask_helper_hides_password(self):
        from app.llm_factory import _mask

        self.assertTrue("••" in (_mask("s3cret") or "") or _mask("s3cret") == "••••")
```

(If `_mask` is private and already covered elsewhere, skip this micro-test and rely on Step 4 manual public_settings check — but still implement the wire-up.)

- [ ] **Step 2: Add config defaults**

In `backend/app/config.py`, immediately after `application_url: str = ""`:

```python
    application_username: str = ""
    application_password: str = ""
```

In `backend/.env.example`, after `APPLICATION_URL=...`:

```bash
# Optional login for Application URL (browser agent fills forms when needed)
# APPLICATION_USERNAME=
# APPLICATION_PASSWORD=
```

- [ ] **Step 3: Add SettingsUpdate + ALLOWED**

In `backend/app/models.py` `SettingsUpdate`, after `application_url`:

```python
    application_username: str | None = None
    application_password: str | None = None
```

In `backend/app/routes/settings.py` `ALLOWED`, after `"application_url"`:

```python
    "application_username",
    "application_password",
```

- [ ] **Step 4: Wire `effective_settings` and `public_settings`**

In `backend/app/llm_factory.py` `effective_settings` `out` dict, after `"application_url"`:

```python
        "application_username": settings.application_username,
        "application_password": settings.application_password,
```

In `public_settings` return dict, after `"application_url"`:

```python
        "application_username": s.get("application_username") or "",
        "application_password": _mask(s.get("application_password")),
```

Near other `has_*` flags:

```python
        "has_application_password": bool(s.get("application_password")),
```

Note: Frontend must not send masked password (`••`) back — same as Keycloak (`if (form.password && !form.password.includes('••'))`). Empty string omit keeps existing DB value because `SettingsUpdate` uses `exclude_none` and omitted keys are not written. Ensure the Configuration save path **omits** `application_password` when empty (do not send `""` if that would clear — check `db.set_setting`: empty string would overwrite. Frontend must omit the key entirely when blank, matching Keycloak).

- [ ] **Step 5: Verify import / public shape**

Run:

```bash
cd backend && .venv/bin/python -c "
from app.config import settings
assert hasattr(settings, 'application_username')
from app.models import SettingsUpdate
assert 'application_username' in SettingsUpdate.model_fields
from app.routes.settings import ALLOWED
assert 'application_password' in ALLOWED
print('ok')
"
```

Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/models.py backend/app/routes/settings.py backend/app/llm_factory.py backend/.env.example backend/tests/test_app_login.py
git commit -m "feat: persist Application username/password in settings"
```

---

### Task 3: Inject secrets in agent_runner + response style

**Files:**
- Modify: `backend/app/agent_runner.py` (Keycloak block ~461–467 and `sensitive_data` assign ~735–736)
- Modify: `backend/app/response_style.py` (Keycloak / SSO section)
- Test: extend `backend/tests/test_app_login.py` with a pure merge helper test (optional) — primary verification is code review of merge logic

**Interfaces:**
- Consumes: `app_login.sensitive_data_for_agent`, `app_login.login_system_message`, existing Keycloak helpers
- Produces: merged `sensitive_data` dict; appended system messages (Application message before Keycloak message)

- [ ] **Step 1: Replace Keycloak-only block with merge**

In `agent_runner.py`, replace the Keycloak-only append (~461–467) with:

```python
    # Application login + Keycloak SSO — append instructions / secrets when configured
    from . import app_login as app_login_mod
    from . import keycloak as keycloak_mod

    app_msg = app_login_mod.login_system_message(cfg)
    if app_msg:
        extend_system = f"{extend_system}\n\n{app_msg}"
    kc_msg = keycloak_mod.login_system_message(cfg)
    if kc_msg:
        extend_system = f"{extend_system}\n\n{kc_msg}"

    login_secrets: dict[str, str] = {}
    app_secrets = app_login_mod.sensitive_data_for_agent(cfg)
    if app_secrets:
        login_secrets.update(app_secrets)
    kc_secrets = keycloak_mod.sensitive_data_for_agent(cfg)
    if kc_secrets:
        login_secrets.update(kc_secrets)
```

Then replace:

```python
        if kc_secrets:
            agent_kwargs["sensitive_data"] = kc_secrets
```

with:

```python
        if login_secrets:
            agent_kwargs["sensitive_data"] = login_secrets
```

Search the file for any other `kc_secrets` uses in the same function and update them to `login_secrets`.

- [ ] **Step 2: Update response_style**

Replace the `## Keycloak / SSO` section in `RESPONSE_STYLE_MESSAGE` with:

```text
## Login credentials

If Application login credentials are configured (see system instructions), use `<secret>x_app_user</secret>` / `<secret>x_app_pass</secret>` on normal app login forms. Prefer these first.
If Keycloak credentials are configured, use `<secret>x_keycloak_user</secret>` / `<secret>x_keycloak_pass</secret>` only on Keycloak / SSO-looking pages.
Never type real passwords into the thought text.
```

- [ ] **Step 3: Sanity import**

Run:

```bash
cd backend && .venv/bin/python -c "
from app import agent_runner, app_login, keycloak
from app.response_style import RESPONSE_STYLE_MESSAGE
assert 'x_app_user' in RESPONSE_STYLE_MESSAGE
assert 'x_keycloak_user' in RESPONSE_STYLE_MESSAGE
print('ok')
"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/agent_runner.py backend/app/response_style.py
git commit -m "feat: inject Application login secrets into browser agents"
```

---

### Task 4: Frontend Configuration UI + i18n

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/AgentBrowserConfiguration.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`
- Modify: `frontend/src/i18n/locales/ar.ts`
- Modify: `frontend/src/i18n/locales/hi.ts`

**Interfaces:**
- Consumes: `application_username`, `application_password` (masked), `has_application_password` from settings API
- Produces: PUT body with username always; password only when newly typed (no `••`)

- [ ] **Step 1: Extend `AppSettings` in `api.ts`**

Near `application_url?: string`, add:

```typescript
  application_username?: string
  application_password?: string | null
  has_application_password?: boolean
```

- [ ] **Step 2: Add i18n keys**

In `en.ts` after `defaultStartUrl` (and mirror in `ar.ts` / `hi.ts`):

```typescript
  applicationUsername: 'Username',
  applicationPassword: 'Password',
  applicationLoginHelp:
    'Used when the agent needs to sign into the Application URL (or Runtime URL). Prefer these on normal login forms; Keycloak SSO credentials stay in Settings.',
```

Arabic/Hindi: provide equivalent short translations consistent with nearby Keycloak username/password strings.

- [ ] **Step 3: Update `AgentBrowserConfiguration.tsx` form**

Extend `FormState`:

```typescript
type FormState = {
  headless: boolean
  screenshot_archive: ScreenshotArchive
  screenshot_archive_user_set: boolean
  browser_engine: BrowserEngine
  browser_executable: string
  application_url: string
  application_username: string
  application_password: string
  max_concurrent_agents: number
}
```

Initialize / sync from settings:

```typescript
application_username: settings.application_username || '',
application_password: '',
```

In `save()`, build body like Keycloak:

```typescript
const body: Record<string, unknown> = {
  application_url: form.application_url.trim(),
  application_username: form.application_username.trim(),
  max_concurrent_agents: Math.max(1, Math.min(8, Number(form.max_concurrent_agents) || 2)),
  browser_engine: form.browser_engine,
  browser_executable: form.browser_executable.trim(),
  headless: form.headless,
  screenshot_archive: form.screenshot_archive,
  screenshot_archive_user_set: form.screenshot_archive_user_set,
}
if (form.application_password && !form.application_password.includes('••')) {
  body.application_password = form.application_password
}
const s = await api.updateSettings(body as Parameters<typeof api.updateSettings>[0])
```

After save, clear password field and keep username from response:

```typescript
application_username: s.application_username || '',
application_password: '',
```

- [ ] **Step 4: Add UI under Application URL section**

After the Application URL help paragraph, before the Concurrency section:

```tsx
<label className="block mb-2 mt-3">
  <span className="text-xs text-slate-400 block mb-1">{t('applicationUsername')}</span>
  <input
    type="text"
    autoComplete="username"
    value={form.application_username}
    onChange={(e) => setForm({ ...form, application_username: e.target.value })}
    className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
  />
</label>
<label className="block mb-2">
  <span className="text-xs text-slate-400 block mb-1">{t('applicationPassword')}</span>
  <input
    type="password"
    autoComplete="current-password"
    value={form.application_password}
    placeholder={settings?.has_application_password ? '••••••••' : ''}
    onChange={(e) => setForm({ ...form, application_password: e.target.value })}
    className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
  />
</label>
<p className="text-[11px] text-slate-500 mb-1">{t('applicationLoginHelp')}</p>
```

- [ ] **Step 5: Typecheck / lint if available**

Run:

```bash
cd frontend && npm run build
```

Expected: build succeeds (or at least no errors in touched files). If full build is slow, `npx tsc --noEmit` is acceptable.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.ts frontend/src/components/AgentBrowserConfiguration.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "feat: Application login fields on AgentBrowser Configuration"
```

---

### Task 5: Manual acceptance checklist

**Files:** none (verification only)

- [ ] **Step 1: Backend unit suite**

```bash
cd backend && .venv/bin/python -m unittest tests.test_app_login -v
```

Expected: PASS

- [ ] **Step 2: UI smoke (local)**

1. Open AgentBrowser → Configuration
2. Set Application URL + username + password → Save
3. Reload → username still filled; password empty with `••••••••` placeholder; `has_application_password` true
4. Save again without typing password → secret still present (start a browser task that hits login; agent should receive secrets — or check DB settings row)
5. Confirm Settings → Keycloak UI unchanged
6. With both Application + Keycloak configured, start a browser session and confirm system message / sensitive_data includes both `x_app_*` and `x_keycloak_*` (debug log or temporary print is fine during verify, remove before finish)

- [ ] **Step 3: Final commit only if leftover fixes**

If smoke found fixes, commit them with a focused message; otherwise done.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Settings keys + mask + `has_application_password` | Task 2 |
| Configuration UI under Application URL | Task 4 |
| Empty password keeps secret | Task 2 note + Task 4 save omit |
| Partial credentials not injected | Task 1 |
| `x_app_*` injection | Task 1 + 3 |
| Keycloak unchanged + still injects | Task 3 |
| Priority Application first / Keycloak on SSO | Task 1 message + Task 3 response_style |
| URL priority unchanged | No code change (constraint) |
| Unit tests | Task 1 (+ Task 2/5) |

## Placeholder / consistency check

- Secret key names consistent: `x_app_user` / `x_app_pass`
- Settings keys consistent: `application_username` / `application_password`
- No TBD/TODO left in steps
