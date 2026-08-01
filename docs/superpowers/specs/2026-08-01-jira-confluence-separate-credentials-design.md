# Separate Jira / Confluence credentials + tabs — design

**Date:** 2026-08-01  
**Status:** Approved (Approach 1 — full separate Confluence credentials)  
**Scope:** Settings → Jira & Confluence: tabbed UI + independent Confluence auth fields

## Problem

Jira and Confluence share one username/token/`jira_auth_type`. Users often have different credentials (and PATs) per product. The form also mixes both products in one long panel.

## Goals

- **Jira | Confluence** tabs under a shared Server/Cloud control
- Confluence gets its own auth type, username/email, and token (same modes as Jira)
- Test / create / chat for Confluence use Confluence credentials only
- Keep existing Jira fields and project/space pickers (fetch-on-Test)

## Non-goals

- Per-product Server/Cloud deployment (shared `atlassian_deployment` only)
- “Same as Jira” toggle
- Silent backend copy of Jira secrets into Confluence
- Changing issue/page create UX beyond which credentials are used

## UI

1. Shared **Server / Cloud** above tabs  
2. Tabs: **Jira** | **Confluence**  
3. **Jira tab:** base URL, Server auth chips or Cloud email, secret, project `<select>`, Test Jira  
4. **Confluence tab:** base URL, Server auth chips or Cloud email, secret, space `<select>`, Test Confluence  
5. Sticky Save applies to both  

**UI-only prefill:** If Confluence token is empty and Jira has a saved token, prefill Confluence auth fields from Jira in the form (not auto-saved). User must Save to persist.

## Data model (new)

| Key | Values | Default |
|-----|--------|---------|
| `confluence_auth_type` | `password` \| `pat` | `password` |
| `confluence_email` | string | `""` |
| `confluence_api_token` | secret | `""` |

Existing: `atlassian_deployment`, Jira fields, `confluence_base_url`, `confluence_space_key`.

## Backend

- Allow-list + `SettingsUpdate` + `config` + `public_settings` (`has_confluence_api_token`, mask token)
- `resolve_auth_username` accepts product-specific auth type + email keys (or a small helper for Confluence)
- Integrations `_cfg`: Confluence uses `confluence_*` for Test/create; Jira unchanged
- `confluence_configured`: Confluence base URL (no longer require Jira token), Confluence token, space key, auth ready
- Chat `integration_actions`: Confluence path uses Confluence creds

## Acceptance

- [ ] Tabs switch Jira vs Confluence panels without losing form state  
- [ ] Server Confluence PAT hides username; Test uses Bearer  
- [ ] Confluence Test/create do not use Jira token  
- [ ] UI prefill from Jira when Confluence empty; Save required to persist  
- [ ] Unit tests for Confluence auth resolution + configured flags; frontend `tsc` passes  

## Primary files

- `backend/app/{atlassian,config,models,llm_factory,integration_actions}.py`
- `backend/app/routes/{settings,integrations}.py`
- `backend/tests/test_atlassian_lists.py` (extend)
- `frontend/src/{api.ts,components/SettingsPanel.tsx,i18n/locales/*}`
