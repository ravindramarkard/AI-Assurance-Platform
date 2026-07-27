# AgentBrowser Configuration tab — design

**Date:** 2026-07-28  
**Status:** Approved (Approach A)  
**Scope:** Frontend only — move browser-runtime settings UI; same settings API and behavior

## Problem

Application URL, Concurrency, Browser engine, custom executable, and Headless live under global **Settings**, while AgentBrowser already has a secondary-nav console. Operators expect AgentBrowser runtime controls next to Agents / Browsers / Scheduled / Analytics.

## Goals

- Add AgentBrowser secondary tab **Configuration**
- **Cut** Application URL, Concurrency, Browser (engine + custom path), and Headless from Settings and **paste** into that tab
- Preserve functionality as-is (same fields, validation, save path, runtime effects)
- Keep Keycloak in Settings

## Non-goals

- New backend endpoints or settings keys
- Moving Keycloak, LLM, theme, Atlassian, or console toggles
- Changing how Application URL / concurrency / browser launch are applied in the agent runner
- URL routing

## Navigation

AgentBrowser secondary tabs become:

| Tab | Notes |
|-----|--------|
| Agents | Unchanged |
| Browsers | Unchanged |
| Scheduled | Unchanged |
| Analytics | Unchanged |
| **Configuration** | New — browser runtime settings |

Accent: same orange `bu-*` as other AgentBrowser secondary tabs.

## Fields moved (exact)

| UI section | Settings keys | Notes |
|------------|---------------|--------|
| Application URL | `application_url` | Default start URL when task has no destination |
| Concurrency | `max_concurrent_agents` | Clamp 1–8 |
| Browser engine | `browser_engine` | `chromium` \| `chrome` \| `custom` |
| Browser executable | `browser_executable` | Shown when engine is `custom` |
| Headless | `headless` | Checkbox + existing help text |

## Stays in Settings

- LLM provider / models / API keys
- Theme / UI / language / consoles
- **Keycloak** (still may default redirect URI to stored Application URL)
- Atlassian (Jira / Confluence)
- Any other non-moved sections

## Layout & components

### New: `AgentBrowserConfiguration.tsx`

- Cut/paste the Application URL, Concurrency, and Browser markup (and related helpers: engine list, `engineStatus` / `detected_browsers`) from `SettingsPanel.tsx`
- Local form state initialized from `settings` prop
- **Save** calls existing `api.updateSettings(...)` with only the moved fields (or full patch compatible with current PUT — same keys and validation)
- On success, call `onSaved(updatedSettings)` so App refreshes in-memory settings

### Modify: `AgentBrowserPage.tsx`

- Extend `AgentBrowserTab` with `'configuration'`
- Add nav item (label via i18n, e.g. reuse Configuration wording or `navConfiguration`)
- Render `<AgentBrowserConfiguration settings={...} onSaved={...} />` when `tab === 'configuration'`
- Pass `settings` / `onSaved` from App (App already holds settings for SettingsPanel / AgentPage)

### Modify: `SettingsPanel.tsx`

- Remove Application URL, Concurrency, and Browser sections from the form UI
- Remove form fields and save-body keys for those settings from SettingsPanel **only if** they are no longer edited there (avoid sending stale empty values that wipe AgentBrowser config)
- Keep Keycloak and all other sections; Keycloak continues to read `application_url` from loaded settings for placeholders/hints where applicable

### i18n

- Add tab/page keys as needed (`navConfiguration`, optional blurb/title)
- Reuse existing `applicationUrl`, `concurrency`, `browser`, `browserEngine`, `headless`, `maxAgents`, `defaultStartUrl`, etc.

## Behavior — must work as-is after move

Critical: this is a **UI relocation**, not a behavior change.

1. **Persist:** Values save to the same settings store via `PUT /api/settings` and reload via `GET /api/settings`.
2. **Application URL:** Still used as default start URL when the task has no explicit destination; Runtime URL on New Agent still overrides for a single run.
3. **Concurrency:** Still caps parallel agents / queueing (`max_concurrent_agents`).
4. **Browser engine / executable / headless:** Still drive browser launch (Chromium / local Chrome / custom path; headless-shell / `--headless=new` as today).
5. **Detected browsers:** Status lines (Found / Not found) still use `settings.detected_browsers`.
6. **App state sync:** After save from Configuration, App’s `settings` state updates so AgentPage, Keycloak hints, Browsers view, and running agents see the new values without requiring a full page reload.
7. **Settings page:** Must not still show or overwrite the moved fields with blank defaults on Save.
8. **Keycloak:** Remains in Settings; still uses stored Application URL where it already does (e.g. redirect default / hints).

## Architecture sketch

```
Sidebar → AgentBrowser
            AgentBrowserPage
              ├─ agents | browsers | scheduled | analytics
              └─ configuration → AgentBrowserConfiguration
                                   ├─ form (moved fields)
                                   └─ api.updateSettings → onSaved → App.setSettings

SettingsPanel → LLM, Keycloak, Atlassian, UI… (no moved fields)
```

## Testing checklist

- [ ] Configuration tab appears in AgentBrowser secondary nav
- [ ] Settings no longer shows Application URL / Concurrency / Browser / Headless
- [ ] Save Application URL → new agent without explicit URL uses it; Runtime URL still overrides
- [ ] Save concurrency 1 → second agent queues; raise to 2+ → parallel allowed (same as before)
- [ ] Switch engine + headless → next agent launch uses new settings
- [ ] Custom engine shows executable field; path persists after reload
- [ ] Keycloak still in Settings; still references Application URL correctly
- [ ] Saving Settings (without the moved fields) does not clear Application URL / browser settings
- [ ] A2A / Red Team / API Test unchanged

## Approach decision

**Approach A (chosen):** Dedicated Configuration tab; cut from Settings; same API.

Rejected: B (keep in both places), C (separate config store / new backend).
