# AgentBrowser Assurance consoles toggle — design

**Date:** 2026-07-28  
**Status:** Approved  
**Scope:** Frontend preferences + sidebar visibility (same pattern as A2A / Red Team / API Test)

## Problem

A2A, Red Team, and API Test can be shown/hidden under Settings → Assurance consoles. AgentBrowser cannot; it is always visible in the sidebar.

## Goals

- Add an **AgentBrowser** (label: **AI Assurance Platform** after branding change) toggle under Assurance consoles
- When Off, hide the sidebar nav entry for that view
- Default **On** (match other consoles)
- When the AgentBrowser view is active and the toggle is turned Off (or cold start with it Off), navigate to **Settings**
- Persist via localStorage like the other console flags

## Non-goals

- Backend persistence of the toggle
- Hiding AgentBrowser secondary tabs individually
- Changing A2A / Red Team / API Test toggle behavior

## Changes

### `preferences.tsx`

- Extend `ConsoleFeatures` with `agentbrowser: boolean`
- Add `CONSOLE_AGENTBROWSER_KEY = 'aip_console_agentbrowser'`
- `readStoredConsoles`: default `agentbrowser: true`
- Persist in the existing consoles `useEffect`

### `SettingsPanel.tsx`

- Add fourth row in Assurance consoles list:
  - `id: 'agentbrowser'`
  - label: `t('navAgentBrowser')` (will read **AI Assurance Platform** after branding i18n)
  - blurb: `t('agentBrowserBlurb')` or a short dedicated hint

### `Sidebar.tsx`

- Gate the AgentBrowser nav entry with `consoles.agentbrowser` (same spread pattern as a2a/redteam/apitest)

### `App.tsx`

- If `view === 'agentbrowser' && !consoles.agentbrowser` → `setView('settings')`
- Update existing console-disable fallbacks that currently send users to `agentbrowser` when another console is disabled: if AgentBrowser is also off, fall through to `settings` (or first enabled console, then settings)

## Fallback rule (approved)

**Off → Settings.**

## Testing

- [ ] Assurance consoles shows AgentBrowser / AI Assurance Platform toggle; default On
- [ ] Off hides sidebar entry; On shows it again after refresh (localStorage)
- [ ] Disabling while on AgentBrowser switches to Settings
- [ ] Other consoles still work; disabling them does not break when AgentBrowser is Off
