/** Client-side copy / HTML / PDF export for assistant messages. */

import {
  buildAgentObservations,
  buildAgentQaRows,
  buildCriticalIssues,
  buildReportExecutionRows,
  downloadQaExcel,
  groupExecutionRowsBySection,
  normalizeScreenshotArchiveMode,
  parsePlannedTestCases,
  renderEvidenceHtml,
  renderExecutionSectionHtml,
  renderExecutionTableHtml,
  sessionDurationLabel,
  summarizeExecutionRows,
  agentStepHasError,
  type ScreenshotArchiveMode,
} from './qaReport'

/** Fixed branding for every exported Test Execution Report. */
export const REPORT_PROJECT = 'AI Assistant'
export const REPORT_DOCUMENT_TITLE = 'AI Assistant Test Execution Report'

export type ReportStep = {
  step: number
  url?: string
  pageTitle?: string
  thought?: string
  evidenceText?: string
  actions: string[]
  details: string[]
  screenshotPath?: string
  /** data:image/... for offline HTML / print PDF */
  screenshotDataUrl?: string
  createdAt?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(s: string, n: number): string {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1)}…`
}

function humanizeAction(action: string): string {
  const raw = (action || '').trim()
  if (!raw) return 'Action'
  const i = raw.indexOf(':')
  const name = (i >= 0 ? raw.slice(0, i) : raw).trim()
  const rest = i >= 0 ? raw.slice(i + 1).trim() : ''
  const label = name.replace(/_/g, ' ')
  if (!rest) return label.charAt(0).toUpperCase() + label.slice(1)
  return `${label.charAt(0).toUpperCase() + label.slice(1)} — ${truncate(rest, 120)}`
}

function thoughtSummary(payload: Record<string, unknown>): string {
  const fields = (payload.thought_fields || {}) as Record<string, unknown>
  for (const key of ['thinking', 'next_goal', 'memory', 'evaluation_previous_goal', 'page_summary']) {
    const v = fields[key]
    if (typeof v === 'string' && v.trim()) return truncate(v, 400)
  }
  const thought = payload.thought
  if (typeof thought === 'string' && thought.trim()) {
    const first = thought.split(/\n\n/)[0] || thought
    return truncate(first.replace(/^[a-z_]+:\s*/i, ''), 400)
  }
  return ''
}

type StepEventLike = {
  type: string
  payload: Record<string, unknown>
  created_at?: string
}

/** Build report steps from session events (screenshots resolved separately). */
export function eventsToReportSteps(events: StepEventLike[], limit = 200): ReportStep[] {
  const steps = (events || []).filter((e) => e.type === 'step')
  const out: ReportStep[] = []
  for (let i = 0; i < steps.length && out.length < limit; i++) {
    const e = steps[i]
    const p = e.payload || {}
    const stepNo = typeof p.step === 'number' ? p.step : i + 1
    const actions = Array.isArray(p.actions)
      ? (p.actions as unknown[]).map((a) => String(a)).filter(Boolean)
      : []
    const details: string[] = []
    if (p.url) details.push(`URL: ${String(p.url)}`)
    if (p.title) details.push(`Page: ${String(p.title)}`)
    if (Array.isArray(p.files_written) && p.files_written.length) {
      details.push(`Files: ${(p.files_written as unknown[]).map(String).join(', ')}`)
    }
    if (e.created_at) {
      try {
        details.push(`Time: ${new Date(String(e.created_at)).toLocaleString()}`)
      } catch {
        /* ignore */
      }
    }
    const shot =
      typeof p.screenshot === 'string' && p.screenshot ? String(p.screenshot) : undefined
    let screenshotDataUrl: string | undefined
    if (typeof p.screenshot_b64 === 'string' && p.screenshot_b64) {
      screenshotDataUrl = `data:image/png;base64,${p.screenshot_b64}`
    }
    const thoughtFields =
      p.thought_fields && typeof p.thought_fields === 'object'
        ? (p.thought_fields as Record<string, unknown>)
        : {}
    const fieldBlob = Object.entries(thoughtFields)
      .filter(([, v]) => typeof v === 'string' && String(v).trim())
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join('\n')
    const fullThought = typeof p.thought === 'string' ? p.thought : ''
    const evidenceText = [fullThought, fieldBlob, ...actions].filter(Boolean).join('\n')
    out.push({
      step: stepNo,
      url: p.url ? String(p.url) : undefined,
      pageTitle: p.title ? String(p.title) : undefined,
      thought: thoughtSummary(p) || undefined,
      evidenceText: evidenceText || undefined,
      actions: actions.map(humanizeAction),
      details,
      screenshotPath: shot,
      screenshotDataUrl,
      createdAt: e.created_at ? String(e.created_at) : undefined,
    })
  }
  return out
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** Fetch missing screenshots and embed as data URLs for offline HTML/PDF. */
export async function embedStepScreenshots(
  sessionId: string,
  steps: ReportStep[],
  screenshotUrl: (sessionId: string, rel: string) => string,
  archiveMode: ScreenshotArchiveMode = 'on_failure',
): Promise<ReportStep[]> {
  if (archiveMode === 'never') {
    return steps.map((s) => ({
      ...s,
      screenshotDataUrl: undefined,
      screenshotPath: undefined,
    }))
  }
  const results: ReportStep[] = []
  for (const step of steps) {
    if (step.screenshotDataUrl || !step.screenshotPath) {
      results.push(step)
      continue
    }
    try {
      const res = await fetch(screenshotUrl(sessionId, step.screenshotPath))
      if (!res.ok) {
        results.push(step)
        continue
      }
      const blob = await res.blob()
      const dataUrl = await blobToDataUrl(blob)
      results.push({ ...step, screenshotDataUrl: dataUrl })
    } catch {
      results.push(step)
    }
  }
  if (archiveMode !== 'on_failure') return results
  const need = results.some((s) => agentStepHasError(s) && !s.screenshotDataUrl)
  if (!need) return results
  let latestDataUrl: string | undefined
  try {
    const res = await fetch(screenshotUrl(sessionId, 'screenshots/latest.png'))
    if (res.ok) latestDataUrl = await blobToDataUrl(await res.blob())
  } catch {
    /* ignore */
  }
  if (!latestDataUrl) return results
  return results.map((s) =>
    agentStepHasError(s) && !s.screenshotDataUrl
      ? {
          ...s,
          screenshotPath: s.screenshotPath || 'screenshots/latest.png',
          screenshotDataUrl: latestDataUrl,
        }
      : s,
  )
}

const HTML_OMIT_NOTE =
  '**Embedded HTML report source omitted from this export.** Open the `.html` artifact in Artifacts, or use the structured sections below.'

/** Strip pasted HTML documents so exports do not dump raw source. */
export function sanitizeExportContent(content: string): string {
  let text = (content || '').replace(/\r\n/g, '\n')
  let stripped = false
  text = text.replace(/```(?:html?|HTML?)\s*\n[\s\S]*?```/g, () => {
    stripped = true
    return ''
  })
  text = text.replace(/<!DOCTYPE\s+html\b[\s\S]*?<\/html\s*>/gi, () => {
    stripped = true
    return ''
  })
  text = text.replace(/<html\b[\s\S]*?<\/html\s*>/gi, () => {
    stripped = true
    return ''
  })
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, () => {
    stripped = true
    return ''
  })
  text = text.replace(
    /(^|\n)\s*Attachments?\s*:\s*(?:\n\s*[^\n]+\.html?\s*:?\s*)+/gi,
    (_m, lead: string) => {
      stripped = true
      return `${lead}`
    },
  )
  text = text.replace(/(^|\n)\s*[^\n]+\.html?\s*:\s*(?=\n|$)/gi, (_m, lead: string) => {
    stripped = true
    return `${lead}`
  })
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  if (stripped) {
    text = text ? `${text}\n\n${HTML_OMIT_NOTE}` : HTML_OMIT_NOTE
  }
  return text
}

function stepsToHtml(steps: ReportStep[]): string {
  if (!steps.length) return ''
  const cards = steps
    .map((s) => {
      const actions =
        s.actions.length > 0
          ? `<ol class="step-actions">${s.actions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ol>`
          : `<p class="muted">No tool actions this step.</p>`
      const details =
        s.details.length > 0
          ? `<ul class="step-details">${s.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
          : ''
      const thought = s.thought
        ? `<div class="step-thought"><strong>Thought</strong><p>${escapeHtml(s.thought)}</p></div>`
        : ''
      const shot = s.screenshotDataUrl
        ? `<figure class="step-shot">
            <img src="${s.screenshotDataUrl}" alt="Step ${s.step} screenshot" />
            <figcaption>Step ${s.step} screenshot${s.pageTitle ? ` — ${escapeHtml(truncate(s.pageTitle, 80))}` : ''}${s.url ? ` · ${escapeHtml(truncate(s.url, 60))}` : ''}</figcaption>
          </figure>`
        : `<p class="muted">No screenshot captured for this step.</p>`
      return `<article class="step-card" id="step-${s.step}">
        <header class="step-head">
          <span class="step-badge">Step ${s.step}</span>
          ${s.url ? `<span class="step-url">${escapeHtml(truncate(s.url, 90))}</span>` : ''}
        </header>
        ${thought}
        <div class="step-block"><strong>Actions</strong>${actions}</div>
        ${details ? `<div class="step-block"><strong>Details</strong>${details}</div>` : ''}
        <div class="step-block"><strong>Screenshot</strong>${shot}</div>
      </article>`
    })
    .join('\n')

  return `
  <section class="steps-section">
    <h2>Detailed steps</h2>
    <p class="steps-intro">${steps.length} agent step${steps.length === 1 ? '' : 's'} with actions, details, and screenshots.</p>
    ${cards}
  </section>`
}

/** Light markdown → HTML for exports (bold, links, lists, pipes tables). */
export function contentToHtmlBody(content: string): string {
  const text = sanitizeExportContent(content || '').replace(/\r\n/g, '\n').trim()
  if (!text) return '<p></p>'

  const lines = text.split('\n')
  const parts: string[] = []
  let i = 0

  const inline = (line: string) => {
    let html = escapeHtml(line)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /\[([^\]]+)\]\((https?:[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      )
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
    // Status badges for table cells / prose
    html = html
      .replace(
        /(?:✅\s*)?\bPASS\b/gi,
        '<span class="status-badge status-pass">PASS</span>',
      )
      .replace(
        /(?:❌\s*)?\bFAIL\b/gi,
        '<span class="status-badge status-fail">FAIL</span>',
      )
      .replace(
        /\bBLOCKED\b/gi,
        '<span class="status-badge status-blocked">BLOCKED</span>',
      )
    return html
  }

  const isPipeRow = (line: string) => /^\s*\|.+\|\s*$/.test(line)
  const isSepRow = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)
  const splitPipeRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())

  while (i < lines.length) {
    const line = lines[i]
    // Markdown pipe table (separator optional — agents often omit it)
    if (isPipeRow(line)) {
      const rows: string[][] = []
      while (i < lines.length && (isPipeRow(lines[i]) || isSepRow(lines[i]))) {
        if (!isSepRow(lines[i])) rows.push(splitPipeRow(lines[i]))
        i++
      }
      if (rows.length) {
        const [head, ...body] = rows
        parts.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>')
        for (const h of head) parts.push(`<th>${inline(h)}</th>`)
        parts.push('</tr></thead><tbody>')
        for (const row of body) {
          parts.push('<tr>')
          for (let c = 0; c < head.length; c++) {
            parts.push(`<td>${inline(row[c] || '')}</td>`)
          }
          parts.push('</tr>')
        }
        parts.push('</tbody></table></div>')
      }
      continue
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      parts.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }

    // Bare "Test Execution Summary" / requirement lines → promote to table when
    // we see a header-like line followed by PASS/FAIL rows (no pipes).
    if (
      /^\s*(Requirement|TC ID|Test Scenario)\b/i.test(line) &&
      /\bStatus\b/i.test(line) &&
      i + 1 < lines.length &&
      /\b(PASS|FAIL|BLOCKED)\b/i.test(lines[i + 1] || '')
    ) {
      const headerCells = line.trim().split(/\s{2,}|\t+/).filter(Boolean)
      const bodyRows: string[][] = []
      i++
      while (i < lines.length && /\b(PASS|FAIL|BLOCKED|N\/A)\b/i.test(lines[i])) {
        const cells = lines[i].trim().split(/\s{2,}|\t+/).filter(Boolean)
        if (cells.length >= 2) bodyRows.push(cells)
        i++
      }
      if (headerCells.length && bodyRows.length) {
        parts.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>')
        for (const h of headerCells) parts.push(`<th>${inline(h)}</th>`)
        parts.push('</tr></thead><tbody>')
        for (const row of bodyRows) {
          parts.push('<tr>')
          for (let c = 0; c < headerCells.length; c++) {
            parts.push(`<td>${inline(row[c] || '')}</td>`)
          }
          parts.push('</tr>')
        }
        parts.push('</tbody></table></div>')
      }
      continue
    }

    const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    if (num) {
      parts.push('<ol>')
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(\d+)[.)]\s+(.*)$/)
        if (!m) break
        let item = m[2]
        i++
        while (i < lines.length && /^\s+[-*•]/.test(lines[i])) {
          item += '\n' + lines[i].trim()
          i++
        }
        parts.push(`<li>${inline(item).replace(/\n/g, '<br/>')}</li>`)
      }
      parts.push('</ol>')
      continue
    }

    const bul = line.match(/^\s*[-*•]\s+(.*)$/)
    if (bul) {
      parts.push('<ul>')
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*•]\s+(.*)$/)
        if (!m) break
        parts.push(`<li>${inline(m[1])}</li>`)
        i++
      }
      parts.push('</ul>')
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const start = i
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(?:\d+[.)]\s|[-*•]\s|\|.+\||#{1,6}\s)/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    if (i === start) {
      parts.push(`<p>${inline(lines[i])}</p>`)
      i++
      continue
    }
    parts.push(`<p>${para.map(inline).join('<br/>')}</p>`)
  }

  return parts.join('\n')
}

export type ReportMeta = {
  title?: string
  username?: string
  prompt?: string
  timestamp?: string
  /** Optional overall run duration label (e.g. "4m 12s"); computed from steps when omitted */
  duration?: string
  steps?: ReportStep[]
  screenshotArchive?: ScreenshotArchiveMode
}

export function buildHtmlDocument(
  content: string,
  titleOrMeta: string | ReportMeta = 'AgentBrowser report',
): string {
  const meta: ReportMeta =
    typeof titleOrMeta === 'string' ? { title: titleOrMeta } : titleOrMeta || {}
  // Always brand as AI Assistant Test Execution Report
  const project = REPORT_PROJECT
  const documentTitle = REPORT_DOCUMENT_TITLE
  const prompt = (meta.prompt || '').trim() || '—'
  const timestamp = (meta.timestamp || new Date().toLocaleString()).trim()
  const rawUser = (meta.username || '').trim()
  const tester = rawUser && rawUser !== 'Unknown' ? rawUser : 'Automated QA'
  const archiveMode = normalizeScreenshotArchiveMode(meta.screenshotArchive)
  const body = contentToHtmlBody(content)
  const steps = meta.steps || []
  // User-pasted TC plan (prompt) wins over assistant echo; fall back to content
  const planText = [prompt !== '—' ? prompt : '', content || ''].filter(Boolean).join('\n\n')
  const { rows: execRows, fromPlan } = buildReportExecutionRows(steps, {
    startUrl: steps[0]?.url,
    taskTheme: project,
    planText,
  })
  const counts = summarizeExecutionRows(execRows)
  const targetUrl = steps.find((s) => s.url)?.url || ''
  const { observations, recommendations } = buildAgentObservations(steps)
  const criticalIssues = buildCriticalIssues(execRows)
  const shotsHtml = renderEvidenceHtml(steps, archiveMode)
  const runDuration = (meta.duration || '').trim() || sessionDurationLabel(steps)

  // Prefer plan sections (1. General Questions); else hostname groups
  let groups = groupExecutionRowsBySection(execRows)
  if (!fromPlan) {
    groups = new Map()
    {
      let n = 0
      for (const step of steps) {
        const hasActions = (step.actions || []).length > 0
        const hasShot = Boolean(step.screenshotPath || step.screenshotDataUrl)
        if (!hasActions && !hasShot) continue
        n += 1
        let feature = 'Browser Session'
        if (step.url) {
          try {
            feature = new URL(step.url).hostname || feature
          } catch {
            /* ignore */
          }
        }
        const row = execRows[n - 1]
        if (!row) continue
        const list = groups.get(feature) || []
        list.push(row)
        groups.set(feature, list)
      }
    }
    if (groups.size === 0 && execRows.length) {
      groups.set('Browser Session', execRows)
    }
  }

  let sectionIdx = 0
  const detailedSections = [...groups.entries()]
    .map(([feature, rows]) => {
      sectionIdx += 1
      // Section titles from plan already include "1. General Questions" — avoid double numbering
      const label = fromPlan && /^\d+\./.test(feature) ? feature : feature
      const idx = fromPlan && /^\d+\./.test(feature) ? 0 : sectionIdx
      if (idx === 0) {
        const first = rows[0]?.['TC ID'] || ''
        const last = rows[rows.length - 1]?.['TC ID'] || first
        const range = first && last ? ` (${first} to ${last})` : ''
        const passed = rows.filter((r) => r.Status === 'PASS').length
        return `<h2>${escapeHtml(label)}${escapeHtml(range)}</h2>
  ${renderExecutionTableHtml(rows)}
  <p class="section-result"><strong>Section Result:</strong> ${passed}/${rows.length} Passed</p>`
      }
      return renderExecutionSectionHtml(sectionIdx, feature, rows)
    })
    .join('\n')

  // recount sectionIdx for closing section numbers when plan used pre-numbered headings
  if (fromPlan) sectionIdx = groups.size

  const shotSectionIdx = sectionIdx + 1
  const criticalIdx = shotSectionIdx + 1
  const recIdx = criticalIdx + 1
  const conclusionIdx = recIdx + 1

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(documentTitle)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap');
    :root {
      --green: #006633;
      --text: #222222;
      --border: #c8c8c8;
      --rule: #dddddd;
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Noto Sans", "DejaVu Sans", Arial, Helvetica, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      max-width: 780px;
      margin: 0 auto;
      padding: 32px 36px 48px;
      color: var(--text);
      background: #fff;
    }
    h1 {
      font-size: 22pt;
      font-weight: 700;
      color: var(--green);
      margin: 0 0 16px;
      line-height: 1.25;
      text-align: center;
    }
    h2 {
      font-size: 13pt;
      font-weight: 700;
      color: var(--green);
      margin: 20px 0 8px;
    }
    p { margin: 0 0 10px; }
    ul, ol { margin: 0 0 12px; padding-left: 1.4rem; }
    li { margin: 4px 0; }
    .field-table, .exec-table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 12px;
      font-size: 10.5pt;
    }
    .field-table th, .field-table td,
    .exec-table th, .exec-table td {
      border: 1px solid var(--border);
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    .field-table thead th,
    .exec-table thead th {
      background: var(--green);
      color: #fff;
      font-weight: 700;
    }
    .field-table thead th { width: 50%; }
    .field-table tbody th {
      width: 38%;
      font-weight: 400;
      background: #fff;
      color: var(--text);
    }
    .exec-table { font-size: 10pt; table-layout: fixed; }
    .exec-table col.tc { width: 10%; }
    .exec-table col.scenario { width: 24%; }
    .exec-table col.status { width: 10%; }
    .exec-table col.duration { width: 10%; }
    .exec-table col.notes { width: 46%; }
    .exec-table td.cell-wrap {
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.4;
    }
    .exec-table td.status-cell { text-align: left; white-space: nowrap; }
    .exec-table td.duration-cell { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .status-pass { color: var(--text); font-weight: 700; }
    .status-fail { color: #990000; font-weight: 700; }
    .status-blocked, .status-na { color: var(--text); font-weight: 700; }
    .section-result { margin: 0 0 16px; font-size: 10.5pt; }
    .qa-evidence-grid { display: grid; gap: 12px; margin: 8px 0 16px; }
    .qa-evidence img {
      max-width: 100%;
      border: 1px solid var(--border);
      background: #111;
    }
    .qa-evidence figcaption { font-size: 9pt; color: #555; margin-top: 4px; }
    .muted { color: #666; font-size: 10pt; }
    .critical-issue { margin: 0 0 12px; }
    .critical-issue ul { margin: 4px 0 0; }
    .end-mark { margin: 22px 0 8px; text-align: center; }
    .report-footer {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid var(--rule);
      text-align: center;
      font-size: 9pt;
      color: #555;
    }
    .session-notes { margin: 12px 0 16px; font-size: 10pt; color: #444; }
    .session-notes .md-table-wrap { overflow-x: auto; margin: 10px 0; }
    .session-notes table.md-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
    }
    .session-notes table.md-table th,
    .session-notes table.md-table td {
      border: 1px solid var(--border);
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    .session-notes table.md-table th {
      background: var(--green);
      color: #fff;
      font-weight: 700;
    }
    .session-notes .status-badge { font-weight: 700; }
    .session-notes .status-pass { color: #006633; }
    .session-notes .status-fail { color: #990000; }
    code { font-family: "DejaVu Sans Mono", Consolas, monospace; font-size: 0.92em; }
    @media print {
      @page { size: A4; margin: 14mm; }
      body { padding: 0; max-width: none; }
      .qa-evidence { break-inside: avoid; }
      h2 { break-after: avoid; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(documentTitle)}</h1>

  <h2>Document Information</h2>
  <table class="field-table">
    <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
    <tbody>
      <tr><th scope="row">Project</th><td>${escapeHtml(project)}</td></tr>
      <tr><th scope="row">Version</th><td>1.0</td></tr>
      <tr><th scope="row">Report Date</th><td>${escapeHtml(timestamp)}</td></tr>
      <tr><th scope="row">Tester</th><td>${escapeHtml(tester)}</td></tr>
      <tr><th scope="row">Duration</th><td>${escapeHtml(runDuration)}</td></tr>
      <tr><th scope="row">Total Test Cases</th><td>${counts.total}</td></tr>
      <tr><th scope="row">Passed</th><td>${counts.passed}</td></tr>
      <tr><th scope="row">Failed</th><td>${counts.failed}</td></tr>
      <tr><th scope="row">Blocked / Not Tested</th><td>${counts.blocked}</td></tr>
      <tr><th scope="row">Partial / N/A</th><td>${counts.partial}</td></tr>
    </tbody>
  </table>

  ${
    prompt !== '—' || targetUrl
      ? `<p class="session-notes"><strong>Target:</strong> ${escapeHtml(targetUrl || 'N/A')}
         &nbsp;·&nbsp; <strong>Prompt:</strong> ${escapeHtml(prompt)}
         &nbsp;·&nbsp; <strong>Screenshot archive:</strong> ${
           archiveMode === 'always' ? 'Always' : archiveMode === 'never' ? 'Never' : 'On failure only'
         }</p>`
      : ''
  }
  ${body ? `<div class="session-notes">${body}</div>` : ''}

  ${detailedSections || renderExecutionTableHtml(execRows)}

  <h2>${shotSectionIdx}. Screenshot Evidence</h2>
  ${shotsHtml}

  <h2>${criticalIdx}. Critical Issues Found</h2>
  ${
    criticalIssues.length === 0
      ? `<p>No critical issues recorded for this session.</p>`
      : criticalIssues
          .map(
            (issue, i) => `<div class="critical-issue">
  <p><strong>${i + 1}. ${escapeHtml(issue.tcId)}: ${escapeHtml(issue.title)}</strong></p>
  <ul>
    <li><strong>Severity:</strong> ${escapeHtml(issue.severity)}</li>
    <li><strong>Error:</strong> ${escapeHtml(issue.error)}</li>
    <li><strong>Impact:</strong> ${escapeHtml(issue.impact)}</li>
    <li><strong>Recommendation:</strong> ${escapeHtml(issue.recommendation)}</li>
  </ul>
</div>`,
          )
          .join('\n')
  }

  <h2>${recIdx}. Recommendations</h2>
  <ol>
    ${(recommendations.length
      ? recommendations
      : ['Re-run after UI or flow changes; keep key paths covered.']
    )
      .map((x) => `<li>${escapeHtml(x)}</li>`)
      .join('')}
  </ol>

  <h2>${conclusionIdx}. Conclusion</h2>
  <p>${counts.passed} passed, ${counts.failed} failed, ${counts.blocked} blocked / not tested
    (${counts.total} total). Run duration: ${escapeHtml(runDuration)}.
    ${counts.total === 0 ? 'No browser test cases were executed in this session.' : ''}</p>
  <p><strong>Overall Assessment:</strong>
    ${
      counts.verdict === 'PASS'
        ? 'Core exercised paths passed in this session. Re-run after material UI or environment changes.'
        : counts.verdict === 'FAIL'
          ? 'One or more exercised paths failed. Resolve critical issues above before treating this run as production-ready.'
          : 'No executable browser cases were available to assess in this session.'
    }
  </p>
  ${
    observations.length
      ? `<p class="muted"><strong>Additional notes:</strong> ${escapeHtml(observations.join(' · '))}</p>`
      : ''
  }

  <p class="end-mark"><strong>End of Report</strong></p>
  <footer class="report-footer">
    Report generated by AgentBrowser as part of functional test execution protocol.
  </footer>
</body>
</html>`
}


export function slugTitle(title: string): string {
  const s = (title || 'report')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return s || 'report'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

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
  const title = REPORT_DOCUMENT_TITLE
  return {
    html: buildHtmlDocument(content, { ...meta, title }),
    title,
    content,
    meta: { ...meta, title },
  }
}

export function downloadHtml(content: string, titleOrMeta: string | ReportMeta) {
  const name = `${slugTitle(REPORT_DOCUMENT_TITLE)}.html`
  downloadTextFile(name, buildHtmlDocument(content, titleOrMeta), 'text/html;charset=utf-8')
}

/** Download QA test-case table as Excel-friendly CSV. */
export function downloadExcel(content: string, titleOrMeta: string | ReportMeta) {
  const meta: ReportMeta =
    typeof titleOrMeta === 'string' ? { title: titleOrMeta } : titleOrMeta || {}
  const title = REPORT_DOCUMENT_TITLE
  const steps = meta.steps || []
  const planText = [(meta.prompt || '').trim(), content || ''].filter(Boolean).join('\n\n')
  const plan = parsePlannedTestCases(planText)
  if (plan.length) {
    const { rows: execRows } = buildReportExecutionRows(steps, { planText })
    const byId = new Map(execRows.map((r) => [r['TC ID'], r]))
    const rows = plan.map((p) => {
      const ex = byId.get(p['TC ID'])
      const actual =
        ex?.Status === 'PASS'
          ? `Pass — ${ex['Evidence / Notes']}`
          : ex?.Status === 'FAIL'
            ? `Fail — ${ex['Evidence / Notes']}`
            : ex?.Status === 'BLOCKED'
              ? `Blocked — ${ex['Evidence / Notes']}`
              : 'Not executed'
      return {
        'TC ID': p['TC ID'],
        Feature: p.Feature,
        'Test Scenario': p['Test Scenario'],
        Preconditions: p.Preconditions,
        'Test Steps': p['Test Steps'],
        'Expected Result': p['Expected Result'],
        'Actual Result': actual,
        Priority: p.Priority,
      }
    })
    downloadQaExcel(rows, slugTitle(title))
    return
  }
  const rows = buildAgentQaRows(steps, { startUrl: steps[0]?.url, taskTheme: REPORT_PROJECT })
  downloadQaExcel(rows, slugTitle(title))
}

/**
 * Open the system print dialog (user can choose "Save as PDF").
 * Waits for embedded screenshots to load before printing.
 */
export function printAsPdf(content: string, titleOrMeta: string | ReportMeta): boolean {
  const html = buildHtmlDocument(content, titleOrMeta)

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'Print preview')
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const doc = win?.document
  if (!win || !doc) {
    iframe.remove()
    downloadHtml(content, titleOrMeta)
    return false
  }

  const cleanup = () => {
    try {
      iframe.remove()
    } catch {
      /* ignore */
    }
  }

  try {
    doc.open()
    doc.write(html)
    doc.close()
  } catch {
    cleanup()
    downloadHtml(content, titleOrMeta)
    return false
  }

  let printed = false
  const doPrint = () => {
    if (printed) return
    printed = true
    try {
      win.focus()
      win.print()
    } catch {
      cleanup()
      downloadHtml(content, titleOrMeta)
      return
    }
    win.addEventListener('afterprint', cleanup, { once: true })
    setTimeout(cleanup, 60_000)
  }

  const imgs = Array.from(doc.images || [])
  if (imgs.length === 0) {
    setTimeout(doPrint, 100)
    return true
  }
  let pending = imgs.length
  const maybePrint = () => {
    pending -= 1
    if (pending <= 0) setTimeout(doPrint, 80)
  }
  for (const img of imgs) {
    if (img.complete) maybePrint()
    else {
      img.addEventListener('load', maybePrint, { once: true })
      img.addEventListener('error', maybePrint, { once: true })
    }
  }
  setTimeout(doPrint, 8_000)
  return true
}

/** Filenames mentioned in assistant text (pdf/html/md/…). */
export function extractMentionedFiles(content: string): string[] {
  const re =
    /\b([a-zA-Z0-9_\-.() ]+\.(?:pdf|html?|md|txt|csv|json|png|jpe?g))\b/gi
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content || ''))) {
    const name = m[1].trim()
    const key = name.toLowerCase()
    if (seen.has(key) || name.length < 5) continue
    seen.add(key)
    out.push(name)
  }
  return out.slice(0, 8)
}
