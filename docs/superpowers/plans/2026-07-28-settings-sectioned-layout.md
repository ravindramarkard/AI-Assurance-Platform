# Settings Sectioned Layout — Implementation Plan

> **For agentic workers:** Execute inline or via subagent-driven-development.

**Goal:** Restructure Settings into left mini-nav + one active section panel with sticky Save, without changing settings API behavior.

**Architecture:** UI-only `useState` section switch inside `SettingsPanel.tsx`; one form object; sticky footer Save.

**Tech Stack:** React, TypeScript, Tailwind, existing i18n.

**Spec:** `docs/superpowers/specs/2026-07-28-settings-sectioned-layout-design.md`

## Global Constraints

- Frontend only — no API/settings key changes
- Preserve all fields and save/test behavior
- Use existing `ink-*` / `bu-*` / `border-line` tokens
- No URL routing for sections

## Tasks

### Task 1: i18n section labels
Add `settingsNavLlm`, `settingsLlmBlurb` (and reuse existing section titles) in en/ar/hi.

### Task 2: Section shell in SettingsPanel
- `section` state; desktop left nav + mobile chips; content card; sticky Save
- Move LLM into Language model card; Keycloak/Atlassian into their cards

### Task 3: Verify
`cd frontend && npx tsc -b --noEmit` then commit.
