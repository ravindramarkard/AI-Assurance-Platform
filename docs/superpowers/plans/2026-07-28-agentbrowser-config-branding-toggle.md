# AgentBrowser Configuration, Branding & Console Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Application URL / Concurrency / Browser / Headless into AgentBrowser → Configuration; rename sidebar brand + nav to AI Assurance Platform and strip top-left header brand; add AgentBrowser enable/disable under Assurance consoles (Off → Settings).

**Architecture:** Frontend-only. Configuration reuses `GET`/`PUT /api/settings` with the same keys. Console toggle extends `ConsoleFeatures` + localStorage like A2A/Red Team/API Test. Branding is i18n + JSX chrome.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind (`frontend/`). Verify with `cd frontend && npx tsc -b --noEmit` and manual UI checks.

**Specs:**
- `docs/superpowers/specs/2026-07-28-agentbrowser-configuration-design.md`
- `docs/superpowers/specs/2026-07-28-sidebar-branding-design.md`
- `docs/superpowers/specs/2026-07-28-agentbrowser-console-toggle-design.md`

## Global Constraints

- Frontend only — no new backend endpoints or settings keys
- Configuration save must use existing `api.updateSettings` with same field semantics
- Settings save must **not** send blank defaults that wipe moved fields
- Keycloak stays in Settings
- Console toggle default On; Off → Settings
- Secondary AgentBrowser aside title may remain “AgentBrowser”
- Prefer cut/paste of Settings markup over rewriting browser-runtime behavior

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | `navAgentBrowser` → AI Assurance Platform; `navConfiguration` / config page keys |
| `frontend/src/preferences.tsx` | `consoles.agentbrowser` + localStorage key |
| `frontend/src/components/AgentBrowserConfiguration.tsx` | **Create** — moved runtime settings form |
| `frontend/src/components/AgentBrowserPage.tsx` | Add `configuration` tab; pass settings/onSaved |
| `frontend/src/components/SettingsPanel.tsx` | Remove moved sections; stop saving those keys; add console toggle row |
| `frontend/src/components/Sidebar.tsx` | Brand = `t('brand')`; gate AgentBrowser nav on `consoles.agentbrowser` |
| `frontend/src/App.tsx` | Strip top-left brand; wire Configuration props; fallback when AgentBrowser off |

---

### Task 1: i18n for Configuration + branding label

**Files:**
- Modify: `frontend/src/i18n/locales/en.ts`, `ar.ts`, `hi.ts`

**Interfaces:**
- Produces: `navConfiguration`, `agentBrowserConfiguration` (page title); update `navAgentBrowser` to platform name

- [ ] **Step 1: Update English**

In `en.ts`:
```ts
  navAgentBrowser: 'AI Assurance Platform',
  navConfiguration: 'Configuration',
  agentBrowserConfiguration: 'Configuration',
  agentBrowserConfigurationBlurb: 'Application URL, concurrency, and browser runtime.',
```
Keep `brand: 'AI Assurance Platform'`. Keep `agentBrowserConsole: 'AgentBrowser'` for secondary aside title.

- [ ] **Step 2: Mirror keys in `ar.ts` and `hi.ts`**

Same key names. `navAgentBrowser` may stay English product name or use a local translation of the platform name; `navConfiguration` / blurbs translated.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "Add i18n for Configuration tab and platform nav label."
```

---

### Task 2: AgentBrowser console toggle in preferences + Settings UI

**Files:**
- Modify: `frontend/src/preferences.tsx`
- Modify: `frontend/src/components/SettingsPanel.tsx` (toggle row only in this task)

**Interfaces:**
```ts
export type ConsoleFeatures = {
  agentbrowser: boolean
  a2a: boolean
  redteam: boolean
  apitest: boolean
}
```

- [ ] **Step 1: Extend preferences**

Add:
```ts
const CONSOLE_AGENTBROWSER_KEY = 'aip_console_agentbrowser'
```

Update `ConsoleFeatures`, `readStoredConsoles` (default `agentbrowser: true`), initial state, and persist `useEffect` to include `agentbrowser`.

- [ ] **Step 2: Add Settings toggle row**

In Assurance consoles list, prepend:
```ts
{ id: 'agentbrowser' as const, label: t('navAgentBrowser'), blurb: t('agentBrowserBlurb') },
```
before a2a/redteam/apitest. Same checkbox/`setConsoleEnabled` pattern.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/preferences.tsx frontend/src/components/SettingsPanel.tsx
git commit -m "Add AgentBrowser toggle to Assurance consoles preferences."
```

---

### Task 3: Gate Sidebar + App fallback when AgentBrowser is Off

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `consoles.agentbrowser`

- [ ] **Step 1: Sidebar — gate AgentBrowser nav**

Wrap the AgentBrowser nav entry like other consoles:
```ts
...(consoles.agentbrowser
  ? [{ id: 'agentbrowser' as const, label: t('navAgentBrowser'), ... }]
  : []),
```

- [ ] **Step 2: App — disable fallbacks**

Replace/extend the console `useEffect`:
```ts
useEffect(() => {
  if (view === 'agentbrowser' && !consoles.agentbrowser) setView('settings')
  else if (view === 'a2a' && !consoles.a2a) {
    setView(consoles.agentbrowser ? 'agentbrowser' : 'settings')
  } else if (view === 'redteam' && !consoles.redteam) {
    setView(consoles.agentbrowser ? 'agentbrowser' : 'settings')
  } else if (view === 'apitest' && !consoles.apitest) {
    setView(consoles.agentbrowser ? 'agentbrowser' : 'settings')
  }
}, [view, consoles])
```

If cold start uses `view === 'agentbrowser'` and stored toggle is Off, this effect must send user to Settings.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "Hide AgentBrowser nav when console toggle is off."
```

---

### Task 4: Sidebar branding + strip top-left header brand

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Sidebar brand uses platform name**

In expanded sidebar brand row:
```tsx
<span className="font-semibold text-[14px] text-slate-100 truncate flex-1 min-w-0">
  {t('brand')}
</span>
```
(Nav label already uses `navAgentBrowser` from Task 1.)

- [ ] **Step 2: Remove top-left brand block in App**

In the header, remove the left brand button + `/` + `local`. Keep optional session crumb without the platform name, e.g.:
```tsx
<header className="h-12 ... justify-between ...">
  <div className="flex items-center gap-3 min-w-0">
    {activeId && showWorkspace ? (
      <>
        <span className="text-slate-400">session</span>
        <span className="text-slate-600">/</span>
        <span className="mono text-xs text-slate-300">{activeId.slice(0, 8)}…</span>
      </>
    ) : (
      <span className="text-slate-500">{t('local')}</span>
    )}
  </div>
  <div className="flex items-center gap-2 ...">
    {/* theme / language / status — unchanged */}
  </div>
</header>
```
Do **not** leave a dead `goHome` brand click; home remains via Agents → New Agent.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "Show platform brand in sidebar; remove top-left header brand."
```

---

### Task 5: Create AgentBrowserConfiguration (cut from Settings)

**Files:**
- Create: `frontend/src/components/AgentBrowserConfiguration.tsx`
- Modify: `frontend/src/components/SettingsPanel.tsx` (remove moved UI + save keys)

**Interfaces:**
```ts
export type AgentBrowserConfigurationProps = {
  settings: AppSettings | null
  onSaved: (s: AppSettings) => void
}
export default function AgentBrowserConfiguration(props: AgentBrowserConfigurationProps): JSX.Element
```

- [ ] **Step 1: Create `AgentBrowserConfiguration.tsx`**

Cut/paste from SettingsPanel:
- Form fields: `application_url`, `max_concurrent_agents`, `browser_engine`, `browser_executable`, `headless`
- `engines` list + `engineStatus` using `settings?.detected_browsers`
- Application URL / Concurrency / Browser section markup (labels, help text)
- Local form state synced from `settings` via `useEffect`
- `save()` calls `api.updateSettings` with **only**:
```ts
{
  application_url: form.application_url.trim(),
  max_concurrent_agents: Math.max(1, Math.min(8, Number(form.max_concurrent_agents) || 2)),
  browser_engine: form.browser_engine,
  browser_executable: form.browser_executable.trim(),
  headless: form.headless,
}
```
Then `onSaved(s)` and success message.

Page chrome:
```tsx
<main className="flex-1 overflow-y-auto scroll p-6 min-w-0 bg-ink-950">
  <header className="mb-5 max-w-2xl">
    <h1 className="text-[22px] font-semibold text-slate-100">{t('agentBrowserConfiguration')}</h1>
    <p className="text-[13px] text-slate-500 mt-0.5">{t('agentBrowserConfigurationBlurb')}</p>
  </header>
  {/* sections + Save button */}
</main>
```

- [ ] **Step 2: Strip SettingsPanel moved UI and save keys**

Remove from SettingsPanel:
- JSX sections for Application URL, Concurrency, Browser (engine/executable/headless)
- From `FormState` / initial state / settings sync / save `body` / post-save form update: `headless`, `browser_engine`, `browser_executable`, `application_url`, `max_concurrent_agents`
- Remove unused `engines` / `engineStatus` / `BrowserEngine` imports if no longer referenced

Critical: Settings `save()` must not include those keys so it cannot overwrite AgentBrowser Configuration with blanks.

Keep Keycloak section and its Application URL hints that read from `settings.application_url` (prop), not removed form fields.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AgentBrowserConfiguration.tsx frontend/src/components/SettingsPanel.tsx
git commit -m "Move browser runtime settings into AgentBrowserConfiguration."
```

---

### Task 6: Wire Configuration tab into AgentBrowserPage + App

**Files:**
- Modify: `frontend/src/components/AgentBrowserPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
```ts
export type AgentBrowserTab = 'agents' | 'browsers' | 'scheduled' | 'analytics' | 'configuration'
// Add to props:
settings: AppSettings | null  // already present
onSettingsSaved: (s: AppSettings) => void
```

- [ ] **Step 1: Extend AgentBrowserPage**

- Add `'configuration'` to `AgentBrowserTab`
- Nav item with IconConfig (copy from A2AConsolePage or simple gear SVG), label `t('navConfiguration')`
- Import and render:
```tsx
{tab === 'configuration' && (
  <AgentBrowserConfiguration settings={settings} onSaved={onSettingsSaved} />
)}
```
- Add `onSettingsSaved` to props (settings already passed)

- [ ] **Step 2: App passes onSettingsSaved**

```tsx
<AgentBrowserPage
  ...
  settings={settings}
  onSettingsSaved={(s) => setSettings(s)}
/>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 4: Manual checklist**

1. Configuration tab visible; Settings no longer shows moved sections  
2. Save Application URL / concurrency / engine / headless → values persist after refresh; agents behave as before  
3. Settings save does not clear those values  
4. Sidebar brand + nav = AI Assurance Platform; top-left brand gone  
5. Assurance consoles AgentBrowser toggle Off hides nav and sends to Settings  

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AgentBrowserPage.tsx frontend/src/App.tsx
git commit -m "Wire AgentBrowser Configuration tab into secondary nav."
```

---

## Spec coverage

| Requirement | Task |
|-------------|------|
| Configuration tab + moved fields | 5, 6 |
| Same settings API / as-is behavior | 5 |
| Settings no longer edits/wipes moved fields | 5 |
| Keycloak stays in Settings | 5 |
| Brand sidebar + nav rename | 1, 4 |
| Remove top-left header brand | 4 |
| Console toggle + localStorage | 2 |
| Hide nav + Off → Settings | 3 |

## Placeholder / consistency check

- Types: `ConsoleFeatures.agentbrowser`, `AgentBrowserTab` includes `configuration`
- Settings save body must omit moved keys after Task 5
- Nav label uses `navAgentBrowser` (= platform name); secondary console title keeps `agentBrowserConsole`
