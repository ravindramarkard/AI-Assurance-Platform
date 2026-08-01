/** Client-side copy / HTML / PDF export for assistant messages. */

import {
  buildAgentObservations,
  buildAgentQaRows,
  downloadQaExcel,
  renderEvidenceHtml,
  renderObservationsHtml,
  renderQaTableHtml,
} from './qaReport'

export type ReportStep = {
  step: number
  url?: string
  pageTitle?: string
  thought?: string
  actions: string[]
  details: string[]
  screenshotPath?: string
  /** data:image/... for offline HTML / print PDF */
  screenshotDataUrl?: string
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
export function eventsToReportSteps(events: StepEventLike[], limit = 50): ReportStep[] {
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
    out.push({
      step: stepNo,
      url: p.url ? String(p.url) : undefined,
      pageTitle: p.title ? String(p.title) : undefined,
      thought: thoughtSummary(p) || undefined,
      actions: actions.map(humanizeAction),
      details,
      screenshotPath: shot,
      screenshotDataUrl,
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
): Promise<ReportStep[]> {
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
  return results
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
  const text = (content || '').replace(/\r\n/g, '\n').trim()
  if (!text) return '<p></p>'

  const lines = text.split('\n')
  const parts: string[] = []
  let i = 0

  const inline = (line: string) =>
    escapeHtml(line)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /\[([^\]]+)\]\((https?:[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      )
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')

  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-/.test(lines[i + 1])) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-/.test(lines[i])) {
          rows.push(
            lines[i]
              .trim()
              .replace(/^\|/, '')
              .replace(/\|$/, '')
              .split('|')
              .map((c) => c.trim()),
          )
        }
        i++
      }
      if (rows.length) {
        const [head, ...body] = rows
        parts.push('<table><thead><tr>')
        for (const h of head) parts.push(`<th>${inline(h)}</th>`)
        parts.push('</tr></thead><tbody>')
        for (const row of body) {
          parts.push('<tr>')
          for (const c of row) parts.push(`<td>${inline(c)}</td>`)
          parts.push('</tr>')
        }
        parts.push('</tbody></table>')
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
  steps?: ReportStep[]
}

export function buildHtmlDocument(
  content: string,
  titleOrMeta: string | ReportMeta = 'AgentBrowser report',
): string {
  const meta: ReportMeta =
    typeof titleOrMeta === 'string' ? { title: titleOrMeta } : titleOrMeta || {}
  const title = (meta.title || 'AgentBrowser report').trim() || 'AgentBrowser report'
  const username = (meta.username || '').trim() || 'Unknown'
  const prompt = (meta.prompt || '').trim() || '—'
  const timestamp = (meta.timestamp || new Date().toLocaleString()).trim()
  const body = contentToHtmlBody(content)
  const steps = meta.steps || []
  const qaRows = buildAgentQaRows(steps, { startUrl: steps[0]?.url, taskTheme: title })
  const { observations, recommendations } = buildAgentObservations(steps)
  const qaTableHtml = renderQaTableHtml(qaRows)
  const observationsHtml = renderObservationsHtml(observations, recommendations)
  const evidenceHtml = renderEvidenceHtml(steps)
  const brandIcon = `<svg class="ab-icon" viewBox="0 0 32 32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="4" width="28" height="22" rx="4" fill="#FF7A1A"/>
      <rect x="6" y="8" width="20" height="12" rx="2" fill="#FFF7ED"/>
      <circle cx="11" cy="14" r="1.6" fill="#FF7A1A"/>
      <circle cx="16" cy="14" r="1.6" fill="#FF7A1A"/>
      <circle cx="21" cy="14" r="1.6" fill="#FF7A1A"/>
      <path d="M12 26h8v2a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2z" fill="#E96A0D"/>
    </svg>`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body {
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      line-height: 1.55;
      max-width: 860px;
      margin: 0 auto;
      padding: 28px 24px 64px;
      color: #1f2937;
      background: #fff;
    }
    h1 { font-size: 1.35rem; margin: 0 0 0.75rem; color: #111827; }
    h2 { font-size: 1.15rem; margin: 1.75rem 0 0.5rem; color: #111827; border-bottom: 2px solid #fed7aa; padding-bottom: 0.35rem; }
    p { margin: 0 0 0.85rem; }
    ol, ul { margin: 0 0 1rem; padding-left: 1.35rem; }
    li { margin: 0.35rem 0; }
    .report-body table { width: 100%; border-collapse: collapse; margin: 0.75rem 0 1.25rem; font-size: 0.85rem; }
    .report-body th, .report-body td { border: 1px solid #e5e7eb; padding: 6px 8px; vertical-align: top; text-align: left; }
    .report-body th { background: #fff7ed; font-size: 0.72rem; text-transform: uppercase; color: #9a3412; }
    .qa-table-wrap { width: 100%; overflow-x: auto; margin: 0.75rem 0 1.25rem; }
    .qa-table {
      table-layout: fixed;
      width: 100%;
      border-collapse: collapse;
      font-size: 0.72rem;
      line-height: 1.35;
    }
    .qa-table th, .qa-table td {
      border: 1px solid #d1d5db;
      padding: 5px 6px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .qa-table th {
      background: #fff7ed;
      color: #9a3412;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }
    .qa-table tbody tr:nth-child(even) td { background: #fafafa; }
    .qa-obs h3 { font-size: 0.95rem; margin: 0.75rem 0 0.35rem; border: none; }
    .qa-evidence-grid { display: grid; gap: 12px; }
    .qa-evidence img { max-width: 100%; border: 1px solid #fed7aa; border-radius: 6px; }
    .qa-evidence figcaption { font-size: 0.8rem; color: #6b7280; margin-top: 4px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; }
    a { color: #2563eb; }
    .muted { color: #6b7280; font-size: 0.9rem; }
    .ab-icon { width: 28px; height: 28px; display: block; flex-shrink: 0; }
    .ab-icon-sm { width: 16px; height: 16px; vertical-align: -3px; margin-right: 6px; }
    .report-header {
      margin: 0 0 1.5rem;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #fdba74;
      box-shadow: 0 1px 2px rgba(255, 122, 26, 0.08);
    }
    .report-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #FF7A1A 0%, #E96A0D 100%);
      color: #fff;
    }
    .report-brand .brand-text { font-weight: 700; font-size: 1.05rem; letter-spacing: 0.01em; }
    .report-brand .brand-sub { font-size: 0.75rem; opacity: 0.9; font-weight: 500; }
    .meta-table { width: 100%; border-collapse: collapse; margin: 0; font-size: 0.9rem; background: #fff; }
    .meta-table th, .meta-table td {
      border: none; border-top: 1px solid #fed7aa; padding: 10px 12px; text-align: left; vertical-align: top;
    }
    .meta-table th {
      width: 118px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap;
    }
    .meta-table td { color: #111827; white-space: pre-wrap; word-break: break-word; }
    .meta-table tr.row-title th { background: #fff7ed; color: #c2410c; }
    .meta-table tr.row-title td { background: #fffbeb; font-weight: 600; font-size: 0.98rem; }
    .meta-table tr.row-user th { background: #eff6ff; color: #1d4ed8; }
    .meta-table tr.row-user td { background: #f8fafc; }
    .meta-table tr.row-prompt th { background: #ecfdf5; color: #047857; }
    .meta-table tr.row-prompt td { background: #f8fafc; }
    .meta-table tr.row-time th { background: #f1f5f9; color: #334155; }
    .meta-table tr.row-time td { background: #fafafa; color: #374151; }
    .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.82rem; font-weight: 600; }
    .chip-user { background: #dbeafe; color: #1e40af; }
    .chip-time { background: #e2e8f0; color: #334155; }
    .steps-section { margin-top: 1.5rem; }
    .steps-intro { color: #6b7280; font-size: 0.9rem; margin-bottom: 1rem; }
    .step-card {
      border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin: 0 0 1.1rem;
      background: #fafafa; break-inside: avoid; page-break-inside: avoid;
    }
    .step-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 0.75rem; }
    .step-badge {
      display: inline-block; background: #FF7A1A; color: #fff; font-size: 0.75rem; font-weight: 700;
      padding: 3px 10px; border-radius: 999px; letter-spacing: 0.02em;
    }
    .step-url { font-size: 0.8rem; color: #4b5563; word-break: break-all; font-family: ui-monospace, Menlo, monospace; }
    .step-block { margin: 0.65rem 0; }
    .step-block > strong {
      display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; margin-bottom: 0.35rem;
    }
    .step-actions, .step-details { margin: 0.25rem 0 0; padding-left: 1.2rem; font-size: 0.92rem; }
    .step-thought {
      background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 12px; margin: 0.5rem 0 0.75rem;
    }
    .step-thought strong { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #c2410c; }
    .step-thought p { margin: 0.35rem 0 0; font-size: 0.92rem; color: #374151; }
    .step-shot { margin: 0.5rem 0 0; }
    .step-shot img {
      display: block; width: 100%; max-height: 420px; object-fit: contain; background: #111827;
      border: 1px solid #d1d5db; border-radius: 8px;
    }
    .step-shot figcaption { margin-top: 0.4rem; font-size: 0.78rem; color: #6b7280; }
    .report-footer {
      margin-top: 2.5rem; padding-top: 0.85rem; border-top: 1px solid #fed7aa; text-align: center;
      color: #9a3412; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.02em;
    }
    .report-footer .ab-icon { display: inline-block; }
    @media print {
      @page { size: landscape; margin: 8mm 8mm 12mm; }
      body { padding: 0 0 24px; max-width: none; font-size: 10pt; }
      a { color: inherit; text-decoration: none; }
      .report-header { break-inside: avoid; box-shadow: none; }
      .qa-table-wrap { overflow: visible; }
      .qa-table { font-size: 7.5pt; }
      .qa-table th, .qa-table td { padding: 3px 4px; }
      .qa-table thead { display: table-header-group; }
      .qa-table tr { break-inside: avoid; page-break-inside: avoid; }
      .step-card { break-inside: avoid; page-break-inside: avoid; background: #fff; }
      .step-shot img { max-height: 280px; }
      .qa-evidence { break-inside: avoid; page-break-inside: avoid; }
      .report-footer {
        position: fixed; bottom: 0; left: 0; right: 0; margin: 0; padding: 4px 0 0;
        border-top: 1px solid #fdba74; background: #fff;
      }
    }
  </style>
</head>
<body>
  <header class="report-header">
    <div class="report-brand">
      ${brandIcon}
      <div>
        <div class="brand-text">AgentBrowser</div>
        <div class="brand-sub">Session report</div>
      </div>
    </div>
    <table class="meta-table" role="presentation">
      <tbody>
        <tr class="row-title">
          <th scope="row">Title</th>
          <td>${escapeHtml(title)}</td>
        </tr>
        <tr class="row-user">
          <th scope="row">User</th>
          <td><span class="chip chip-user">${escapeHtml(username)}</span></td>
        </tr>
        <tr class="row-prompt">
          <th scope="row">Prompt</th>
          <td>${escapeHtml(prompt)}</td>
        </tr>
        <tr class="row-time">
          <th scope="row">Timestamp</th>
          <td><span class="chip chip-time">${escapeHtml(timestamp)}</span></td>
        </tr>
      </tbody>
    </table>
  </header>
  <main class="report-body">
  <h2>Executive Summary</h2>
  ${body}
  <h2>Test Cases</h2>
  ${qaTableHtml}
  <h2>Observations & Recommendations</h2>
  ${observationsHtml}
  ${evidenceHtml}
  </main>
  <footer class="report-footer">
    ${brandIcon.replace('class="ab-icon"', 'class="ab-icon ab-icon-sm"')}
    AgentBrowser
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

export function downloadHtml(content: string, titleOrMeta: string | ReportMeta) {
  const title =
    typeof titleOrMeta === 'string' ? titleOrMeta : titleOrMeta.title || 'AgentBrowser report'
  const name = `${slugTitle(title)}.html`
  downloadTextFile(name, buildHtmlDocument(content, titleOrMeta), 'text/html;charset=utf-8')
}

/** Download QA test-case table as Excel-friendly CSV. */
export function downloadExcel(content: string, titleOrMeta: string | ReportMeta) {
  const meta: ReportMeta =
    typeof titleOrMeta === 'string' ? { title: titleOrMeta } : titleOrMeta || {}
  const title = (meta.title || 'AgentBrowser report').trim() || 'AgentBrowser report'
  const steps = meta.steps || []
  const rows = buildAgentQaRows(steps, { startUrl: steps[0]?.url, taskTheme: title })
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
