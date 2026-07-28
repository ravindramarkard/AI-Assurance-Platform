# AgentBrowser secondary navigation — design

**Date:** 2026-07-27  
**Status:** Approved (Approach A)  
**Scope:** Frontend navigation only — no backend/API changes

## Problem

A2A Console (and Red Team / API Test) use a secondary sidebar with in-page tabs. AgentBrowser features — Agents, Browsers, Scheduled, Analytics — are top-level main-sidebar items with no secondary column. The product should treat AgentBrowser the same way: one main-nav entry, secondary tabs for its sections.

## Goals

- Match A2A Console secondary-sidebar pattern for AgentBrowser
- Collapse Agents / Browsers / Scheduled / Analytics into secondary tabs
- Move **+ New Agent** and **History** into the Agents tab area
- Keep Red Team / A2A / API Test as sibling top-level consoles
- Preserve existing Agents / Browsers / Scheduled / Analytics behavior (no feature regressions)

## Non-goals

- Backend, WebSocket, or settings API changes
- Changing A2A / Red Team / API Test secondary nav
- URL routing (app remains `useState` view switching)
- New AgentBrowser analytics or dashboard content beyond relocating existing views

## Navigation structure

### Main sidebar (left rail)

| Item | Notes |
|------|--------|
| Brand / collapse | Unchanged |
| **AgentBrowser** | Single active item when any AgentBrowser tab is open |
| Red Team / A2A / API Test | Unchanged; still gated by `consoles.*` |
| Settings | Unchanged |

**Removed from main sidebar:** Agents, Browsers, Scheduled, Analytics, + New Agent CTA, History session list.

### AgentBrowser secondary sidebar

Same chrome as A2A (`w-52` aside, title + blurb, tab buttons):

| Tab id | Label | Default |
|--------|-------|---------|
| `agents` | Agents | Yes (default) |
| `browsers` | Browsers | |
| `scheduled` | Scheduled | Badge = job count when > 0 |
| `analytics` | Analytics | |

Active tab accent: brand orange (`bu-*`) so AgentBrowser is visually distinct from A2A’s sky blue.

## Layout & components

### New: `AgentBrowserPage.tsx`

Modeled on `A2AConsolePage.tsx`:

- Outer `main`: `flex-1 min-w-0 bg-ink-950 flex min-h-0`
- Left `aside`: `w-52 flex-shrink-0 border-r border-line bg-ink-900`
- Header: title "AgentBrowser" + short blurb
- Nav buttons for the four tabs
- Right content pane: `flex-1 overflow-y-auto` (or full-bleed workspace for Agents chat)

### Tab → existing UI

| Tab | Content |
|-----|---------|
| Agents | See **Agents tab layout** below |
| Browsers | Current `BrowsersView` (extracted from `App.tsx` if helpful) |
| Scheduled | `ScheduledJobsPage` |
| Analytics | Current `AnalyticsView` (extracted from `App.tsx` if helpful) |

### Agents tab layout

Inside the Agents content pane (to the right of the AgentBrowser secondary nav), use a **two-column layout**:

1. **Agents rail** (narrow, ~same width as today's History block): **+ New Agent** at top, then searchable History list (open / delete / clear — same handlers as today's sidebar History).
2. **Workspace**: sessions table when no session selected; `AgentPage` for create; `ChatPanel` + `RightPanel` when a session is active.

Brand click / "home": set `view = 'agentbrowser'`, `agentBrowserTab = 'agents'`, clear `activeId`, and show the New Agent / create flow (same as today's `goHome()` intent).

### `App.tsx` changes

- Introduce view `agentbrowser` (replaces treating `sessions` / `agent` / `browsers` / `scheduled` / `analytics` as peer top-level views for sidebar purposes)
- Track `agentBrowserTab`: `'agents' | 'browsers' | 'scheduled' | 'analytics'`
- Keep existing session state (`activeId`, load/create/control) and pass into Agents tab
- Clicking AgentBrowser opens the shell on last-used tab, or Agents if none
- Opening a session from History keeps `agentBrowserTab === 'agents'` and loads the session as today

### `Sidebar.tsx` changes

- One AgentBrowser nav entry; `active` when `view === 'agentbrowser'`
- Remove Agents / Browsers / Scheduled / Analytics entries, New Agent button, and History list from the main rail
- Collapsed icon rail: one AgentBrowser icon for the group

### i18n

- Add keys for AgentBrowser title, blurb, and any new labels
- Reuse existing `navAgents` / `navBrowsers` / `navScheduled` / `navAnalytics` / `newAgent` where they fit

## Behavior / edge cases

1. **Default tab:** Agents when first opening AgentBrowser (or after cold start).
2. **Tab persistence:** Remember last AgentBrowser tab for the session (in-memory state is enough; no localStorage requirement).
3. **Active chat:** Secondary sidebar remains visible while in Agents chat/create; Agents tab stays highlighted.
4. **History search/delete/clear:** Same behavior as today's sidebar History, relocated into Agents tab UI.
5. **Scheduled badge:** Show job count on the Scheduled secondary tab (secondary tab badge is required; main AgentBrowser badge is optional).
6. **Consoles flags:** Unrelated; AgentBrowser is always available (not behind a console toggle).
7. **Collapsed main sidebar:** AgentBrowser remains reachable via icon; secondary column still appears in the main content area when AgentBrowser is selected.

## Architecture sketch

```
Sidebar (main)
  └─ AgentBrowser ──► view = 'agentbrowser'
                          │
App                     AgentBrowserPage
                          ├─ secondary nav (tab state)
                          ├─ agents  → New Agent + History + AgentSessions/AgentPage/Chat
                          ├─ browsers → BrowsersView
                          ├─ scheduled → ScheduledJobsPage
                          └─ analytics → AnalyticsView
```

## Testing

Manual checks:

- [ ] Main sidebar shows AgentBrowser only (not four separate items); no New Agent / History on main rail
- [ ] Secondary tabs switch Agents / Browsers / Scheduled / Analytics content
- [ ] New Agent creates a session from Agents tab
- [ ] History open / delete / clear / search work from Agents tab
- [ ] Opening a session shows chat; secondary nav still visible; Agents active
- [ ] Scheduled badge updates with job count
- [ ] A2A / Red Team / API Test secondary sidebars unchanged
- [ ] Collapsed main rail still opens AgentBrowser

## Approach decision

**Approach A (chosen):** Single `AgentBrowserPage` shell owns secondary chrome; content is existing pages relocated under tabs.

Rejected: B (split wiring across App/Sidebar), C (inline expand in main sidebar without secondary column).
