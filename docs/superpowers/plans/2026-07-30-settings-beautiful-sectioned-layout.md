# Settings Beautiful Sectioned Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Settings to a polished sectioned layout (left nav / mobile chips, one active panel, sticky Save) without changing settings API behavior.

**Architecture:** UI-only `useState` section switch inside `SettingsPanel.tsx`. One form object; section panels render conditionally; sticky footer Save still PUTs the full payload. Reuse the shell from commit `866b2f2`, keeping current Vision/Temperature fields and applying the polish from the 2026-07-30 spec.

**Tech Stack:** React 19, TypeScript, Tailwind, existing i18n (`en` / `ar` / `hi`).

**Spec:** `docs/superpowers/specs/2026-07-30-settings-beautiful-sectioned-layout-design.md`

## Global Constraints

- Frontend only — no API / settings key changes
- Preserve all existing fields and save/test behavior (including Vision Auto/On/Off + Temperature)
- Use existing `ink-*` / `bu-*` / `border-line` tokens — no new palette
- No URL routing for sections
- No per-section save
- No new frontend test harness (repo has none); gate with `npx tsc -b --noEmit`

---

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/i18n/locales/en.ts` | Add `settingsNavLlm`, `settingsLlmBlurb` (source of `MessageKey`) |
| `frontend/src/i18n/locales/ar.ts` | Arabic strings for those keys |
| `frontend/src/i18n/locales/hi.ts` | Hindi strings for those keys |
| `frontend/src/components/SettingsPanel.tsx` | Section state, nav shell, card chrome, sticky Save, polish |

Reference (do not checkout wholesale — logic has diverged): `git show 866b2f2:frontend/src/components/SettingsPanel.tsx`

---

### Task 1: Restore LLM section i18n keys

**Files:**
- Modify: `frontend/src/i18n/locales/en.ts` (near `consolesSectionHint`)
- Modify: `frontend/src/i18n/locales/ar.ts` (same area)
- Modify: `frontend/src/i18n/locales/hi.ts` (same area)

**Interfaces:**
- Consumes: none
- Produces: `MessageKey` includes `settingsNavLlm` and `settingsLlmBlurb`

- [ ] **Step 1: Add English keys**

In `en.ts`, immediately after `consolesSectionHint`, add:

```ts
  settingsNavLlm: 'Language model',
  settingsLlmBlurb: 'Provider, credentials, vision, and temperature for agent runs.',
```

(Blurb updated vs the old model-picker wording — ModelPicker is gone.)

- [ ] **Step 2: Add Arabic keys**

In `ar.ts`, after `consolesSectionHint`:

```ts
  settingsNavLlm: 'نموذج اللغة',
  settingsLlmBlurb: 'الموفر وبيانات الاعتماد والرؤية ودرجة الحرارة لتشغيل الوكيل.',
```

- [ ] **Step 3: Add Hindi keys**

In `hi.ts`, after `consolesSectionHint`:

```ts
  settingsNavLlm: 'भाषा मॉडल',
  settingsLlmBlurb: 'एजेंट रन के लिए प्रदाता, क्रेडेंशियल, विज़न और तापमान।',
```

- [ ] **Step 4: Verify TypeScript accepts the new keys**

Run:

```bash
cd frontend && npx tsc -b --noEmit
```

Expected: PASS (or only pre-existing errors unrelated to these keys). If `ar`/`hi` miss a key, `Record<MessageKey, string>` fails — fix missing keys.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "$(cat <<'EOF'
feat: restore Settings LLM section i18n labels

EOF
)"
```

---

### Task 2: Section shell + sticky Save (move fields into panels)

**Files:**
- Modify: `frontend/src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `t('settingsNavLlm')`, `t('settingsLlmBlurb')`, existing section title/blurb keys
- Produces: `SettingsSection` type; `section` state; nav + card + sticky footer shell wrapping current field JSX

- [ ] **Step 1: Add section type and state near the top of the component file**

After the `FormState` type (before `export default function SettingsPanel`), add:

```ts
type SettingsSection = 'appearance' | 'consoles' | 'llm' | 'keycloak' | 'atlassian'
```

Inside `SettingsPanel`, with the other `useState` hooks, add:

```ts
const [section, setSection] = useState<SettingsSection>('appearance')
```

- [ ] **Step 2: Build `navItems` and `activeNav` before the return**

After `testLlmConnection` (or immediately before `return`), add:

```ts
  const navItems: { id: SettingsSection; label: string; blurb: string }[] = [
    { id: 'appearance', label: t('appearance'), blurb: t('appearanceHint') },
    { id: 'consoles', label: t('consolesSection'), blurb: t('consolesSectionHint') },
    { id: 'llm', label: t('settingsNavLlm'), blurb: t('settingsLlmBlurb') },
    { id: 'keycloak', label: t('keycloakTitle'), blurb: t('keycloakBlurb') },
    { id: 'atlassian', label: t('atlassianTitle'), blurb: t('atlassianBlurb') },
  ]
  const activeNav = navItems.find((n) => n.id === section) || navItems[0]
```

- [ ] **Step 3: Replace the outer page shell**

Replace the current return root:

```tsx
<main className="flex-1 p-8 bg-ink-900 overflow-y-auto scroll">
  <h1 ...>...</h1>
  <p ...>...</p>
  <div className="max-w-lg">
    ...all sections...
    <button save>...
  </div>
</main>
```

with this structure (keep **existing field JSX** inside each `{section === '…' && (…)}` — do not rewrite control logic):

```tsx
  return (
    <main className="flex-1 min-h-0 flex flex-col bg-ink-900">
      <div className="flex-1 min-h-0 overflow-y-auto scroll">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 pt-8 pb-4">
          <header className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              {t('settingsTitle')}
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">{t('settingsBlurb')}</p>
          </header>

          {/* Mobile chips */}
          <div className="md:hidden flex gap-2 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
            {navItems.map((item) => {
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                    active
                      ? 'border-bu-500 bg-bu-500/15 text-bu-400'
                      : 'border-line bg-ink-850 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="flex gap-6 items-start">
            {/* Desktop nav */}
            <nav
              className="hidden md:block w-48 shrink-0 sticky top-4"
              aria-label={t('settingsTitle')}
            >
              <ul className="space-y-0.5">
                {navItems.map((item) => {
                  const active = section === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSection(item.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors border ${
                          active
                            ? 'border-bu-500/40 bg-bu-500/10 text-slate-100 border-s-[3px] border-s-bu-500'
                            : 'border-transparent text-slate-400 hover:bg-ink-850 hover:text-slate-200'
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>

            <div className="flex-1 min-w-0">
              <section className="border border-line rounded-xl bg-ink-850/80 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-line bg-ink-850">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-100">{activeNav.label}</h2>
                      <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
                        {activeNav.blurb}
                      </p>
                    </div>
                    {section === 'keycloak' && settings?.keycloak_configured && (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold shrink-0 mt-0.5">
                        {t('configured')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-5 py-5">
                  {section === 'appearance' && (
                    <div>{/* move Appearance fieldsets here; remove outer card wrapper */}</div>
                  )}
                  {section === 'consoles' && (
                    <div>{/* move Consoles toggles here; remove duplicate h2/blurb */}</div>
                  )}
                  {section === 'llm' && (
                    <div>
                      {/* provider radios, keys, model, vision, temperature, test connection */}
                    </div>
                  )}
                  {section === 'keycloak' && (
                    <div>{/* Keycloak fields; drop duplicate h2/blurb/configured chip */}</div>
                  )}
                  {section === 'atlassian' && (
                    <div>{/* Atlassian fields; drop duplicate title/blurb */}</div>
                  )}
                </div>
              </section>
              <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
                Local models need tool/function calling and context ≥ 16k. Or edit{' '}
                <code className="text-slate-400">backend/.env</code> and restart the API.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-ink-900/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center gap-3 md:ps-[13.5rem]">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="bg-bu-500 hover:bg-bu-600 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-md text-sm"
          >
            {saving ? t('saving') : t('saveSettings')}
          </button>
          {msg && <span className="text-xs text-slate-400">{msg}</span>}
        </div>
      </div>
    </main>
  )
```

**Migration rules while moving JSX:**

1. Remove the old outer `max-w-lg` wrapper and the bottom inline Save button + footer tip block (footer tip moves under the card as shown).
2. Appearance / Consoles: strip their own `border … rounded-xl p-4 bg-ink-850` card wrappers and duplicate section `h2` / blurb (card header already shows those). Keep `appearanceHint` only in nav blurb — do **not** duplicate the hint paragraph inside Appearance body (matches commit `67464e1`).
3. LLM: wrap provider → test-connection block in `{section === 'llm' && …}` — keep Vision + Temperature exactly as they are today.
4. Keycloak / Atlassian: remove their duplicate titles/blurbs/configured badges from the body (header + optional chip handle that).
5. Do **not** change `save()`, `testLlmConnection`, form state, or API calls.

- [ ] **Step 4: Typecheck**

Run:

```bash
cd frontend && npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsPanel.tsx
git commit -m "$(cat <<'EOF'
feat: restore Settings sectioned nav and sticky save

EOF
)"
```

---

### Task 3: Status-message polish

**Files:**
- Modify: `frontend/src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: existing `llmTestMsg`, `testMsg`, `keycloakTestMsg`, `msg` strings
- Produces: tinted inline status spans (presentation only)

- [ ] **Step 1: Add a tiny local helper inside the component (before return)**

```ts
  const statusClass = (text: string) => {
    const lower = text.toLowerCase()
    if (
      lower.includes('fail') ||
      lower.includes('error') ||
      lower.includes('unable') ||
      lower.includes('invalid')
    ) {
      return 'text-rose-400'
    }
    if (lower.includes('ok') || lower.includes('success') || lower.startsWith('jira ok') || lower.startsWith('confluence ok')) {
      return 'text-emerald-400'
    }
    return 'text-slate-400'
  }
```

- [ ] **Step 2: Apply to test / save status spans**

Wherever `llmTestMsg`, `testMsg`, `keycloakTestMsg`, or save `msg` is rendered as a `<span className="text-[11px] text-slate-400 …">` (or similar), change to:

```tsx
{llmTestMsg && (
  <span className={`text-[11px] break-all ${statusClass(llmTestMsg)}`}>{llmTestMsg}</span>
)}
```

Same pattern for `testMsg`, `keycloakTestMsg`, and sticky-footer `msg`.

Do not change how messages are set — only className.

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsPanel.tsx
git commit -m "$(cat <<'EOF'
feat: tint Settings connection status messages

EOF
)"
```

---

### Task 4: Manual acceptance pass

**Files:** none (verify only)

- [ ] **Step 1: Compile gate**

```bash
cd frontend && npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 2: Manual checklist against the spec**

Start the app (`cd frontend && npm run dev` + backend as usual). Open Settings and confirm:

- [ ] Desktop left nav switches Appearance / Consoles / Language model / Keycloak / Atlassian
- [ ] Mobile (< md) shows horizontal chips that switch the same sections
- [ ] Editing a field, switching section, returning — value still there (unsaved)
- [ ] Vision Auto/On/Off + Temperature still present under Language model and save correctly
- [ ] Sticky Save remains visible while scrolling; Save still persists full settings
- [ ] Keycloak “Configured” chip appears in card header when configured
- [ ] Light/dark themes remain readable
- [ ] Success/fail test messages show green/rose tint

- [ ] **Step 3: No further commit unless Step 2 found fixes** — if fixes needed, commit them separately with a clear message (e.g. `fix: keep appearance hint out of section body`).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Left nav + mobile chips | Task 2 |
| One active section card | Task 2 |
| Sticky Save + backdrop | Task 2 |
| Visual polish (header, nav, card band) | Task 2 |
| Status tint polish | Task 3 |
| Preserve all fields / Vision+Temp | Task 2 migration rules |
| Existing tokens only | Global constraints |
| i18n for LLM nav labels | Task 1 |
| `tsc` acceptance | Tasks 1–4 |

No placeholders. No API changes. No URL routing.
