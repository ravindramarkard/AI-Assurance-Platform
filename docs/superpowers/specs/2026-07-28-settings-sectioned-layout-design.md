# Settings page sectioned layout — design

**Date:** 2026-07-28  
**Status:** Approved (Approach B)  
**Scope:** Frontend-only visual/layout refresh of `SettingsPanel.tsx`

## Problem

Settings is a single narrow column (`max-w-lg`) with a long scroll of mixed sections. LLM fields sit outside card chrome used by Appearance / Consoles. Hierarchy and wayfinding are weak for a form this large.

## Goals

- Sectioned layout: left mini-nav + one active content panel
- Consistent section cards (title, blurb, body) using existing `ink-*` / `bu-*` / `border-line` tokens
- Sticky Save footer for the whole form
- Mobile: horizontal section chips instead of left rail
- Preserve all existing settings behavior and API fields

## Non-goals

- Backend / settings API changes
- Per-section save
- New settings keys or field logic changes
- Theme token redesign or new color system

## Layout

### Desktop (`md+`)

| Region | Behavior |
|--------|----------|
| Shell | `max-w-5xl` (or similar), padded page |
| Left rail | ~180px sticky; sections listed vertically |
| Content | Active section only, in a shared card frame |
| Footer | Sticky Save (+ status message) spanning content column |

### Mobile (`< md`)

- Horizontal scrollable section chips (or compact select) above content
- Same card + sticky Save

### Sections (nav order)

1. **Appearance** — theme, font, font size, language  
2. **Consoles** — AgentBrowser / A2A / Red Team / API Test toggles  
3. **Language model** — provider, credentials, model list, test connection  
4. **Keycloak** — existing Keycloak block  
5. **Atlassian** — existing Jira / Confluence block  

Active nav item: accent border / `bu-500` treatment matching existing selected chips.

## Visual rules

- One composition language with the rest of the app (no purple glow, no new brand palette)
- Section title + one short supporting line per panel
- Cards: `bg-ink-850`, `border-line`, rounded-xl; inputs keep current field styles
- LLM provider / model list live inside the Language model card (same chrome as Consoles)

## Behavior

- Switching sections is UI-only (`useState`); form state remains one object
- Save still `PUT`s the full settings payload as today
- Appearance theme/locale may keep immediate partial saves where they already do today
- No URL routing for sections (app remains `useState` views)

## Acceptance

- [ ] Left nav (desktop) / chips (mobile) switch sections without losing unsaved form edits
- [ ] All existing fields still present and save correctly
- [ ] LLM block visually matches other section cards
- [ ] Sticky Save visible while scrolling the content panel
- [ ] Light/dark themes still readable (existing tokens)

## Primary file

- Modify: `frontend/src/components/SettingsPanel.tsx`
- Optional i18n keys for section nav labels / blurbs in `en` / `ar` / `hi` if not reusing existing strings
