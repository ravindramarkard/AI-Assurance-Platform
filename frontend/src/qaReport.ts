/** AgentBrowser QA report table helpers (HTML/PDF export). */

export const QA_TABLE_HEADERS = [
  'TC ID',
  'Feature',
  'Test Scenario',
  'Preconditions',
  'Test Steps',
  'Expected Result',
  'Actual Result',
  'Priority',
] as const

export type AgentReportStep = {
  step: number
  url?: string
  pageTitle?: string
  thought?: string
  actions: string[]
  details: string[]
  screenshotPath?: string
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

export function formatTcId(prefix: string, index: number): string {
  return `${prefix}-TC-${String(index).padStart(3, '0')}`
}

export function agentPriority(hasError: boolean): 'High' | 'Medium' {
  return hasError ? 'High' : 'Medium'
}

export function actualResultFromEvidence(opts: {
  executed: boolean
  error?: string
  detail?: string
}): string {
  if (!opts.executed) return 'Not executed'
  const err = (opts.error || '').trim()
  if (err) return `Fail — ${err}`
  const detail = (opts.detail || '').trim()
  if (detail) return `Pass — ${detail}`
  return 'N/A'
}

function stepHasError(step: AgentReportStep): boolean {
  const blob = [...(step.actions || []), ...(step.details || []), step.thought || ''].join('\n')
  return /(?:^|\b)error\b|^\s*failed\b|\bfailed\./i.test(blob)
}

function featureFromStep(step: AgentReportStep, taskTheme?: string): string {
  if (step.url) {
    try {
      return new URL(step.url).hostname || taskTheme || 'Browser'
    } catch {
      /* ignore */
    }
  }
  return (taskTheme || 'Browser').trim() || 'Browser'
}

export function buildAgentQaRows(
  steps: AgentReportStep[],
  opts?: { taskTheme?: string; startUrl?: string },
): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  let n = 0
  let prevUrl = opts?.startUrl
  for (const step of steps || []) {
    const hasActions = (step.actions || []).length > 0
    const hasShot = Boolean(step.screenshotPath || step.screenshotDataUrl)
    if (!hasActions && !hasShot) continue
    n += 1
    const failed = stepHasError(step)
    const errDetail =
      [...(step.details || []), ...(step.actions || [])].find((x) => /error/i.test(x)) ||
      (failed ? truncate(step.thought || 'error', 120) : '')
    const passDetail = truncate((step.actions || []).join('; ') || step.thought || '', 120)
    rows.push({
      'TC ID': formatTcId('AB', n),
      Feature: featureFromStep(step, opts?.taskTheme),
      'Test Scenario': truncate(step.thought || step.pageTitle || `Step ${step.step}`, 160),
      Preconditions: prevUrl || opts?.startUrl || 'N/A',
      'Test Steps': (step.actions || []).join('; ') || 'N/A',
      'Expected Result': 'As specified in prompt',
      'Actual Result': actualResultFromEvidence({
        executed: true,
        error: failed ? errDetail : undefined,
        detail: failed ? undefined : passDetail,
      }),
      Priority: agentPriority(failed),
    })
    if (step.url) prevUrl = step.url
  }
  return rows
}

export function buildAgentObservations(steps: AgentReportStep[]): {
  observations: string[]
  recommendations: string[]
} {
  const failed = (steps || []).filter(stepHasError)
  if (!failed.length) {
    return {
      observations: ['No failed browser steps recorded in this session.'],
      recommendations: ['Re-run after UI or flow changes; keep key paths covered.'],
    }
  }
  const observations = failed.map(
    (s) =>
      `Step ${s.step}: ${truncate(s.thought || s.actions?.[0] || 'failure', 140)}`,
  )
  const recommendations = [
    'Re-run failed steps after fixing selectors or timing.',
    'Confirm the target URL and credentials before retrying.',
  ]
  return { observations, recommendations }
}

const CELL_MAX_PDF: Record<string, number> = {
  'TC ID': 12,
  Feature: 28,
  'Test Scenario': 140,
  Preconditions: 90,
  'Test Steps': 120,
  'Expected Result': 60,
  'Actual Result': 90,
  Priority: 10,
}

function cellForPdf(header: string, value: string): string {
  const max = CELL_MAX_PDF[header] ?? 100
  return truncate(value || '', max)
}

export function renderQaTableHtml(rows: Record<string, string>[]): string {
  const colgroup = `<colgroup>
    <col style="width:7%" /><col style="width:11%" /><col style="width:18%" /><col style="width:14%" />
    <col style="width:16%" /><col style="width:12%" /><col style="width:14%" /><col style="width:8%" />
  </colgroup>`
  const headers = QA_TABLE_HEADERS.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')
  const body =
    rows.length === 0
      ? `<tr><td colspan="${QA_TABLE_HEADERS.length}">No browser test cases executed.</td></tr>`
      : rows
          .map((r) => {
            const tds = QA_TABLE_HEADERS.map((h) => {
              const raw = r[h] || ''
              const shown = cellForPdf(h, raw)
              const title = raw.length > shown.length ? ` title="${escapeHtml(raw)}"` : ''
              return `<td${title}>${escapeHtml(shown)}</td>`
            }).join('')
            return `<tr>${tds}</tr>`
          })
          .join('')
  return `<div class="qa-table-wrap"><table class="qa-table">${colgroup}<thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** UTF-8 CSV with BOM — opens cleanly in Excel as a proper sheet. */
export function buildQaExcelCsv(rows: Record<string, string>[]): string {
  const esc = (v: string) => {
    const s = (v || '').replace(/\r?\n/g, ' ').trim()
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [QA_TABLE_HEADERS.join(',')]
  for (const r of rows) {
    lines.push(QA_TABLE_HEADERS.map((h) => esc(r[h] || '')).join(','))
  }
  // BOM helps Excel detect UTF-8
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function downloadQaExcel(
  rows: Record<string, string>[],
  filenameBase: string,
): void {
  const name = `${filenameBase || 'qa-report'}.csv`
  const blob = new Blob([buildQaExcelCsv(rows)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function renderObservationsHtml(obs: string[], rec: string[]): string {
  const o = (obs.length ? obs : ['None']).map((x) => `<li>${escapeHtml(x)}</li>`).join('')
  const r = (rec.length ? rec : ['None']).map((x) => `<li>${escapeHtml(x)}</li>`).join('')
  return `<div class="qa-obs">
  <h3>Observations</h3><ul>${o}</ul>
  <h3>Recommendations</h3><ul>${r}</ul>
</div>`
}

export function renderEvidenceHtml(steps: AgentReportStep[]): string {
  const shots = (steps || []).filter((s) => s.screenshotDataUrl)
  if (!shots.length) return ''
  const cards = shots
    .map((s) => {
      const cap = escapeHtml(truncate(s.thought || `Step ${s.step}`, 80))
      return `<figure class="qa-evidence"><img src="${s.screenshotDataUrl}" alt="${cap}" /><figcaption>${cap}</figcaption></figure>`
    })
    .join('')
  return `<h2>Evidence</h2><div class="qa-evidence-grid">${cards}</div>`
}
