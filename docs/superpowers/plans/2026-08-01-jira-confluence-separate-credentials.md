# Jira / Confluence Separate Credentials Implementation Plan

> **For agentic workers:** Execute inline or via subagent-driven-development.

**Goal:** Tabbed Jira/Confluence Settings with independent Confluence credentials.

**Architecture:** New `confluence_auth_type` / `confluence_email` / `confluence_api_token`; integrations resolve Confluence auth separately; Settings UI tabs.

**Tech Stack:** FastAPI, React, TypeScript, unittest.

**Spec:** `docs/superpowers/specs/2026-08-01-jira-confluence-separate-credentials-design.md`

## Global Constraints

- Shared `atlassian_deployment` only
- Confluence auth modes match Jira (password vs PAT-only)
- No silent backend secret migration; UI-only prefill
- Test uses saved settings

---

### Task 1: Backend Confluence credentials

- Extend settings model/config/allow-list/public_settings
- Wire integrations + integration_actions to Confluence creds
- Extend unit tests
- Commit

### Task 2: Frontend tabs + form fields

- i18n, api types, SettingsPanel tabs + Confluence auth UI + prefill
- `tsc` + commit
