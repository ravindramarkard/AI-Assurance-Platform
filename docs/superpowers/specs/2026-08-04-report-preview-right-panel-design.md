# Report preview in right panel — design

**Date:** 2026-08-04  
**Status:** Approved (Approach 1 — ephemeral Report tab)  
**Scope:** Frontend only — AgentBrowser chat HTML/PDF export UX

## Problem

Clicking **HTML** or **PDF** on an assistant message downloads a file or opens the system print dialog. Users want to preview the report in the right side panel first, then download from there.

## Goals

- HTML and PDF open a temporary **Report** tab in the right panel (preview-first)
- Preview shows the full client-built HTML report (including step screenshots when available)
- From the Report tab, user can **Download HTML** and **Download PDF**
- If the right panel is hidden, automatically show it and open the Report tab
- Excel remains a direct download from message actions

## Non-goals

- Backend or workspace file writes for the export
- Changing Excel export behavior
- Generating a real binary PDF (PDF continues to use print → Save as PDF)
- Persisting the report across page refresh
- Changing Artifacts file preview for workspace `report.html` / other files

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Where preview opens | **B** — temporary Report tab in the right panel |
| PDF vs HTML click | **B** — both open the same HTML preview; toolbar has Download HTML and Download PDF |
| Panel hidden | **A** — auto-show panel and open Report tab |
| Implementation approach | **1** — ephemeral client state; no workspace save |

## Architecture

```
MessageActions (HTML | PDF)
  → buildMetaWithSteps() + buildHtmlDocument()
  → onPreviewReport({ html, title, content, meta })
  → App: set reportPreview, unhide right panel, set tab = 'report'
  → RightPanel Report tab: iframe srcDoc + Download HTML / Download PDF / Close
```

Excel path unchanged: `downloadExcel` from MessageActions.

## Components

### `MessageActions`

- Add optional `onPreviewReport?: (payload: ReportPreviewPayload) => void`
- **HTML** and **PDF** buttons: build meta (with embedded step screenshots when session/events exist), build HTML document, call `onPreviewReport` instead of `downloadHtml` / `printAsPdf`
- Keep **Preparing…** busy state while screenshots embed
- Update button titles/tooltips to say “Preview report…” rather than “Download…”
- **Excel** unchanged
- If `onPreviewReport` is missing (tests / reuse), fall back to current download/print behavior

### `App` / `ChatPanel`

- Hold `reportPreview: ReportPreviewPayload | null`
- Hold `rightTab` extended with `'report'`
- On preview: set `reportPreview`, set `rightPanelHidden` to false (and persist), set `rightTab` to `'report'`
- Pass preview + close handler into `RightPanel`
- Wire `onPreviewReport` through `ChatPanel` → `MessageActions`

### `RightPanel`

- Tab type includes `'report'` when `reportPreview` is non-null
- Show a **Report** tab in the tab bar (closable, like a temporary file tab)
- Body: iframe with `srcDoc={reportPreview.html}` (sandbox consistent with existing HTML artifact preview)
- Toolbar:
  - **Download HTML** → existing `downloadHtml` / blob download from stored content+meta
  - **Download PDF** → existing `printAsPdf`; on failure alert + HTML download fallback (same as today)
  - **Close** → clear `reportPreview`; restore previous tab (`browser` / `files` / `logs`)
- Switching away to Snaps / Artifacts / Event Logs does **not** clear `reportPreview`; Report tab remains available until Close
- Re-opening HTML/PDF from another message replaces `reportPreview` content

### `messageExport`

- Prefer exporting `buildHtmlDocument` for callers that need the string without downloading
- Reuse `downloadHtml` and `printAsPdf` from the Report toolbar (no new export formats)

## Data shape

```ts
type ReportPreviewPayload = {
  html: string
  title: string
  content: string
  meta: ReportMeta
}
```

`html` is the full document for the iframe. `content` + `meta` are kept so Download HTML / PDF can reuse existing helpers without regenerating screenshots.

## Edge cases

| Case | Behavior |
|------|----------|
| Right panel hidden | Unhide, then open Report |
| Click HTML/PDF again | Replace preview; stay on Report |
| Switch to other right tabs | Keep preview in memory; Report tab still listed |
| Close Report | Clear preview; fall back to previous non-report tab (default Snaps) |
| Print dialog blocked | Alert; download HTML as fallback; keep preview open |
| Screenshot embed failure | Open preview anyway; missing images omitted |
| No session / no steps | Preview still works (report without step screenshots) |
| Excel | Direct CSV download (unchanged) |

## Testing

- MessageActions: HTML/PDF invoke `onPreviewReport` (not immediate download) when callback provided
- App/RightPanel: setting preview selects Report tab and shows iframe content
- Report toolbar: Download HTML triggers file download; Download PDF calls print helper
- Close clears preview and removes the Report tab (falls back to previous tab)
- Optional: panel-hidden path unhides before showing Report

## Out of scope follow-ups

- Persist last previewed report into session Artifacts
- True server-side PDF generation
- Report preview for API Spectrum / other consoles
