# Report Preview Right Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking HTML or PDF on an assistant message opens an ephemeral Report tab in the right panel for preview, with Download HTML / Download PDF available there; Excel stays a direct download.

**Architecture:** Build the existing client HTML report once in `MessageActions`, pass a `ReportPreviewPayload` up to `App`, unhide the right panel, and select a temporary `report` tab in `RightPanel` (iframe `srcDoc` + toolbar). Downloads reuse `downloadHtml` / `printAsPdf`. No workspace writes.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Vitest; existing `messageExport.ts` helpers.

## Global Constraints

- Frontend only — no backend/API or workspace file writes
- Excel remains direct CSV download from message actions
- PDF download continues via print → Save as PDF (`printAsPdf`), not a binary PDF generator
- Preview is ephemeral (cleared on Close / session change / goHome); not persisted across refresh
- If right panel is hidden, auto-show it then open Report
- Reuse `buildHtmlDocument`, `downloadHtml`, `printAsPdf` — do not fork report HTML
- Match existing RightPanel tab chrome (closable temporary tab like file tab)
- Spec: `docs/superpowers/specs/2026-08-04-report-preview-right-panel-design.md`

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/messageExport.ts` | Export `ReportPreviewPayload` + `buildReportPreviewPayload` |
| `frontend/src/messageExport.test.ts` | Unit tests for preview payload helper |
| `frontend/src/components/MessageActions.tsx` | HTML/PDF → `onPreviewReport` (fallback to download/print) |
| `frontend/src/components/ChatPanel.tsx` | Pass `onPreviewReport` into `MessageActions` |
| `frontend/src/components/RightPanel.tsx` | Temporary Report tab + iframe + download/close toolbar |
| `frontend/src/App.tsx` | Own `reportPreview`, unhide panel, tab=`report`, clear on close/session |
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | `report` label for the tab |

---

### Task 1: `ReportPreviewPayload` helper + unit tests

**Files:**
- Modify: `frontend/src/messageExport.ts`
- Create: `frontend/src/messageExport.test.ts`

**Interfaces:**
- Produces:
  - `export type ReportPreviewPayload = { html: string; title: string; content: string; meta: ReportMeta }`
  - `export function buildReportPreviewPayload(content: string, meta: ReportMeta): ReportPreviewPayload`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/messageExport.test.ts
import { describe, expect, it } from 'vitest'
import { buildReportPreviewPayload, type ReportMeta } from './messageExport'

describe('buildReportPreviewPayload', () => {
  it('returns html document plus content and meta for downloads', () => {
    const meta: ReportMeta = {
      title: 'My report',
      username: 'alice',
      prompt: 'test login',
      timestamp: '2026-08-04 10:00',
    }
    const content = '## Results\n\nAll good.'
    const payload = buildReportPreviewPayload(content, meta)

    expect(payload.title).toBe('My report')
    expect(payload.content).toBe(content)
    expect(payload.meta).toEqual(meta)
    expect(payload.html).toContain('<!DOCTYPE html>')
    expect(payload.html).toContain('My report')
    expect(payload.html).toContain('All good')
  })

  it('uses default title when meta.title is empty', () => {
    const payload = buildReportPreviewPayload('hi', {})
    expect(payload.title).toBe('AgentBrowser report')
    expect(payload.html).toContain('AgentBrowser report')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/messageExport.test.ts`

Expected: FAIL — `buildReportPreviewPayload` is not exported / not defined

- [ ] **Step 3: Implement helper**

Near `downloadHtml` in `frontend/src/messageExport.ts`, add:

```ts
export type ReportPreviewPayload = {
  html: string
  title: string
  content: string
  meta: ReportMeta
}

export function buildReportPreviewPayload(
  content: string,
  meta: ReportMeta,
): ReportPreviewPayload {
  const title = (meta.title || 'AgentBrowser report').trim() || 'AgentBrowser report'
  return {
    html: buildHtmlDocument(content, { ...meta, title }),
    title,
    content,
    meta: { ...meta, title },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/messageExport.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/messageExport.ts frontend/src/messageExport.test.ts
git commit -m "feat: add buildReportPreviewPayload helper for report preview"
```

---

### Task 2: MessageActions preview callback

**Files:**
- Modify: `frontend/src/components/MessageActions.tsx`

**Interfaces:**
- Consumes: `buildReportPreviewPayload`, `ReportPreviewPayload` from `../messageExport`
- Produces: prop `onPreviewReport?: (payload: ReportPreviewPayload) => void`
- HTML and PDF both call the same preview path when callback is provided
- When `onPreviewReport` is absent: keep current `downloadHtml` / `printAsPdf` behavior

- [ ] **Step 1: Extend props and imports**

```tsx
import {
  copyText,
  downloadExcel,
  downloadHtml,
  embedStepScreenshots,
  eventsToReportSteps,
  extractMentionedFiles,
  printAsPdf,
  buildReportPreviewPayload,
  type ReportMeta,
  type ReportPreviewPayload,
} from '../messageExport'

type Props = {
  content: string
  title?: string
  prompt?: string
  sessionId?: string | null
  events?: Event[]
  onOpenFile?: (path: string) => void
  onPreviewReport?: (payload: ReportPreviewPayload) => void
}
```

Destructure `onPreviewReport` in the component.

- [ ] **Step 2: Shared open-preview runner**

Inside the component, add:

```tsx
const openReportPreview = async () => {
  const meta = await buildMetaWithSteps()
  const payload = buildReportPreviewPayload(content, meta)
  if (onPreviewReport) {
    onPreviewReport(payload)
    return
  }
  downloadHtml(content, meta)
}

const openReportPreviewOrPrint = async () => {
  const meta = await buildMetaWithSteps()
  const payload = buildReportPreviewPayload(content, meta)
  if (onPreviewReport) {
    onPreviewReport(payload)
    return
  }
  if (!printAsPdf(content, meta)) {
    window.alert(
      'Could not open the print dialog. An HTML file was downloaded instead — open it and use Print → Save as PDF.',
    )
  }
}
```

Wire buttons:

```tsx
onClick={() => void run('html', openReportPreview)}
// title:
stepCount > 0
  ? `Preview HTML report with ${stepCount} step screenshot(s)`
  : 'Preview as HTML in the Report panel'

onClick={() => void run('pdf', openReportPreviewOrPrint)}
// title:
stepCount > 0
  ? `Preview report (PDF download available) with ${stepCount} step screenshot(s)`
  : 'Preview report — download PDF from the Report panel'
```

Keep Excel on `downloadExcel` unchanged.

Update the helper caption under the buttons if present to:

```tsx
HTML / PDF open a Report preview ({stepCount} step{stepCount === 1 ? '' : 's'} with screenshots). Download from the panel.
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --pretty false`

Expected: no errors related to MessageActions

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/MessageActions.tsx
git commit -m "feat: MessageActions HTML/PDF open report preview callback"
```

---

### Task 3: RightPanel Report tab UI

**Files:**
- Modify: `frontend/src/components/RightPanel.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`
- Modify: `frontend/src/i18n/locales/ar.ts`
- Modify: `frontend/src/i18n/locales/hi.ts`

**Interfaces:**
- Consumes: `ReportPreviewPayload`, `downloadHtml`, `printAsPdf` from `../messageExport`
- Produces:
  - Props: `reportPreview?: ReportPreviewPayload | null`, `onCloseReport?: () => void`
  - Tab id `'report'` when `reportPreview` is non-null
  - Closing Report calls `onCloseReport` (parent clears state + restores prior tab)

- [ ] **Step 1: Add i18n keys**

In each locale file, after `eventLogs`:

```ts
// en.ts
report: 'Report',
downloadHtml: 'Download HTML',
downloadPdf: 'Download PDF',

// ar.ts
report: 'التقرير',
downloadHtml: 'تنزيل HTML',
downloadPdf: 'تنزيل PDF',

// hi.ts
report: 'रिपोर्ट',
downloadHtml: 'HTML डाउनलोड',
downloadPdf: 'PDF डाउनलोड',
```

(If locale types are inferred from `en.ts`, adding keys there first is enough; mirror all three.)

- [ ] **Step 2: Extend RightPanel props and tab type**

```tsx
import {
  contentToHtmlBody,
  downloadHtml,
  printAsPdf,
  type ReportPreviewPayload,
} from '../messageExport'

type Tab = 'browser' | 'files' | 'logs' | 'report'

type Props = {
  // ...existing props...
  reportPreview?: ReportPreviewPayload | null
  onCloseReport?: () => void
}
```

Destructure `reportPreview = null`, `onCloseReport`.

- [ ] **Step 3: Add closable Report tab in the tab bar**

After the Artifacts button (and before or after the file tab — prefer after Event Logs button is fine; place **after Artifacts, before the file-name tab**), render when `reportPreview` is set:

```tsx
{reportPreview && (
  <button
    type="button"
    onClick={() => setTab('report')}
    className={`${tab === 'report' ? 'tab-active' : 'tab-inactive'} px-2.5 py-1.5 text-[13px] font-medium rounded-md flex items-center gap-1.5 max-w-[140px]`}
    title={reportPreview.title}
  >
    <span className="text-bu-400">📑</span>
    <span className="truncate">{tr('report')}</span>
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        onCloseReport?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation()
          onCloseReport?.()
        }
      }}
      className="text-slate-500 hover:text-slate-200 p-0.5"
      title="Close"
    >
      <IconClose />
    </span>
  </button>
)}
```

If `tab === 'report'` but `reportPreview` becomes null, parent must have already switched tab — do not leave an empty report view.

- [ ] **Step 4: Report body + toolbar**

After the Snaps / Artifacts / file preview blocks, before logs:

```tsx
{tab === 'report' && reportPreview && (
  <div className="flex-1 flex flex-col min-h-0">
    <div className="h-9 border-b border-line flex items-center px-3 gap-2 text-xs flex-shrink-0 bg-ink-900">
      <span className="text-bu-400">📑</span>
      <span className="truncate flex-1 text-slate-200 font-medium">{reportPreview.title}</span>
      <button
        type="button"
        className="px-2 py-0.5 rounded border border-line text-slate-300 hover:border-bu-500/50"
        title={tr('downloadHtml')}
        onClick={() => downloadHtml(reportPreview.content, reportPreview.meta)}
      >
        {tr('downloadHtml')}
      </button>
      <button
        type="button"
        className="px-2 py-0.5 rounded border border-line text-slate-300 hover:border-bu-500/50"
        title={tr('downloadPdf')}
        onClick={() => {
          if (!printAsPdf(reportPreview.content, reportPreview.meta)) {
            window.alert(
              'Could not open the print dialog. An HTML file was downloaded instead — open it and use Print → Save as PDF.',
            )
          }
        }}
      >
        {tr('downloadPdf')}
      </button>
    </div>
    <div className="flex-1 overflow-auto scroll bg-ink-900 min-h-0 flex flex-col">
      <iframe
        key={`${reportPreview.title}:${reportPreview.html.length}`}
        title={reportPreview.title}
        srcDoc={reportPreview.html}
        className="w-full flex-1 min-h-[420px] border-0 bg-white"
        sandbox="allow-same-origin allow-popups allow-forms"
      />
    </div>
  </div>
)}
```

Note: do **not** add `allow-scripts` unless existing HTML artifact preview already needs it — match the Artifacts HTML iframe sandbox string exactly.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc -b --pretty false`

Expected: PASS (App may still need prop wiring — if `reportPreview` is optional, RightPanel alone typechecks)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/RightPanel.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "feat: add ephemeral Report tab to right panel"
```

---

### Task 4: App + ChatPanel wiring

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ChatPanel.tsx`

**Interfaces:**
- Consumes: `ReportPreviewPayload` from `./messageExport`
- Produces:
  - `reportPreview` state in App
  - `onPreviewReport` → ChatPanel → MessageActions
  - Unhide right panel + set `rightTab` to `'report'`
  - `onCloseReport` restores previous non-report tab and clears preview
  - Clear `reportPreview` on `goHome` and `loadSession`

- [ ] **Step 1: ChatPanel prop**

```tsx
import type { ReportPreviewPayload } from '../messageExport'

type Props = {
  // ...existing...
  onPreviewReport?: (payload: ReportPreviewPayload) => void
}
```

Pass through:

```tsx
<MessageActions
  // ...existing props...
  onOpenFile={onOpenFile}
  onPreviewReport={onPreviewReport}
/>
```

- [ ] **Step 2: App state and handlers**

```tsx
import type { ReportPreviewPayload } from './messageExport'

type RightTab = 'browser' | 'files' | 'logs' | 'report'

const [rightTab, setRightTab] = useState<RightTab>('browser')
const [reportPreview, setReportPreview] = useState<ReportPreviewPayload | null>(null)
const prevRightTabRef = useRef<'browser' | 'files' | 'logs'>('browser')
```

(Add `useRef` to React imports if missing.)

Unhide helper (reuse wherever panel must show):

```tsx
const showRightPanel = useCallback(() => {
  setRightPanelHidden(false)
  try {
    localStorage.setItem('aip_right_panel_hidden', '0')
  } catch {
    /* ignore */
  }
}, [])

const openReportPreview = useCallback(
  (payload: ReportPreviewPayload) => {
    setRightTab((current) => {
      if (current !== 'report') {
        prevRightTabRef.current = current
      }
      return 'report'
    })
    setReportPreview(payload)
    showRightPanel()
  },
  [showRightPanel],
)

const closeReportPreview = useCallback(() => {
  setReportPreview(null)
  setRightTab(prevRightTabRef.current)
}, [])
```

**Important:** `setRightTab` with a functional updater that also writes `prevRightTabRef` is intentional — do not read stale `rightTab` from a closure when HTML/PDF is clicked.

- [ ] **Step 3: Clear preview on session navigation**

In `goHome` and `loadSession`, add:

```tsx
setReportPreview(null)
```

(Keep existing `setRightTab('browser')`.)

- [ ] **Step 4: Wire ChatPanel and RightPanel**

```tsx
onPreviewReport={openReportPreview}

// RightPanel:
reportPreview={reportPreview}
onCloseReport={closeReportPreview}
tab={rightTab}
onTabChange={(t) => {
  if (t !== 'report') setRightTab(t)
  else if (reportPreview) setRightTab('report')
}}
```

Simpler acceptable `onTabChange`: keep `onTabChange={setRightTab}` — Report tab button only appears when preview exists.

When user switches to Snaps/Artifacts/Logs while preview exists, **do not** clear `reportPreview` (tab remains listed).

- [ ] **Step 5: Verify build**

Run: `cd frontend && npm test -- src/messageExport.test.ts && npm run build`

Expected: tests PASS; `tsc` + Vite build succeed

- [ ] **Step 6: Manual QA checklist**

1. Open a finished AgentBrowser session with step screenshots; click **HTML** → right panel shows **Report** tab with iframe preview (no file download).
2. From toolbar, **Download HTML** saves `.html`; **Download PDF** opens print dialog.
3. Hide the right panel; click **PDF** → panel unhides and Report opens (same preview).
4. Switch to Snaps, then back to Report — preview still there.
5. Close Report tab (×) — tab gone; previous tab restored.
6. **Excel** still downloads CSV immediately.
7. Click HTML on another message — Report content replaces.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ChatPanel.tsx
git commit -m "feat: wire report preview into App right panel"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Temporary Report tab | Task 3 |
| Same HTML preview for HTML + PDF clicks | Task 2 |
| Download HTML + Download PDF in toolbar | Task 3 |
| Auto-show panel if hidden | Task 4 |
| Excel unchanged | Task 2 (no change) |
| Ephemeral / no workspace write | Tasks 1–4 |
| Re-click replaces preview | Task 4 |
| Switch tabs keeps preview | Task 4 |
| Close clears + restores prior tab | Task 4 |
| Print fallback alert | Task 3 |
| Unit test for payload helper | Task 1 |
