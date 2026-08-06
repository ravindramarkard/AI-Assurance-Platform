/** AgentBrowser QA report helpers (HTML/PDF export + Excel). */

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

/** Columns matching AI Assistant Test Execution report PDF. */
export const EXECUTION_TABLE_HEADERS = [
  'TC ID',
  'Test Scenario',
  'Status',
  'Duration',
  'Evidence / Notes',
] as const

export type ScreenshotArchiveMode = 'always' | 'on_failure' | 'never'

export type AgentReportStep = {
  step: number
  url?: string
  pageTitle?: string
  thought?: string
  /** Full thought/actions blob for failure detection (not truncated). */
  evidenceText?: string
  actions: string[]
  details: string[]
  screenshotPath?: string
  screenshotDataUrl?: string
  /** ISO timestamp when the step event was recorded */
  createdAt?: string
}

export type ExecutionRow = {
  'TC ID': string
  'Test Scenario': string
  /** Reference Test Execution Report uses PASS / FAIL / BLOCKED / N/A */
  Status: 'PASS' | 'FAIL' | 'BLOCKED' | 'N/A'
  Duration: string
  'Evidence / Notes': string
  failed: boolean
  screenshotDataUrl?: string
  /** Category / section label for grouping (from user plan when present) */
  section?: string
  Feature?: string
}

/** A test case row pasted by the user (planned suite). */
export type PlannedTestCase = {
  section: string
  'TC ID': string
  Feature: string
  'Test Scenario': string
  Preconditions: string
  'Test Steps': string
  'Expected Result': string
  Priority: string
}

function splitPipeCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function isSepRow(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)
}

function normalizeHeader(h: string): string {
  return (h || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Parse user-pasted markdown test plans like:
 *   # 1. General Questions
 *   | TC ID | Feature | Test Scenario | ... |
 *   | GEN-001 | ... |
 */
export function parsePlannedTestCases(markdown: string): PlannedTestCase[] {
  const text = (markdown || '').replace(/\r\n/g, '\n')
  if (!text.trim()) return []
  const lines = text.split('\n')
  const out: PlannedTestCase[] = []
  let section = 'Planned Cases'
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/)
    if (heading) {
      section = heading[1].replace(/^\d+\.\s*/, '').trim() || section
      // Keep leading number if present in original for display
      const withNum = heading[1].trim()
      if (withNum) section = withNum
      i++
      continue
    }

    if (/^\s*\|/.test(line) && /tc\s*id/i.test(line)) {
      const headers = splitPipeCells(line).map(normalizeHeader)
      const idx = {
        tc: headers.findIndex((h) => h === 'tc id' || h === 'tcid' || h === 'id'),
        feature: headers.findIndex((h) => h === 'feature'),
        scenario: headers.findIndex((h) => h === 'test scenario' || h === 'scenario'),
        pre: headers.findIndex((h) => h === 'preconditions' || h === 'precondition'),
        steps: headers.findIndex((h) => h === 'test steps' || h === 'steps'),
        expected: headers.findIndex((h) => h === 'expected result' || h === 'expected'),
        priority: headers.findIndex((h) => h === 'priority'),
      }
      if (idx.tc < 0) {
        i++
        continue
      }
      i++
      if (i < lines.length && isSepRow(lines[i])) i++
      while (i < lines.length && /^\s*\|/.test(lines[i]) && !isSepRow(lines[i])) {
        const cells = splitPipeCells(lines[i])
        const tcId = (cells[idx.tc] || '').trim()
        i++
        if (!tcId || /^-+$/.test(tcId)) continue
        out.push({
          section,
          'TC ID': tcId,
          Feature: idx.feature >= 0 ? cells[idx.feature] || '' : section,
          'Test Scenario':
            idx.scenario >= 0 ? cells[idx.scenario] || tcId : cells[1] || tcId,
          Preconditions: idx.pre >= 0 ? cells[idx.pre] || 'N/A' : 'N/A',
          'Test Steps': idx.steps >= 0 ? cells[idx.steps] || 'N/A' : 'N/A',
          'Expected Result':
            idx.expected >= 0 ? cells[idx.expected] || 'As specified' : 'As specified',
          Priority: idx.priority >= 0 ? cells[idx.priority] || 'Medium' : 'Medium',
        })
      }
      continue
    }
    i++
  }
  return out
}

function tokenizeForMatch(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|for|with|from|that|this|ask|user)$/.test(w))
}

function scorePlanAgainstStep(plan: PlannedTestCase, step: AgentReportStep): number {
  const blob = [
    step.evidenceText || '',
    step.thought || '',
    ...(step.actions || []),
    step.pageTitle || '',
    step.url || '',
  ]
    .join(' ')
    .toLowerCase()
  if (blob.includes(plan['TC ID'].toLowerCase())) return 100

  let score = 0
  const phrases = [plan['Test Scenario'], plan['Test Steps'], plan['Expected Result'], plan.Feature]
  for (const phrase of phrases) {
    const p = (phrase || '')
      .toLowerCase()
      .replace(/['"]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (p.length >= 6 && blob.includes(p)) {
      score += 40
      continue
    }
    // Partial phrase (first meaningful chunk)
    const chunk = p.slice(0, Math.min(28, p.length)).trim()
    if (chunk.length >= 6 && blob.includes(chunk)) score += 25
  }

  const tokens = [
    ...tokenizeForMatch(plan['Test Scenario']),
    ...tokenizeForMatch(plan['Test Steps']),
    ...tokenizeForMatch(plan.Feature),
  ]
  if (tokens.length) {
    let hits = 0
    for (const t of tokens) {
      if (blob.includes(t)) hits += 1
    }
    score += (hits / tokens.length) * 50
  }
  return score
}

/**
 * When the user pasted a TC plan, build report rows from that plan and
 * fill Status / Duration / Evidence from matching session steps.
 * Unmatched planned cases become BLOCKED (not executed).
 */
export function buildExecutionRowsFromPlan(
  plan: PlannedTestCase[],
  steps: AgentReportStep[],
): ExecutionRow[] {
  const usable = (steps || []).filter(
    (s) => (s.actions || []).length > 0 || s.screenshotPath || s.screenshotDataUrl,
  )
  const used = new Set<number>()
  const rows: ExecutionRow[] = []
  let prevTs: number | null = null

  for (const p of plan) {
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < usable.length; i++) {
      if (used.has(i)) continue
      const score = scorePlanAgainstStep(p, usable[i])
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    const matched = bestIdx >= 0 && bestScore >= 8 ? usable[bestIdx] : null
    if (matched) used.add(bestIdx)

    if (!matched) {
      rows.push({
        'TC ID': p['TC ID'],
        'Test Scenario': p['Test Scenario'],
        Status: 'BLOCKED',
        Duration: '—',
        'Evidence / Notes':
          'Not executed in this session. ' +
          (p.Preconditions && p.Preconditions !== 'N/A'
            ? `Preconditions: ${p.Preconditions}.`
            : 'Awaiting run evidence.'),
        failed: false,
        section: p.section,
        Feature: p.Feature,
      })
      continue
    }

    const failed = stepHasError(matched)
    const blocked = !failed && stepLooksBlocked(matched)
    const status: ExecutionRow['Status'] = failed ? 'FAIL' : blocked ? 'BLOCKED' : 'PASS'
    const ts = stepTimestampMs(matched)
    let duration = '—'
    if (ts != null && prevTs != null && ts >= prevTs) duration = formatDurationMs(ts - prevTs)
    if (ts != null) prevTs = ts

    const expected = (p['Expected Result'] || '').trim()
    let notes = evidenceNotesFromStep(matched, failed)
    if (expected && expected !== 'As specified') {
      notes = failed
        ? `${notes} Expected: ${expected}.`
        : `Met expected result (${expected}). ${notes}`
    }

    rows.push({
      'TC ID': p['TC ID'],
      'Test Scenario': p['Test Scenario'],
      Status: status,
      Duration: duration,
      'Evidence / Notes': notes,
      failed,
      screenshotDataUrl: matched.screenshotDataUrl,
      section: p.section,
      Feature: p.Feature,
    })
  }
  return rows
}

/** Prefer user plan when present; otherwise session-derived AB-TC rows. */
export function buildReportExecutionRows(
  steps: AgentReportStep[],
  opts?: { taskTheme?: string; startUrl?: string; planText?: string },
): { rows: ExecutionRow[]; fromPlan: boolean; plan: PlannedTestCase[] } {
  const plan = parsePlannedTestCases(opts?.planText || '')
  if (plan.length > 0) {
    return { rows: buildExecutionRowsFromPlan(plan, steps), fromPlan: true, plan }
  }
  return {
    rows: buildExecutionRows(steps, opts),
    fromPlan: false,
    plan: [],
  }
}

export function groupExecutionRowsBySection(rows: ExecutionRow[]): Map<string, ExecutionRow[]> {
  const groups = new Map<string, ExecutionRow[]>()
  for (const r of rows || []) {
    const key = (r.section || r.Feature || 'Browser Session').trim() || 'Browser Session'
    const list = groups.get(key) || []
    list.push(r)
    groups.set(key, list)
  }
  return groups
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

export function stepTimestampMs(step: AgentReportStep): number | null {
  if (step.createdAt) {
    const t = Date.parse(step.createdAt)
    if (Number.isFinite(t)) return t
  }
  const timeDetail = (step.details || []).find((d) => /^Time:\s*/i.test(d))
  if (timeDetail) {
    const t = Date.parse(timeDetail.replace(/^Time:\s*/i, '').trim())
    if (Number.isFinite(t)) return t
  }
  return null
}

/** Overall run duration from first→last step timestamps. */
export function sessionDurationLabel(steps: AgentReportStep[]): string {
  const times = (steps || []).map(stepTimestampMs).filter((t): t is number => t != null)
  if (times.length < 2) {
    if (times.length === 1) return formatDurationMs(0)
    return '—'
  }
  return formatDurationMs(Math.max(...times) - Math.min(...times))
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

function cleanEvidenceText(s: string): string {
  return (s || '')
    .replace(/<secret>[\s\S]*?<\/secret>/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
}

function fieldFromEvidence(blob: string, key: string): string {
  const re = new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[a-z_]+:|$)`, 'i')
  const m = (blob || '').match(re)
  return m?.[1] ? cleanEvidenceText(m[1]) : ''
}

/** Turn raw tool/action lines into short plain-English phrases (for Evidence / Notes). */
export function plainActionPhrase(action: string): string {
  const raw = cleanEvidenceText(action)
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (/^error\b/i.test(raw) || /\berror\b/i.test(raw) && /net::|timeout|selector|certificate|ssl/i.test(raw)) {
    return cleanEvidenceText(
      raw
        .replace(/^error:\s*/i, '')
        .replace(/^Error\s*—\s*/i, '')
        .replace(/net::/gi, ''),
    )
  }
  if (/^navigate\b/i.test(raw) || lower.includes('navigate')) {
    const url = raw.match(/https?:\/\/\S+/)?.[0]
    return url ? `Opened ${url}` : 'Opened the target page'
  }
  if (/^click\b/i.test(raw)) {
    if (/index\s*=/i.test(raw)) return 'Clicked the on-page control'
    const label = raw.replace(/^click\s*[—:\-]\s*/i, '').trim()
    return label && label.length < 60 ? `Clicked ${label}` : 'Clicked the on-page control'
  }
  if (/^type\b|^input\b|^fill\b/i.test(raw)) {
    if (/password|secret|redacted/i.test(raw)) return 'Entered credentials'
    return 'Entered text into the field'
  }
  if (/^write\b|file_name\s*=/i.test(raw)) {
    const name = raw.match(/file_name\s*=\s*['"]?([^'"\s,]+)/i)?.[1]
    return name ? `Wrote file ${name}` : 'Wrote an output file'
  }
  if (/^scroll\b/i.test(raw)) return 'Scrolled the page'
  if (/^wait\b/i.test(raw)) return 'Waited for the page to settle'
  if (/^done\b/i.test(raw)) return 'Marked the step complete'
  // Drop opaque index=/xpath dumps
  if (/index\s*=\s*\d+/i.test(raw) && raw.length > 80) return 'Interacted with the page'
  return truncate(raw.replace(/\bindex\s*=\s*\d+/gi, '').replace(/\s{2,}/g, ' ').trim(), 160)
}

/** Short intent for the Scenario column — what was attempted. */
export function scenarioFromStep(step: AgentReportStep): string {
  const blob = step.evidenceText || ''
  const nextGoal = fieldFromEvidence(blob, 'next_goal')
  if (nextGoal) return truncate(nextGoal, 220)

  const action = (step.actions || []).find((a) => a && !/^error\b/i.test(a))
  if (action) {
    const phrase = plainActionPhrase(action)
    if (step.pageTitle) return truncate(`${phrase} on “${cleanEvidenceText(step.pageTitle)}”`, 220)
    return truncate(phrase || cleanEvidenceText(action), 220)
  }

  let thought = cleanEvidenceText(step.thought || '')
  thought = thought
    .replace(/^evaluation_previous_goal:\s*/i, '')
    .replace(/^Failed\.\s*/i, '')
    .trim()
  if (thought) return truncate(thought, 220)
  if (step.pageTitle) return cleanEvidenceText(step.pageTitle)
  if (step.url) return `Browse ${step.url}`
  return `Step ${step.step}`
}

/**
 * Evidence / Notes — one clear outcome sentence (like the reference PDF).
 * Prefer evaluation / result narrative; avoid raw tool dumps (index=, secrets, stacks).
 */
export function evidenceNotesFromStep(step: AgentReportStep, failed: boolean): string {
  const blob = step.evidenceText || ''
  const evaluation = fieldFromEvidence(blob, 'evaluation_previous_goal')
  const memory = fieldFromEvidence(blob, 'memory')
  const pageSummary = fieldFromEvidence(blob, 'page_summary')

  const errRaw =
    [...(step.details || []), ...(step.actions || [])].find((x) => /error|fail/i.test(x)) || ''
  const errPlain = errRaw ? plainActionPhrase(errRaw) : ''

  const actionPhrases = (step.actions || [])
    .filter((a) => a && !/^error\b/i.test(a))
    .map(plainActionPhrase)
    .filter(Boolean)
    .slice(0, 4)

  const sentences: string[] = []

  if (failed) {
    if (evaluation) {
      sentences.push(evaluation.replace(/^Failed\.\s*/i, 'Failed: ').replace(/^Success[.:]\s*/i, ''))
    } else if (errPlain) {
      sentences.push(`Failed: ${errPlain}`)
    } else {
      sentences.push('Failed: step reported an error during execution.')
    }
    if (actionPhrases.length) {
      sentences.push(`Attempted: ${actionPhrases.join('; ')}.`)
    }
  } else {
    // PASS / BLOCKED — outcome narrative first
    if (evaluation && !/^success\.?\s*$/i.test(evaluation)) {
      sentences.push(evaluation.replace(/^Success[.:]\s*/i, ''))
    } else if (pageSummary) {
      sentences.push(pageSummary)
    } else if (memory && memory.length > 20) {
      sentences.push(memory)
    } else if (actionPhrases.length) {
      sentences.push(`${actionPhrases.join('; ')}.`)
    } else {
      sentences.push('Executed as observed during the session.')
    }
  }

  // Optional location cue (short) — not a raw dump
  if (step.pageTitle && !sentences.join(' ').toLowerCase().includes(step.pageTitle.toLowerCase().slice(0, 24))) {
    sentences.push(`Page: ${cleanEvidenceText(step.pageTitle)}.`)
  } else if (step.url && sentences.join(' ').length < 80) {
    sentences.push(`URL: ${step.url}.`)
  }

  const out = sentences
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+\./g, '.')
    .replace(/\.\s*\./g, '.')

  return truncate(out || 'Executed as observed.', 600)
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

export function agentStepHasError(step: AgentReportStep): boolean {
  const blob = [
    step.evidenceText || '',
    ...(step.actions || []),
    ...(step.details || []),
    step.thought || '',
  ].join('\n')
  return /(?:^|\b)error\b|^\s*failed\b|\bfailed\.|\bfail\s*[—\-:]|\bassertion\s+fail/im.test(
    blob,
  )
}

function stepHasError(step: AgentReportStep): boolean {
  return agentStepHasError(step)
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

export function normalizeScreenshotArchiveMode(
  value: string | null | undefined,
  opts?: { headless?: boolean },
): ScreenshotArchiveMode {
  const v = (value || '').trim().toLowerCase()
  if (v === 'always' || v === 'on_failure' || v === 'never') return v
  if (opts && typeof opts.headless === 'boolean') {
    return opts.headless ? 'on_failure' : 'always'
  }
  return 'on_failure'
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
      'Test Scenario': scenarioFromStep(step),
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

function stepLooksBlocked(step: AgentReportStep): boolean {
  const blob = [step.evidenceText || '', step.thought || '', ...(step.actions || [])].join('\n')
  return /blocked|not\s*tested|requires\s+user|awaiting\s+upload|cannot\s+test|out\s+of\s+scope|not\s+run|manual\s+only/i.test(
    blob,
  )
}

/** Rows shaped like the reference Test Execution Report PDF table. */
export function buildExecutionRows(
  steps: AgentReportStep[],
  opts?: { taskTheme?: string; startUrl?: string },
): ExecutionRow[] {
  const rows: ExecutionRow[] = []
  let n = 0
  let prevTs: number | null = null
  for (const step of steps || []) {
    const hasActions = (step.actions || []).length > 0
    const hasShot = Boolean(step.screenshotPath || step.screenshotDataUrl)
    if (!hasActions && !hasShot) continue
    n += 1
    const failed = stepHasError(step)
    const blocked = !failed && stepLooksBlocked(step)
    const status: ExecutionRow['Status'] = failed ? 'FAIL' : blocked ? 'BLOCKED' : 'PASS'
    const ts = stepTimestampMs(step)
    let duration = '—'
    if (ts != null && prevTs != null && ts >= prevTs) {
      duration = formatDurationMs(ts - prevTs)
    } else if (ts != null && prevTs == null) {
      // First timed step — show as run start marker
      duration = '—'
    }
    if (ts != null) prevTs = ts
    rows.push({
      'TC ID': formatTcId('AB', n),
      'Test Scenario': scenarioFromStep(step),
      Status: status,
      Duration: duration,
      'Evidence / Notes': evidenceNotesFromStep(step, failed),
      failed,
      screenshotDataUrl: step.screenshotDataUrl,
    })
  }
  return rows
}

export type QaCounts = {
  passed: number
  failed: number
  blocked: number
  partial: number
  notExecuted: number
  total: number
  verdict: 'PASS' | 'FAIL' | 'N/A'
}

export function summarizeExecutionRows(rows: ExecutionRow[]): QaCounts {
  let passed = 0
  let failed = 0
  let blocked = 0
  let partial = 0
  for (const r of rows || []) {
    if (r.Status === 'FAIL') failed += 1
    else if (r.Status === 'PASS') passed += 1
    else if (r.Status === 'BLOCKED') blocked += 1
    else if (r.Status === 'N/A') partial += 1
  }
  const total = (rows || []).length
  let verdict: QaCounts['verdict'] = 'N/A'
  if (failed > 0) verdict = 'FAIL'
  else if (passed > 0) verdict = 'PASS'
  return { passed, failed, blocked, partial, notExecuted: blocked, total, verdict }
}

export type CriticalIssue = {
  tcId: string
  title: string
  severity: 'High' | 'Medium' | 'Low'
  error: string
  impact: string
  recommendation: string
}

export function buildCriticalIssues(rows: ExecutionRow[]): CriticalIssue[] {
  return (rows || [])
    .filter((r) => r.Status === 'FAIL' || r.failed)
    .map((r) => {
      const err = (r['Evidence / Notes'] || r['Test Scenario'] || 'Failure').trim()
      const high = /error|cert|ssl|timeout|crash|exception|not a constructor|denied|selector|not found/i.test(
        err,
      )
      return {
        tcId: r['TC ID'],
        title: truncate(r['Test Scenario'] || 'Failed step', 120),
        severity: high ? 'High' : 'Medium',
        error: truncate(err, 400),
        impact: 'Blocks verification of this path until the failure is resolved.',
        recommendation: high
          ? 'Fix the underlying error, then re-run this test case and capture a fresh failure screenshot if it still fails.'
          : 'Investigate selectors/timing or environment prerequisites, then re-run.',
      }
    })
}

export function buildAgentObservations(steps: AgentReportStep[]): {
  observations: string[]
  recommendations: string[]
} {
  const failed = (steps || []).filter(stepHasError)
  if (!failed.length) {
    return {
      observations: [],
      recommendations: [
        'Re-run after UI or flow changes; keep key paths covered.',
        'Keep Screenshot archive on failure so bug reports include visual evidence.',
      ],
    }
  }
  const observations = failed.map(
    (s) =>
      `Step ${s.step}: ${truncate(s.thought || s.actions?.[0] || 'failure', 200)}`,
  )
  const recommendations = [
    'Fix critical failures first (errors, SSL, timeouts), then re-run the failed TC IDs.',
    'Confirm target URL, credentials, and required uploads before retrying blocked paths.',
    'Attach failure screenshots when logging Jira issues for failed steps.',
  ]
  return { observations, recommendations }
}

/** Soft caps for the dense 8-column Excel/HTML sheet only (not the 4-col exec table). */
const CELL_MAX_PDF: Record<string, number> = {
  'TC ID': 12,
  Feature: 40,
  'Test Scenario': 400,
  Preconditions: 200,
  'Test Steps': 500,
  'Expected Result': 120,
  'Actual Result': 400,
  Priority: 10,
  Status: 24,
  'Evidence / Notes': 800,
}

function cellForPdf(header: string, value: string): string {
  const max = CELL_MAX_PDF[header] ?? 200
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

/** Test Execution Report table: TC ID | Test Scenario | Status | Duration | Evidence / Notes */
export function renderExecutionTableHtml(rows: ExecutionRow[]): string {
  const colgroup = `<colgroup>
    <col class="tc" /><col class="scenario" /><col class="status" /><col class="duration" /><col class="notes" />
  </colgroup>`
  const headers = EXECUTION_TABLE_HEADERS.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join(
    '',
  )
  const body =
    rows.length === 0
      ? `<tr><td colspan="5">No browser test cases executed.</td></tr>`
      : rows
          .map((r) => {
            const status = (r.Status || 'N/A').toUpperCase()
            const statusClass =
              status === 'FAIL'
                ? 'status-fail'
                : status === 'PASS'
                  ? 'status-pass'
                  : status === 'BLOCKED'
                    ? 'status-blocked'
                    : 'status-na'
            const statusCell = `<strong class="${statusClass}">${escapeHtml(status)}</strong>`
            return `<tr>
              <td>${escapeHtml(r['TC ID'])}</td>
              <td class="cell-wrap">${escapeHtml(r['Test Scenario'])}</td>
              <td class="status-cell">${statusCell}</td>
              <td class="duration-cell">${escapeHtml(r.Duration || '—')}</td>
              <td class="cell-wrap">${escapeHtml(r['Evidence / Notes'])}</td>
            </tr>`
          })
          .join('')
  return `<table class="exec-table">${colgroup}<thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`
}

/** Numbered category block matching the reference Test Execution Report. */
export function renderExecutionSectionHtml(
  sectionIndex: number,
  category: string,
  rows: ExecutionRow[],
): string {
  const first = rows[0]?.['TC ID'] || ''
  const last = rows[rows.length - 1]?.['TC ID'] || first
  const range = first && last ? ` (${first} to ${last})` : ''
  const passed = rows.filter((r) => r.Status === 'PASS').length
  const total = rows.length
  return `<h2>${sectionIndex}. ${escapeHtml(category)}${escapeHtml(range)}</h2>
  ${renderExecutionTableHtml(rows)}
  <p class="section-result"><strong>Section Result:</strong> ${passed}/${total} Passed</p>`
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

/** Screenshots in report, gated by Screenshot archive setting. */
export function renderEvidenceHtml(
  steps: AgentReportStep[],
  mode: ScreenshotArchiveMode = 'on_failure',
): string {
  if (mode === 'never') {
    return `<p class="muted">Screenshot archive is <strong>Never</strong> — step screenshots are not included in this report.</p>`
  }
  const withShots = (steps || []).filter((s) => s.screenshotDataUrl)
  const shots =
    mode === 'always' ? withShots : withShots.filter((s) => agentStepHasError(s))
  if (!shots.length) {
    return `<p class="muted">No screenshots available for archive mode <strong>${mode === 'always' ? 'Always' : 'On failure only'}</strong>.</p>`
  }
  const cards = shots
    .map((s) => {
      const mark = agentStepHasError(s) ? ' (Fail)' : ''
      const cap = escapeHtml(`Step ${s.step}${mark}: ${truncate(s.thought || 'screenshot', 80)}`)
      return `<figure class="qa-evidence"><img src="${s.screenshotDataUrl}" alt="${cap}" /><figcaption>${cap}</figcaption></figure>`
    })
    .join('')
  return `<div class="qa-evidence-grid">${cards}</div>`
}
