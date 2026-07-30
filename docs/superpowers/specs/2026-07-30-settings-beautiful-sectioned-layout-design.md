# Settings beautiful sectioned layout — design

**Date:** 2026-07-30  
**Status:** Approved (Approach B — restore sectioned layout + visual polish)  
**Scope:** Frontend-only visual/layout refresh of `SettingsPanel.tsx`

## Problem

Settings is a long, narrow (`max-w-lg`) scroll of mixed sections. Hierarchy and wayfinding are weak for a form this large. A sectioned layout with left nav + sticky Save previously shipped, then later feature commits flattened the page back to a single column.

## Goals

- Restore sectioned layout: left mini-nav (desktop) / chips (mobile) + one active content panel
- Apply visual polish: clearer header hierarchy, consistent field rhythm, status chips, sticky Save with backdrop
- Keep all existing settings behavior and API fields (including Vision Auto/On/Off and Temperature)
- Stay on existing `ink-*` / `bu-*` / `border-line` tokens

## Non-goals

- Backend / settings API changes
- Per-section save
- New settings keys or field logic changes
- Theme token redesign or new color system
- URL routing for sections

## Layout

### Desktop (`md+`)

| Region | Behavior |
|--------|----------|
| Shell | Full-height column; content `max-w-5xl` centered |
| Header | Title (`text-xl`, tight tracking) + short blurb |
| Left rail | ~192px sticky; five sections listed vertically |
| Content | Active section only, in a shared card frame |
| Footer | Sticky Save (+ status message) aligned under content column |

### Mobile (`< md`)

- Horizontal scrollable section chips above content
- Same card + sticky Save

### Sections (nav order)

1. **Appearance** — theme, font, font size, language  
2. **Consoles** — AgentBrowser / A2A / Red Team / API Test toggles  
3. **Language model** — provider, credentials, model, vision, temperature, test connection  
4. **Keycloak** — existing Keycloak block  
5. **Atlassian** — existing Jira / Confluence block  

Active nav item: accent start-border + soft `bu-500` fill matching existing selected chips.

## Visual polish

- **Section card:** Header band (title + blurb + optional status chip, e.g. Keycloak “Configured”) + padded body; `bg-ink-850`, `border-line`, `rounded-xl`
- **Field rhythm:** Consistent label → control → helper spacing; keep existing 2-column grids for paired fields
- **Status feedback:** Connection/test messages as compact inline status (success/error tint), not loose raw text
- **Sticky Save:** `border-t` footer with backdrop blur; primary Save button + message; visible while scrolling content
- One composition language with the rest of the app (no purple glow, no new brand palette)

## Behavior

- Switching sections is UI-only (`useState`); form state remains one object
- Save still `PUT`s the full settings payload as today
- Appearance theme/locale may keep immediate partial saves where they already do today
- No URL routing for sections (app remains `useState` views)
- Unsaved edits are preserved when switching sections

## Acceptance

- [ ] Left nav (desktop) / chips (mobile) switch sections without losing unsaved form edits
- [ ] All existing fields still present and save correctly (including Vision + Temperature)
- [ ] LLM / Keycloak / Atlassian live inside the shared section card chrome
- [ ] Sticky Save visible while scrolling the content panel
- [ ] Light/dark themes still readable (existing tokens)
- [ ] `npx tsc -b --noEmit` passes in `frontend/`

## Primary files

- Modify: `frontend/src/components/SettingsPanel.tsx`
- Optional i18n: restore `settingsNavLlm` / `settingsLlmBlurb` (and equivalents) in `en` / `ar` / `hi` if missing after the flatten regression
