# Sidebar branding — design

**Date:** 2026-07-28  
**Status:** Approved (Approaches A + B)  
**Scope:** Frontend labels / header chrome only — no backend changes

## Problem

The top header and sidebar both show product branding. The sidebar brand still says **AgentBrowser**, while the top bar says **AI Assurance Platform / local**, which duplicates and splits the brand.

## Goals

- Sidebar brand row shows **AI Assurance Platform**
- Sidebar nav item for the AgentBrowser view is also labeled **AI Assurance Platform**
- Remove the top header’s left brand block (AI badge + “AI Assurance Platform” + `/ local`)
- Keep top header right-side controls (theme, language, connection, provider/model)

## Non-goals

- Renaming AgentBrowser secondary console title/blurb (“AgentBrowser” / “Browser agents & workspace”)
- Changing A2A / Red Team / API Test labels
- Backend / i18n structure beyond the strings and JSX cited below
- AgentBrowser enable/disable toggle (requested separately; not part of this approved branding scope)

## Changes

### Sidebar brand row (`Sidebar.tsx`)

- Replace `{t('brandShort')}` with `{t('brand')}` so the header shows **AI Assurance Platform**
- Keep AI badge and collapse button

### Sidebar nav item (`Sidebar.tsx` + i18n)

- Change `navAgentBrowser` (and any title that surfaces the same string) to **AI Assurance Platform** in `en` / `ar` / `hi`
- Click target remains `onView('agentbrowser')` — behavior unchanged

### Top header (`App.tsx`)

- Remove the left cluster: AI badge button, `{t('brand')}`, `/`, `{t('local')}`, and session breadcrumb that depended on that brand click — **or** relocate “home” / session crumbs if still needed without the brand button
- Prefer: remove brand/home button and `/ local`; if session id crumb is useful, keep a minimal left crumb without repeating the platform name
- Right side unchanged: theme select, language select, connection status, provider, model

**Home behavior:** Brand click currently calls `goHome()`. After removing the left brand, home remains available via New Agent (Agents tab) / existing flows — no new top-bar home control required unless product later asks for one.

## Testing

- [ ] Sidebar top shows **AI Assurance Platform** (not AgentBrowser)
- [ ] Sidebar nav item shows **AI Assurance Platform** and still opens AgentBrowser
- [ ] Top bar has no left AI + platform name + `/ local`
- [ ] Top bar theme / language / connection / model still work
- [ ] AgentBrowser secondary aside still titled AgentBrowser (unchanged)
- [ ] A2A / Red Team / API Test labels unchanged

## Approach decision

**A + B (chosen):** Platform name in sidebar brand and nav; strip duplicate platform name from top-left header.
