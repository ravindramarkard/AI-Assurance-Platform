# Atlassian credential type + project/space pickers — design

**Date:** 2026-08-01  
**Status:** Approved (Approach 1 — fetch-on-Test)  
**Scope:** Settings → Jira & Confluence: Server auth modes + auto-load project/space dropdowns

## Problem

Settings forces a single “Password or PAT” field and free-text Jira project / Confluence space keys. Users must know keys in advance. Server auth actually has two distinct modes (username+password vs PAT-only Bearer), which the UI does not make clear.

## Goals

- Server credential-type control: **Username / Password** or **PAT** (no username+PAT mode)
- On **Test Jira** / **Test Confluence**, return assigned projects / spaces and show them as dropdowns
- User picks a default project/space; values still persist as `jira_project_key` / `confluence_space_key`
- Cloud auth UI unchanged (email + API token)

## Non-goals

- Choosing project/space at issue-log / page-create time (defaults stay in Settings)
- OAuth / Atlassian Connect apps
- Changing how chat “log to Jira” / Confluence create flows work beyond using the saved default keys
- Separate “Load projects” buttons (fetch is part of Test)

## Decisions

| Topic | Choice |
|-------|--------|
| Project/space UX | Approach A — dropdown of assigned items; user picks default |
| Server auth modes | Username/Password **or** PAT-only (Bearer). No username+PAT |
| When lists load | Approach 1 — on successful Test |
| Storage | Keep existing key fields; add `jira_auth_type` |

## UI (Settings → Jira & Confluence)

### Server / Data Center

1. **Credential type** radios/chips: `Username / Password` | `PAT`
2. If **Username / Password:** Username + Password fields  
3. If **PAT:** PAT field only (no username)  
4. **Jira project:** `<select>` of `{ key, name }` from last successful Test Jira; disabled until then with helper “Test Jira to load projects”  
5. **Confluence space:** same pattern after Test Confluence  

### Cloud

- No credential-type control  
- Email + API token as today  
- Same project/space dropdowns after Test  

### Saved-key fallback

If a stored `jira_project_key` / `confluence_space_key` is not in the fetched list, keep a temporary option so Save does not clear the previous default until the user picks another.

## Backend

### New setting

| Key | Values | Default |
|-----|--------|---------|
| `jira_auth_type` | `"password"` \| `"pat"` | `"password"` |

- Allowed in settings update allow-list  
- Exposed in `public_settings`  
- When `pat` and Server: treat username as empty for `_auth_headers` (existing Bearer path)  
- When `password` and Server: require username + password (Basic)  
- Cloud ignores `jira_auth_type`

### List helpers (`atlassian.py`)

- `list_jira_projects(...)` — Server/Cloud projects the user can access  
  - Prefer: `GET /rest/api/{2|3}/project` (or `/project/search` on Cloud with pagination as needed)  
  - Return `[{ "key": "...", "name": "..." }, ...]` sorted by key  
- `list_confluence_spaces(...)` — spaces the user can view/create in  
  - Prefer: `GET .../space?limit=…` (paginate)  
  - Return `[{ "key": "...", "name": "..." }, ...]` sorted by key  

Use existing `_auth_headers` / `_request`. Cap lists reasonably (e.g. first ~200) with clear truncation if needed.

### Test endpoint enrichment

`POST /api/integrations/test` already tests Jira/Confluence against **saved** settings (unchanged — user Saves credentials first, then Tests). On success:

- **Jira:** existing myself payload **plus** `projects: [{key, name}, ...]`  
- **Confluence:** existing current-user payload **plus** `spaces: [{key, name}, ...]`  

Failures stay as today (HTTP error / message); no partial list required. Out of scope: sending unsaved draft credentials in the Test body.

### Auth readiness

- Server + `jira_auth_type=password`: require non-empty username and token  
- Server + `jira_auth_type=pat`: require token only  
- Cloud: require email + token (unchanged)

`jira_configured` / `confluence_configured` still require the selected project/space key after the user picks one.

## Frontend behavior

1. Persist `jira_auth_type` with Save settings  
2. On Test Jira success: populate project options; if current selection empty and list non-empty, preselect first (or keep saved key if present)  
3. On Test Confluence success: same for spaces  
4. Status tint for test messages remains as in the polished Settings UI  
5. i18n: new strings in `en` / `ar` / `hi` for credential type labels and load helpers  

## Acceptance

- [ ] Server: switching to PAT hides username; Test uses Bearer  
- [ ] Server: Username/Password shows both fields; Test uses Basic  
- [ ] Cloud: no credential-type control; Test still returns projects/spaces  
- [ ] Test Jira fills project dropdown; choosing one saves as `jira_project_key`  
- [ ] Test Confluence fills space dropdown; choosing one saves as `confluence_space_key`  
- [ ] Saved key missing from list still appears until replaced  
- [ ] Existing issue/page create flows keep using saved keys  
- [ ] Backend tests cover list helpers + auth-type branching; frontend `tsc` passes  

## Primary files

- `backend/app/atlassian.py` — list projects/spaces  
- `backend/app/routes/integrations.py` — enrich test response; auth readiness  
- `backend/app/routes/settings.py` / `models.py` / `llm_factory.py` / `config.py` — `jira_auth_type`  
- `backend/tests/` — new/extended Atlassian tests  
- `frontend/src/components/SettingsPanel.tsx` — UI  
- `frontend/src/api.ts` — types for test response lists  
- `frontend/src/i18n/locales/{en,ar,hi}.ts` — copy  
