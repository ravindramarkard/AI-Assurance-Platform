# Atlassian Auth + Project/Space Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server auth type (Username/Password vs PAT-only) plus Test-driven Jira project and Confluence space dropdowns in Settings.

**Architecture:** Persist `jira_auth_type`; enrich `POST /api/integrations/test` with `projects` / `spaces` lists from new `atlassian.list_*` helpers; Settings UI swaps free-text keys for selects and shows credential-type chips on Server.

**Tech Stack:** FastAPI, httpx, React, TypeScript, pytest, existing i18n.

**Spec:** `docs/superpowers/specs/2026-08-01-atlassian-auth-project-pickers-design.md`

## Global Constraints

- Server auth: Username/Password **or** PAT-only (Bearer). No username+PAT
- Cloud UI unchanged (email + API token); still returns projects/spaces on Test
- Fetch lists on successful Test only (saved settings)
- Keep storing defaults in `jira_project_key` / `confluence_space_key`
- Cap lists ~200 items

---

### Task 1: Backend list helpers + auth-type plumbing

**Files:**
- Create: `backend/tests/test_atlassian_lists.py`
- Modify: `backend/app/atlassian.py`
- Modify: `backend/app/config.py`, `models.py`, `routes/settings.py`, `llm_factory.py`
- Modify: `backend/app/routes/integrations.py`, `integration_actions.py` (auth username for PAT)

- [ ] **Step 1:** Write failing tests for `list_jira_projects` / `list_confluence_spaces` parsing (httpx mocked) and `_auth_headers` PAT-only
- [ ] **Step 2:** Implement list helpers; wire `jira_auth_type` through settings; enrich test responses; clear username when Server+pat for auth calls
- [ ] **Step 3:** `cd backend && python -m pytest tests/test_atlassian_lists.py -v` PASS
- [ ] **Step 4:** Commit

### Task 2: Frontend Settings UI + i18n + api types

**Files:**
- Modify: `frontend/src/api.ts`, `SettingsPanel.tsx`, `i18n/locales/{en,ar,hi}.ts`

- [ ] **Step 1:** Add i18n keys + `AppSettings.jira_auth_type` + test response `projects`/`spaces` types
- [ ] **Step 2:** Credential-type chips (Server); project/space `<select>`s fed by Test; saved-key fallback option
- [ ] **Step 3:** `cd frontend && npx tsc -b --noEmit` PASS
- [ ] **Step 4:** Commit

### Task 3: Verify

- [ ] Backend pytest for atlassian lists + a quick settings allow-list smoke if needed
- [ ] Frontend tsc
- [ ] Commit any fixes
