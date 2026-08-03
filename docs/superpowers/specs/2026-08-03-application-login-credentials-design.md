# Application login credentials — design

**Date:** 2026-08-03  
**Status:** Approved (Approach 1 — extend Keycloak secret pattern)  
**Scope:** Store Application username/password next to Application URL; inject into browser agents when login is required; keep Keycloak SSO credentials separate

## Problem

Operators set an Application URL (default start site) under AgentBrowser → Configuration, but have no matching place to store that app’s username/password. Login today only works when Keycloak SSO is fully configured in Settings. Many apps use a normal login form (not Keycloak), so agents invent or skip credentials.

## Goals

- Store **Application username** and **Application password** with the same config surface as Application URL (AgentBrowser → Configuration)
- Pass those credentials to the browser agent via `sensitive_data` when configured
- Keep **Keycloak** credentials and Settings UI unchanged
- Prefer Application credentials first; use Keycloak secrets only when the page looks like Keycloak/SSO

## Non-goals

- Per-run username/password on New Agent / Runtime URL form
- Moving or removing Keycloak from Settings
- Encrypting secrets beyond existing settings storage / masking
- Changing Application URL / Runtime URL resolution order

## Decisions

| Topic | Choice |
|-------|--------|
| Credential model | **C** — both Application login and Keycloak |
| Priority when both set | **B** — Application first; Keycloak only on SSO/Keycloak-looking pages |
| Implementation | Extend existing Keycloak `sensitive_data` + system-message pattern |

## Settings keys

| Key | Type | Notes |
|-----|------|--------|
| `application_username` | string | Plaintext in settings store; returned as-is in API |
| `application_password` | string | Secret; masked on read; empty PUT keeps existing value |

Related (unchanged): `application_url`, all `keycloak_*` keys.

API response additions (mirror Keycloak):

- `has_application_password: bool`
- Password field returned masked (e.g. `••••••••`) or omitted; never return the raw password

## UI

**Location:** AgentBrowser → Configuration, directly under the Application URL section.

**Fields:**

- Username (text)
- Password (password input; placeholder `••••••••` when `has_application_password`)

**Save behavior:**

- Include `application_username` (trimmed) in `updateSettings`
- Send `application_password` only when the user typed a new value (not the mask placeholder)
- Empty password field on save → do not clear stored password

**Keycloak:** Remains under Settings → Keycloak SSO; no field moves.

## Agent injection

On browser agent start (`agent_runner`), build `sensitive_data` and system instructions as follows:

### Application login (when both username and password are non-empty)

Inject:

- `x_app_user` → application username
- `x_app_pass` → application password

System message (summary):

- On a **normal application login form**, type `<secret>x_app_user</secret>` / `<secret>x_app_pass</secret>`
- Prefer these over inventing credentials
- Never echo real passwords in thoughts

### Keycloak (unchanged when configured)

Keep:

- `x_keycloak_user` / `x_keycloak_pass`
- Existing Keycloak SSO system message

### Priority (when both Application and Keycloak secrets are present)

1. **Default / app login page** → use Application secrets (`x_app_*`)
2. **Keycloak / SSO-looking page** (Keycloak branding, realm/auth URL, IdP redirect) → use Keycloak secrets (`x_keycloak_*`)
3. If only one credential set is configured → use that set
4. If neither → no login secrets (current behavior)

Merge both dicts into `Agent(..., sensitive_data=...)` when both apply; instructions encode the priority.

### Partial credentials

Username without password (or password without username) → Application login is **not configured**; do not inject partial `x_app_*` keys.

### Runtime URL

Runtime URL overrides start URL only. It does **not** change which stored credentials apply.

## Backend touchpoints

- `config.py` / settings persistence — new keys
- `routes/settings.py` — allowlist + empty-password preserve
- `llm_factory.py` (or equivalent settings DTO) — mask + `has_application_password`
- `models.py` — settings update model fields
- New small helper (e.g. `app_login.py`) or extend next to `keycloak.py` for `sensitive_data_for_agent` + `login_system_message`
- `agent_runner.py` — merge Application + Keycloak secrets/messages
- `response_style.py` — brief note that Application login secrets exist when configured

## Frontend touchpoints

- `AgentBrowserConfiguration.tsx` — form fields + save
- `api.ts` — types
- i18n (`en` / `ar` / `hi`) — labels and short help text

## Testing

- Unit: Application secrets present/absent; no partial inject; merge with Keycloak keys; masked settings payload; empty password preserves store
- Optional light check: Configuration save round-trip for username + `has_application_password`

## Acceptance

- [ ] Configuration shows username/password under Application URL
- [ ] Save persists username; password masked on reload; re-save without typing password keeps secret
- [ ] Browser agent receives `x_app_*` when Application login is fully configured
- [ ] Keycloak still injects `x_keycloak_*` when enabled/configured
- [ ] System instructions prefer Application credentials, Keycloak only on SSO-looking pages
- [ ] Keycloak Settings UI unchanged
- [ ] URL priority unchanged (task → Runtime → Application URL)
