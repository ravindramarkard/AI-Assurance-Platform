# AgentBrowser Secondary Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AgentBrowser the same secondary-sidebar pattern as A2A Console — one main-nav item with Agents / Browsers / Scheduled / Analytics tabs, and move New Agent + History into the Agents tab.

**Architecture:** Introduce `view = 'agentbrowser'` and `agentBrowserTab` in `App.tsx`. New `AgentBrowserPage` owns the A2A-style `w-52` secondary aside (brand-orange active state). Extract `AgentsHistoryRail`, `BrowsersView`, and `AnalyticsView` into focused components. Slim `Sidebar` to AgentBrowser + consoles + Settings only.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind (existing `frontend/`), no new dependencies. Verification via `npx tsc -b --noEmit` and manual UI checks (no frontend unit-test runner in repo).

**Spec:** `docs/superpowers/specs/2026-07-27-agentbrowser-secondary-nav-design.md`

## Global Constraints

- Frontend navigation only — no backend/API changes
- Do not change A2A / Red Team / API Test secondary nav behavior or accents
- No URL routing — keep `useState` view switching
- Secondary active accent for AgentBrowser: brand orange (`bu-*`), not A2A sky
- AgentBrowser is always available (not behind `consoles.*`)
- Preserve existing session create / list / chat / History search-delete-clear behavior
- Prefer extracting existing markup over rewriting features

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/i18n/locales/en.ts` (+ `ar.ts`, `hi.ts`) | Add `navAgentBrowser`, `agentBrowserConsole`, `agentBrowserBlurb` |
| `frontend/src/components/AgentsHistoryRail.tsx` | **Create** — New Agent CTA + searchable History (moved from Sidebar) |
| `frontend/src/components/BrowsersView.tsx` | **Create** — extract from `App.tsx` |
| `frontend/src/components/AnalyticsView.tsx` | **Create** — extract from `App.tsx` |
| `frontend/src/components/AgentBrowserPage.tsx` | **Create** — secondary aside + tab content shell |
| `frontend/src/components/Sidebar.tsx` | Slim to AgentBrowser + consoles + Settings; drop Agents/Browsers/Scheduled/Analytics/New Agent/History |
| `frontend/src/App.tsx` | `agentbrowser` view + `agentBrowserTab` + `agentsPane`; wire shell and Agents workspace |

---

### Task 1: i18n keys for AgentBrowser console

**Files:**
- Modify: `frontend/src/i18n/locales/en.ts`
- Modify: `frontend/src/i18n/locales/ar.ts`
- Modify: `frontend/src/i18n/locales/hi.ts`

**Interfaces:**
- Consumes: existing `MessageKey = keyof typeof en`
- Produces: keys `navAgentBrowser`, `agentBrowserConsole`, `agentBrowserBlurb` (reuse `navAgents` / `navBrowsers` / `navScheduled` / `navAnalytics` / `newAgent` / `history` for tab/rail labels)

- [ ] **Step 1: Add English keys**

In `en.ts`, after `brandShort: 'AgentBrowser',` add:

```ts
  navAgentBrowser: 'AgentBrowser',
  agentBrowserConsole: 'AgentBrowser',
  agentBrowserBlurb: 'Browser agents & workspace',
```

(`agentBrowser` already exists — keep it; these are the nav/console labels.)

- [ ] **Step 2: Add Arabic keys**

In `ar.ts`, add the same three keys (Arabic or English brand is fine for product name):

```ts
  navAgentBrowser: 'AgentBrowser',
  agentBrowserConsole: 'AgentBrowser',
  agentBrowserBlurb: 'وكلاء المتصفح ومساحة العمل',
```

- [ ] **Step 3: Add Hindi keys**

In `hi.ts`:

```ts
  navAgentBrowser: 'AgentBrowser',
  agentBrowserConsole: 'AgentBrowser',
  agentBrowserBlurb: 'ब्राउज़र एजेंट और वर्कस्पेस',
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS (no errors from new keys; `MessageKey` picks them up from `en`)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "Add i18n keys for AgentBrowser secondary nav."
```

---

### Task 2: Extract AgentsHistoryRail

**Files:**
- Create: `frontend/src/components/AgentsHistoryRail.tsx`
- Test: manual + `tsc` (no unit runner)

**Interfaces:**
- Consumes: `Session` from `../api`; `usePreferences`
- Produces:

```ts
export type AgentsHistoryRailProps = {
  sessions: Session[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClearHistory: () => void
  /** Optional width; default 240 */
  width?: number
}
export default function AgentsHistoryRail(props: AgentsHistoryRailProps): JSX.Element
```

- [ ] **Step 1: Create `AgentsHistoryRail.tsx`**

Move the New Agent button, History header/clear, search input, and session list markup from `Sidebar.tsx` (expanded sidebar section ~lines 365–480) into this component. Keep `statusDot`, `IconSearch` locally (copy small helpers). Structure:

```tsx
import { useMemo, useState } from 'react'
import type { Session } from '../api'
import { usePreferences } from '../preferences'

export type AgentsHistoryRailProps = {
  sessions: Session[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClearHistory: () => void
  width?: number
}

function statusDot(status: string) {
  if (status === 'running' || status === 'thinking') return 'bg-green-400'
  if (status === 'queued') return 'bg-amber-400'
  if (status === 'failed') return 'bg-red-400'
  if (status === 'paused') return 'bg-yellow-400'
  return 'bg-slate-600'
}

function IconSearch({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

export default function AgentsHistoryRail({
  sessions,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onClearHistory,
  width = 240,
}: AgentsHistoryRailProps) {
  const { t } = usePreferences()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => {
      const hay = `${s.title || ''} ${s.task || ''} ${s.id} ${s.status || ''} ${s.model || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [sessions, query])

  return (
    <aside
      className="bg-ink-900 border-r border-line flex flex-col text-base flex-shrink-0 min-w-0 min-h-0"
      style={{ width }}
    >
      <div className="p-3 flex-shrink-0">
        <button
          type="button"
          onClick={onNew}
          className="w-full accent-fill accent-shadow text-[14px] font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2"
        >
          <span className="text-base leading-none">+</span>
          <span>{t('newAgent')}</span>
        </button>
      </div>

      <div className="px-3 mt-1 mb-1.5 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="type-label text-slate-500">{t('history')}</div>
        {sessions.length > 0 && (
          <button
            type="button"
            title={t('clearAll')}
            onClick={() => {
              if (window.confirm(`Delete all ${sessions.length} sessions? This cannot be undone.`)) {
                onClearHistory()
              }
            }}
            className="text-[11px] text-slate-500 hover:text-red-400"
          >
            {t('clearAll')}
          </button>
        )}
      </div>

      <div className="px-2 mb-2 flex-shrink-0">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
            <IconSearch />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchHistory')}
            className="w-full bg-ink-800 border border-line rounded-lg pl-8 pr-2.5 py-1.5 text-[13px] text-slate-200 placeholder-slate-500 outline-none focus:border-bu-500/50"
            aria-label={t('searchHistory')}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll px-2 space-y-0.5 text-[13px] pb-2">
        {sessions.length === 0 && (
          <div className="px-2.5 py-2 text-slate-500 text-[13px]">{t('noSessions')}</div>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <div className="px-2.5 py-2 text-slate-500 text-[13px]">{t('noSearchResults')}</div>
        )}
        {filtered.map((s) => (
          <div
            key={s.id}
            className={`group relative flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-ink-800 ${
              activeId === s.id ? 'active-nav bg-bu-500/10' : ''
            }`}
            onClick={() => onSelect(s.id)}
            title={s.title}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(s.status)}`} />
            <span
              className={`flex-1 truncate min-w-0 text-[13px] ${
                activeId === s.id ? 'text-slate-100 font-medium' : 'text-slate-400 font-normal'
              }`}
            >
              {s.title}
            </span>
            <button
              type="button"
              title="Delete session"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-red-400 px-1 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`Delete "${s.title.slice(0, 60)}"?`)) {
                  onDelete(s.id)
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AgentsHistoryRail.tsx
git commit -m "Extract AgentsHistoryRail for AgentBrowser Agents tab."
```

---

### Task 3: Extract BrowsersView and AnalyticsView

**Files:**
- Create: `frontend/src/components/BrowsersView.tsx`
- Create: `frontend/src/components/AnalyticsView.tsx`
- Modify: `frontend/src/App.tsx` (temporarily re-export/import so App still compiles; full rewire in Task 5–6)

**Interfaces:**
- Produces:

```ts
// BrowsersView.tsx
export default function BrowsersView(): JSX.Element

// AnalyticsView.tsx
export default function AnalyticsView({ sessions }: { sessions: Session[] }): JSX.Element
```

- [ ] **Step 1: Create `BrowsersView.tsx`**

Move `BrowsersView` from bottom of `App.tsx` (~lines 639–672) unchanged into its own file. Add imports:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api'
import { usePreferences } from '../preferences'

export default function BrowsersView() {
  // ... existing body from App.tsx
}
```

- [ ] **Step 2: Create `AnalyticsView.tsx`**

Move `AnalyticsView` from `App.tsx` (~lines 674–701):

```tsx
import type { Session } from '../api'
import { usePreferences } from '../preferences'

export default function AnalyticsView({ sessions }: { sessions: Session[] }) {
  // ... existing body from App.tsx
}
```

- [ ] **Step 3: Update App.tsx imports; delete local functions**

At top of `App.tsx`:

```tsx
import BrowsersView from './components/BrowsersView'
import AnalyticsView from './components/AnalyticsView'
```

Delete the local `function BrowsersView` and `function AnalyticsView` at the bottom of `App.tsx`. Keep existing JSX usages (`<BrowsersView />`, `<AnalyticsView sessions={sessions} />`) so behavior is unchanged until Task 6.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BrowsersView.tsx frontend/src/components/AnalyticsView.tsx frontend/src/App.tsx
git commit -m "Extract BrowsersView and AnalyticsView from App."
```

---

### Task 4: Create AgentBrowserPage shell

**Files:**
- Create: `frontend/src/components/AgentBrowserPage.tsx`

**Interfaces:**
- Consumes: `AgentsHistoryRail`, `BrowsersView`, `AnalyticsView`, `ScheduledJobsPage`
- Produces:

```ts
export type AgentBrowserTab = 'agents' | 'browsers' | 'scheduled' | 'analytics'

export type AgentBrowserPageProps = {
  tab: AgentBrowserTab
  onTabChange: (tab: AgentBrowserTab) => void
  scheduledCount: number
  /** Agents tab: history rail props */
  sessions: Session[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClearHistory: () => void
  /** Agents workspace (list / create / chat) — rendered beside the history rail */
  agentsWorkspace: React.ReactNode
  /** Scheduled tab extras */
  settings: AppSettings | null
  onOpenSession: (id: string) => void
}

export default function AgentBrowserPage(props: AgentBrowserPageProps): JSX.Element
```

- [ ] **Step 1: Implement `AgentBrowserPage.tsx`**

Model aside markup on `A2AConsolePage.tsx` (secondary column), but use **orange** active styles:

```tsx
import { type ReactNode } from 'react'
import type { AppSettings, Session } from '../api'
import { usePreferences } from '../preferences'
import AgentsHistoryRail from './AgentsHistoryRail'
import BrowsersView from './BrowsersView'
import AnalyticsView from './AnalyticsView'
import ScheduledJobsPage from './ScheduledJobsPage'

export type AgentBrowserTab = 'agents' | 'browsers' | 'scheduled' | 'analytics'

export type AgentBrowserPageProps = {
  tab: AgentBrowserTab
  onTabChange: (tab: AgentBrowserTab) => void
  scheduledCount: number
  sessions: Session[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClearHistory: () => void
  agentsWorkspace: ReactNode
  settings: AppSettings | null
  onOpenSession: (id: string) => void
}

// Copy small icon SVGs for Agents / Browsers / Scheduled / Analytics from Sidebar.tsx
// (IconAgents, IconBrowsers, IconScheduled, IconAnalytics) — keep local to this file.

export default function AgentBrowserPage({
  tab,
  onTabChange,
  scheduledCount,
  sessions,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onClearHistory,
  agentsWorkspace,
  settings,
  onOpenSession,
}: AgentBrowserPageProps) {
  const { t } = usePreferences()

  const nav: { id: AgentBrowserTab; label: string; icon: ReactNode; badge?: string | null }[] = [
    { id: 'agents', label: t('navAgents'), icon: <IconAgents /> },
    { id: 'browsers', label: t('navBrowsers'), icon: <IconBrowsers /> },
    {
      id: 'scheduled',
      label: t('navScheduled'),
      icon: <IconScheduled />,
      badge: scheduledCount > 0 ? String(scheduledCount) : null,
    },
    { id: 'analytics', label: t('navAnalytics'), icon: <IconAnalytics /> },
  ]

  return (
    <main className="flex-1 min-w-0 bg-ink-950 flex min-h-0">
      <aside className="w-52 flex-shrink-0 border-r border-line bg-ink-900 flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <div className="text-[15px] font-semibold text-slate-100 tracking-tight">
            {t('agentBrowserConsole')}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{t('agentBrowserBlurb')}</div>
        </div>
        <nav className="p-2 space-y-0.5 text-[13px]">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                tab === item.id
                  ? 'bg-bu-500/15 text-bu-300 border border-bu-500/30'
                  : 'text-slate-300 hover:bg-ink-800 border border-transparent'
              }`}
            >
              <span className={tab === item.id ? 'text-bu-300' : 'text-slate-500'}>{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge != null && (
                <span className="text-[11px] text-slate-500 tabular-nums">{item.badge}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {tab === 'agents' && (
          <div className="flex flex-1 min-h-0 min-w-0">
            <AgentsHistoryRail
              sessions={sessions}
              activeId={activeId}
              onNew={onNew}
              onSelect={onSelect}
              onDelete={onDelete}
              onClearHistory={onClearHistory}
            />
            <div className="flex-1 min-w-0 min-h-0 flex">{agentsWorkspace}</div>
          </div>
        )}
        {tab === 'browsers' && <BrowsersView />}
        {tab === 'scheduled' && (
          <ScheduledJobsPage
            settings={settings}
            sessions={sessions}
            onOpenSession={onOpenSession}
          />
        )}
        {tab === 'analytics' && <AnalyticsView sessions={sessions} />}
      </div>
    </main>
  )
}
```

Include the four icon components (copy from `Sidebar.tsx`).

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AgentBrowserPage.tsx
git commit -m "Add AgentBrowserPage secondary sidebar shell."
```

---

### Task 5: Slim Sidebar to AgentBrowser + consoles + Settings

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: updated `SidebarView`
- Produces:

```ts
export type SidebarView =
  | 'agentbrowser'
  | 'a2a'
  | 'redteam'
  | 'apitest'
  | 'settings'

type Props = {
  view: SidebarView
  onView: (v: SidebarView) => void
  collapsed: boolean
  onToggleCollapse: () => void
  width?: number
  /** Optional: unused after History move — remove sessions/activeId/onSelect/onNew/onDelete/onClearHistory/scheduledCount */
}
```

- [ ] **Step 1: Replace `SidebarView` and Props**

Change the exported type and props to:

```ts
export type SidebarView = 'agentbrowser' | 'a2a' | 'redteam' | 'apitest' | 'settings'

type Props = {
  view: SidebarView
  onView: (v: SidebarView) => void
  collapsed: boolean
  onToggleCollapse: () => void
  width?: number
}
```

Remove unused props: `sessions`, `activeId`, `onSelect`, `onNew`, `onDelete`, `onClearHistory`, `scheduledCount`.

- [ ] **Step 2: Replace `nav` array**

```ts
  const nav: {
    id: SidebarView
    label: string
    title: string
    icon: ReactNode
    onClick: () => void
    active: boolean
  }[] = [
    {
      id: 'agentbrowser',
      label: t('navAgentBrowser'),
      title: t('agentBrowserConsole'),
      icon: <IconAgents />,
      onClick: () => onView('agentbrowser'),
      active: view === 'agentbrowser',
    },
    ...(consoles.a2a
      ? [
          {
            id: 'a2a' as const,
            label: t('navA2A'),
            title: t('a2aConsole'),
            icon: <IconA2A />,
            onClick: () => onView('a2a'),
            active: view === 'a2a',
          },
        ]
      : []),
    // same for redteam / apitest as today
  ]
```

- [ ] **Step 3: Remove New Agent, History UI, and related state**

- Delete `useState` for `query` / `historyFocus` and `filtered` memo
- Collapsed rail: remove `+` New Agent button and History icon button; keep brand, nav icons, Settings
- Expanded: remove New Agent button block and entire History section (header, search, list)
- Keep brand header, nav, Settings, local-user footer
- Remove unused icons if any (`IconSearch`, `IconHistory`, `IconBrowsers`, `IconScheduled`, `IconAnalytics` if unused — keep `IconAgents` for AgentBrowser entry)

- [ ] **Step 4: Typecheck (expect App.tsx errors until Task 6)**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: FAIL on `App.tsx` prop mismatches for `Sidebar` — that is OK; fix in Task 6. If Sidebar itself has no errors, proceed.

Alternatively complete Task 5+6 in one sitting if preferred, but commit Sidebar changes only after App still typechecks (prefer finishing Task 6 before commit, or commit both together).

**Preferred:** Do not commit until Task 6 restores a green `tsc`. Continue immediately to Task 6.

---

### Task 6: Rewire App.tsx to AgentBrowserPage

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `AgentBrowserPage`, `AgentBrowserTab`, slim `Sidebar` / `SidebarView`
- Produces: working app with `view: 'agentbrowser' | 'a2a' | 'redteam' | 'apitest' | 'settings'` and `agentBrowserTab` + `agentsPane`

- [ ] **Step 1: Replace View types and state**

```ts
import AgentBrowserPage, { type AgentBrowserTab } from './components/AgentBrowserPage'
import Sidebar, { type SidebarView } from './components/Sidebar'
// remove direct ScheduledJobsPage / BrowsersView / AnalyticsView from main switch if only used inside AgentBrowserPage
// keep ScheduledJobsPage import only if still needed elsewhere — otherwise drop

type View = 'agentbrowser' | 'a2a' | 'redteam' | 'apitest' | 'settings'
type AgentsPane = 'create' | 'list'

const [view, setView] = useState<View>('agentbrowser')
const [agentBrowserTab, setAgentBrowserTab] = useState<AgentBrowserTab>('agents')
const [agentsPane, setAgentsPane] = useState<AgentsPane>('create')
```

- [ ] **Step 2: Update helpers**

```ts
  useEffect(() => {
    if (view === 'a2a' && !consoles.a2a) setView('agentbrowser')
    else if (view === 'redteam' && !consoles.redteam) setView('agentbrowser')
    else if (view === 'apitest' && !consoles.apitest) setView('agentbrowser')
  }, [view, consoles])

  const goHome = useCallback(() => {
    setActiveId(null)
    setSession(null)
    setMessages([])
    setEvents([])
    setOpenFilePath(null)
    setRightTab('browser')
    setView('agentbrowser')
    setAgentBrowserTab('agents')
    setAgentsPane('create')
  }, [])

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id)
    setView('agentbrowser')
    setAgentBrowserTab('agents')
    setAgentsPane('list')
    setOpenFilePath(null)
    setRightTab('browser')
    const [s, msgs, evs] = await Promise.all([
      api.getSession(id),
      api.getMessages(id),
      api.getEvents(id),
    ])
    setSession(s)
    setMessages(msgs)
    setEvents(evs)
  }, [])

  const openAgentsList = useCallback(() => {
    setActiveId(null)
    setSession(null)
    setMessages([])
    setEvents([])
    setOpenFilePath(null)
    setView('agentbrowser')
    setAgentBrowserTab('agents')
    setAgentsPane('list')
  }, [])
```

Update `showWorkspace` / `showSessionsList`:

```ts
  const inAgentBrowser = view === 'agentbrowser'
  const showWorkspace = inAgentBrowser && agentBrowserTab === 'agents' && !!activeId
  const showSessionsList =
    inAgentBrowser && agentBrowserTab === 'agents' && !activeId && agentsPane === 'list'
  const showCreate =
    inAgentBrowser && agentBrowserTab === 'agents' && !activeId && agentsPane === 'create'
```

- [ ] **Step 3: Build `agentsWorkspace` node**

Reuse existing ChatPanel / RightPanel / AgentSessionsPage / AgentPage JSX. Wrap in a variable or inline when rendering `AgentBrowserPage`:

```tsx
  const agentsWorkspace = showSessionsList ? (
    <AgentSessionsPage
      sessions={sessions}
      onOpenSession={(id) => { void loadSession(id) }}
      onCreateSession={goHome}
      onRefresh={() => { void refreshSessions() }}
      onDelete={onDeleteSession}
    />
  ) : showWorkspace ? (
    <>
      <ChatPanel
        ...existing props...
        onOpenScheduled={() => {
          setView('agentbrowser')
          setAgentBrowserTab('scheduled')
        }}
      />
      {/* RightPanel / hidden strip — same as today */}
    </>
  ) : showCreate ? (
    <AgentPage
      settings={settings}
      onCreate={onCreate}
      onOpenSettings={() => setView('settings')}
    />
  ) : null
```

Ensure `onCreate` still refreshes sessions and calls `loadSession` / stays consistent with current create flow.

- [ ] **Step 4: Replace Sidebar + main content switch**

```tsx
        <Sidebar
          view={view}
          onView={(v) => {
            if (v === 'agentbrowser') {
              setView('agentbrowser')
              // keep last agentBrowserTab (in-memory persistence)
              return
            }
            setView(v)
          }}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          width={sidebarWidth}
        />
```

Main content:

```tsx
        {view === 'settings' ? (
          <SettingsPanel settings={settings} onSaved={(s) => setSettings(s)} />
        ) : view === 'a2a' ? (
          <A2AConsolePage ... />
        ) : view === 'redteam' ? (
          <RedTeamConsolePage ... />
        ) : view === 'apitest' ? (
          <ApiTestConsolePage sessions={sessions} />
        ) : (
          <AgentBrowserPage
            tab={agentBrowserTab}
            onTabChange={(tab) => {
              setAgentBrowserTab(tab)
              if (tab === 'agents' && !activeId) {
                // Prefer list when returning to Agents without an active session
                setAgentsPane((p) => p)
              }
            }}
            scheduledCount={scheduledCount}
            sessions={sessions}
            activeId={showWorkspace ? activeId : null}
            onNew={goHome}
            onSelect={(id) => { void loadSession(id) }}
            onDelete={onDeleteSession}
            onClearHistory={onClearHistory}
            agentsWorkspace={agentsWorkspace}
            settings={settings}
            onOpenSession={(id) => { void loadSession(id) }}
          />
        )}
```

When user clicks the **Agents** secondary tab explicitly, if you want list (not create) when no session:

```tsx
            onTabChange={(tab) => {
              setAgentBrowserTab(tab)
              if (tab === 'agents' && !activeId) setAgentsPane('list')
            }}
```

And expose list from AgentBrowser main-nav click optionally via `openAgentsList` only when needed — brand/`goHome` stays create.

Remove old branches: `view === 'scheduled' | 'browsers' | 'analytics' | showSessionsList | showWorkspace | AgentPage` at top level.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 6: Manual UI verification**

With `npm run dev` + API running, check:

1. Main sidebar: only AgentBrowser, consoles (if enabled), Settings — no New Agent / History / Agents / Browsers / Scheduled / Analytics
2. AgentBrowser secondary: Agents / Browsers / Scheduled / Analytics; orange active state
3. Agents tab: New Agent + History rail; create / list / chat work
4. History search / delete / clear work
5. Scheduled badge shows when jobs > 0
6. A2A secondary sidebar unchanged (sky accent)
7. Collapsed main rail still opens AgentBrowser

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "Wire AgentBrowser secondary nav and slim main sidebar."
```

---

### Task 7: Final polish and spec checklist

**Files:**
- Possibly touch: `frontend/src/App.tsx`, `frontend/src/components/AgentBrowserPage.tsx`, `frontend/src/components/Sidebar.tsx` if gaps found

- [ ] **Step 1: Walk the spec testing checklist**

From `docs/superpowers/specs/2026-07-27-agentbrowser-secondary-nav-design.md`:

- [ ] Main sidebar shows AgentBrowser only (not four separate items); no New Agent / History on main rail
- [ ] Secondary tabs switch Agents / Browsers / Scheduled / Analytics content
- [ ] New Agent creates a session from Agents tab
- [ ] History open / delete / clear / search work from Agents tab
- [ ] Opening a session shows chat; secondary nav still visible; Agents active
- [ ] Scheduled badge updates with job count
- [ ] A2A / Red Team / API Test secondary sidebars unchanged
- [ ] Collapsed main rail still opens AgentBrowser

- [ ] **Step 2: Fix any gaps found; re-run `tsc`**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 3: Commit if fixes were needed**

```bash
git add -u frontend/src
git commit -m "Polish AgentBrowser secondary navigation."
```

(Skip empty commit if nothing changed.)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Collapse Agents/Browsers/Scheduled/Analytics under AgentBrowser | 4, 5, 6 |
| Secondary aside like A2A with orange accent | 4 |
| Move New Agent + History into Agents area | 2, 4, 6 |
| Agents two-column: rail + workspace | 4, 6 |
| Brand/home → agents create flow | 6 (`goHome`) |
| In-memory last tab | 6 (`agentBrowserTab` state) |
| Secondary nav visible during chat | 4 (shell always shown) |
| Scheduled badge on secondary tab | 4 |
| Slim main sidebar | 5 |
| i18n | 1 |
| No backend changes | all |
| Consoles unchanged | 5, 6 |

## Placeholder / consistency check

- Types aligned: `AgentBrowserTab`, `SidebarView`, `View`, `AgentsPane`
- No TBD/TODO left in steps
- Verification is `tsc` + manual UI (no Vitest in repo — intentional YAGNI)
