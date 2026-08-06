import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type CreateScheduledJobBody,
  type Event,
  type HitlPending,
  type Message,
  type Session,
} from '../api'
import { suggestFollowUps } from '../followUpPrompts'
import { contentToHtmlBody } from '../messageExport'
import type { ReportPreviewPayload } from '../messageExport'
import { usePreferences } from '../preferences'
import { isSessionLive, sessionStatusClass, sessionStatusLabel } from '../sessionStatus'
import { thoughtCopyText } from '../thoughtCopyText'
import CopyIconButton from './CopyIconButton'
import HumanInputBanner from './HumanInputBanner'
import ScheduleJobModal from './ScheduleJobModal'
import LogIssueModal from './LogIssueModal'
import MessageActions from './MessageActions'
import VoiceInputButton from './VoiceInputButton'

type Props = {
  session: Session | null
  sessions?: Session[]
  messages: Message[]
  events: Event[]
  llmReady?: boolean | null
  onSend: (content: string) => Promise<void>
  onControl: (action: 'pause' | 'resume' | 'stop') => void
  /** Delete current session and leave the workspace */
  onClearSession?: () => void
  onOpenFile?: (path: string) => void
  onPreviewReport?: (payload: ReportPreviewPayload) => void
  onScheduled?: () => void
  onOpenScheduled?: () => void
  onOpenSession?: (id: string) => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 1000))}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

type ToolKind = 'browser' | 'files' | 'other'

type ToolCall = {
  kind: ToolKind
  title: string
  code: string
  outputLines: string[]
  /** Full done()/report body — render as markdown like browser-use Output */
  outputMarkdown?: string
  filePath?: string
}

type TimelineItem =
  | { kind: 'message'; message: Message }
  | {
      kind: 'agent_block'
      steps: Event[]
      files: Event[]
      thoughtMs: number
      plan: string[]
      thoughtBody: string
      note?: string
    }
  | { kind: 'error'; event: Event }

function kv(action: string): Record<string, string> {
  const out: Record<string, string> = {}
  // match key=value or key='value' / key="value"
  const re = /(\w+)=('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|[^,]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(action))) {
    let v = m[2].trim()
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

function actionName(action: string): string {
  const i = action.indexOf(':')
  return (i >= 0 ? action.slice(0, i) : action).trim().toLowerCase()
}

function humanTitle(action: string): string {
  const name = actionName(action)
  const p = kv(action)
  switch (name) {
    case 'navigate':
    case 'go_to_url':
    case 'goto':
      return p.url ? `Navigate to ${shortUrl(p.url)}` : 'Navigate'
    case 'go_back':
      return p.description || 'Go back'
    case 'click':
      return p.index ? `Click element #${p.index}` : 'Click'
    case 'input':
    case 'type':
    case 'fill':
      return p.text != null
        ? `Type “${truncate(p.text, 28)}”`
        : 'Type into field'
    case 'wait':
      return p.seconds ? `Wait ${p.seconds}s` : 'Wait'
    case 'scroll':
      return 'Scroll page'
    case 'extract':
    case 'extract_content':
      return 'Extract page content'
    case 'screenshot':
      return 'Take screenshot'
    case 'write_file':
    case 'append_file':
      return p.file_name || p.filename || p.path || 'Write file'
    case 'read_file':
      return `Read ${p.file_name || p.path || 'file'}`
    case 'done':
      return 'Complete task'
    case 'search':
      return p.query ? `Search “${truncate(p.query, 32)}”` : 'Search'
    case 'select_dropdown':
      return 'Select dropdown option'
    case 'send_keys':
      return p.keys ? `Press ${p.keys}` : 'Send keys'
    case 'error':
      return 'Error'
    default:
      return name.replace(/_/g, ' ')
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 36 ? `${u.pathname.slice(0, 34)}…` : u.pathname
    return `${u.host}${path}`
  } catch {
    return truncate(url, 48)
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function planItemToString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const key of ['title', 'task', 'content', 'text', 'goal', 'id'] as const) {
      const val = o[key]
      if (val != null && String(val).trim()) return String(val).trim()
    }
    return ''
  }
  return String(v).trim()
}

function isChildWaitingForInput(c: Session): boolean {
  if (c.status === 'waiting_for_input') return true
  const hitl = c.hitl_pending
  if (hitl && typeof hitl === 'object') return true
  if (typeof hitl === 'string' && hitl.trim()) return true
  return false
}

function actionToCode(action: string): string {
  const name = actionName(action)
  const p = kv(action)
  switch (name) {
    case 'navigate':
    case 'go_to_url':
    case 'goto':
      return [
        `const page = await session.getPage()`,
        `await page.goto(${JSON.stringify(p.url || '')})`,
        `await page.waitForLoadState('networkidle')`,
        `const title = await page.title()`,
        `console.log('Title:', title)`,
      ].join('\n')
    case 'go_back':
      return [
        `const page = await session.getPage()`,
        `await page.goBack()`,
        `await page.waitForLoadState('domcontentloaded')`,
      ].join('\n')
    case 'click':
      return [
        `const page = await session.getPage()`,
        p.index
          ? `await page.locator('[data-index="${p.index}"]').click()`
          : `await page.click(${JSON.stringify(p.selector || 'button')})`,
      ].join('\n')
    case 'input':
    case 'type':
    case 'fill':
      return [
        `const page = await session.getPage()`,
        p.index
          ? `await page.locator('[data-index="${p.index}"]').fill(${JSON.stringify(p.text ?? '')})`
          : `await page.fill(${JSON.stringify(p.selector || 'input')}, ${JSON.stringify(p.text ?? '')})`,
      ].join('\n')
    case 'wait':
      return `await page.waitForTimeout(${Number(p.seconds || 1) * 1000})`
    case 'write_file':
    case 'append_file': {
      const fname = p.file_name || p.filename || p.path || 'output.txt'
      const preview = truncate((p.content || '').replace(/\\n/g, '\n'), 120)
      return [
        `await fs.writeFile(`,
        `  ${JSON.stringify(fname)},`,
        `  ${JSON.stringify(preview)}${preview.length >= 120 ? ' + "…"' : ''}`,
        `)`,
      ].join('\n')
    }
    case 'done': {
      const full = unescapeActionText(p.text || 'Task complete')
      // Code preview stays short; Output panel shows the full text as-is
      const preview = full.length > 120 ? `${full.slice(0, 117)}…` : full
      return [
        `return {`,
        `  success: ${p.success ?? 'true'},`,
        `  text: ${JSON.stringify(preview)}`,
        `}`,
      ].join('\n')
    }
    case 'send_keys':
      return `await page.keyboard.press(${JSON.stringify(p.keys || 'Enter')})`
    case 'scroll':
      return `await page.mouse.wheel(0, ${p.amount || 600})`
    case 'error':
      return `throw new Error(${JSON.stringify(truncate(action.replace(/^error:\s*/i, ''), 160))})`
    default:
      return `// ${action}`
  }
}

function unescapeActionText(s: string): string {
  return (s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function actionToOutput(action: string, step: Event): { lines: string[]; markdown?: string } {
  const name = actionName(action)
  const p = kv(action)
  const lines: string[] = []
  if (step.payload.title) lines.push(`Title: ${String(step.payload.title)}`)
  if (step.payload.url) lines.push(`URL: ${String(step.payload.url)}`)
  if (step.payload.screenshot) lines.push('(1 screenshot attached)')

  if (name === 'done') {
    const raw = p.text || p.data || ''
    const full = unescapeActionText(raw).trim()
    // Show full done text as-is (browser-use Output), not a 180-char flat line
    if (full) {
      return { lines, markdown: full }
    }
  }
  if (name === 'write_file' || name === 'append_file') {
    const fname = sanitizeFileLabel(p.file_name || p.filename || p.path || 'file')
    lines.push(`Wrote ${fname}`)
  }
  if (name === 'error') lines.push(truncate(action.replace(/^error:\s*/i, ''), 200))
  if (name === 'input' || name === 'type' || name === 'fill') {
    lines.push(`Typed into field${p.index ? ` #${p.index}` : ''}`)
  }
  if (name === 'click') lines.push(`Clicked${p.index ? ` element #${p.index}` : ''}`)
  if (name === 'wait') lines.push(`Waited ${p.seconds || 1}s`)
  if (!lines.length) lines.push('OK')
  return { lines }
}

/** Reject prose / markdown fragments mistaken for filenames. */
function sanitizeFileLabel(name: string): string {
  const raw = (name || '').replace(/\\n/g, '\n').trim()
  const first = raw.split(/[\n\r]/)[0]?.trim() || 'file'
  if (first.length > 120) return `${first.slice(0, 117)}…`
  // Drop labels that look like sentence fragments, not files
  if (!/\.[a-z0-9]{1,8}$/i.test(first) && /[\s:]/.test(first)) return 'file'
  if (/^(the|and|with|from|key|points|validation|structure|accuracy)\b/i.test(first)) {
    return 'file'
  }
  return first
}

function isPlausibleFileName(name: string): boolean {
  const n = sanitizeFileLabel(name)
  if (!n || n === 'file') return false
  if (/[\n\r]/.test(name)) return false
  if (!/\.[a-z0-9]{1,8}$/i.test(n)) return false
  if (n.length > 120) return false
  return true
}

function toToolCall(action: string, step: Event): ToolCall {
  const name = actionName(action)
  const p = kv(action)
  const isFile = name.includes('file') || name === 'write_file' || name === 'append_file'
  const out = actionToOutput(action, step)
  const filePath = p.file_name || p.filename || p.path
  return {
    kind: isFile ? 'files' : name === 'done' ? 'other' : 'browser',
    title: humanTitle(action),
    code: actionToCode(action),
    outputLines: out.lines,
    outputMarkdown: out.markdown,
    filePath: filePath && isPlausibleFileName(filePath) ? filePath : undefined,
  }
}

function extractPlan(steps: Event[]): { plan: string[]; thoughtBody: string } {
  const plan: string[] = []
  let thoughtBody = ''

  for (const e of steps) {
    const fields = (e.payload.thought_fields || {}) as Record<string, string>
    const thinking = fields.thinking || String(e.payload.thought || '')
    if (!thoughtBody && thinking) thoughtBody = thinking

    // plan_update may arrive as JSON array string in thought fields
    const rawPlan = (fields as Record<string, unknown>).plan_update
    if (Array.isArray(rawPlan)) {
      for (const item of rawPlan) {
        const s = planItemToString(item)
        if (s && !plan.includes(s)) plan.push(s)
      }
    } else if (typeof rawPlan === 'string') {
      try {
        const parsed = JSON.parse(rawPlan)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const s = planItemToString(item)
            if (s && !plan.includes(s)) plan.push(s)
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Numbered lines inside thinking: "1. Do X"
    for (const line of thinking.split('\n')) {
      const m = line.trim().match(/^\d+[\.)]\s+(.+)/)
      if (m) {
        const s = m[1].trim()
        if (s && !plan.includes(s) && s.length < 160) plan.push(s)
      }
    }
  }

  // Fallback plan from next_goal / memory of early steps
  if (plan.length === 0 && steps.length) {
    const first = (steps[0].payload.thought_fields || {}) as Record<string, string>
    if (first.next_goal) plan.push(first.next_goal)
    const goals = steps
      .map((s) => ((s.payload.thought_fields || {}) as Record<string, string>).next_goal)
      .filter(Boolean) as string[]
    for (const g of goals.slice(0, 6)) {
      if (!plan.includes(g)) plan.push(g)
    }
  }

  return { plan: plan.slice(0, 10), thoughtBody }
}

function labelForKind(kind: ToolKind): string {
  if (kind === 'files') return 'Artifacts'
  if (kind === 'browser') return 'Snaps'
  return 'Agent'
}

function firstUrlInText(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)'"`<>]+/i)
  return m?.[0]
}

function parseHitlPending(session: Session | null, events: Event[]): HitlPending | null {
  if (!session || session.status !== 'waiting_for_input') return null
  const raw = session.hitl_pending
  if (raw && typeof raw === 'object' && raw.request_id && raw.prompt) return raw as HitlPending
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as HitlPending
      if (p?.request_id && p?.prompt) return p
    } catch {
      /* ignore */
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'human_input_required' && e.payload?.prompt) {
      return {
        request_id: String(e.payload.request_id || ''),
        prompt: String(e.payload.prompt),
        input_type: String(e.payload.input_type || 'text'),
      }
    }
  }
  return {
    request_id: '',
    prompt: 'Human input required',
    input_type: 'text',
  }
}

const CHILD_POLL_MS = 2500

function extractSessionPlan(session: Session | null): string[] {
  if (!session) return []
  const out: string[] = []

  const add = (v: unknown) => {
    const s = planItemToString(v)
    if (!s) return
    if (!out.includes(s)) out.push(s)
  }

  const consume = (raw: unknown) => {
    if (!raw) return
    if (Array.isArray(raw)) {
      for (const item of raw) add(item)
      return
    }
    if (typeof raw === 'string') {
      for (const line of raw.split('\n')) {
        const s = line.replace(/^\s*[-*]\s+/, '').trim()
        if (s) add(s)
      }
      return
    }
    if (typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      if (Array.isArray(o.plan)) {
        for (const item of o.plan) add(item)
      }
      if (Array.isArray(o.steps)) {
        for (const item of o.steps) add(item)
      }
      if (Array.isArray(o.items)) {
        for (const item of o.items) add(item)
      }
    }
  }

  if (session.plan_json) {
    try {
      consume(JSON.parse(session.plan_json))
    } catch {
      consume(session.plan_json)
    }
  }
  consume(session.plan)
  return out.slice(0, 12)
}

export default function ChatPanel({
  session,
  sessions = [],
  messages,
  events,
  llmReady = true,
  onSend,
  onControl,
  onClearSession,
  onOpenFile,
  onPreviewReport,
  onScheduled,
  onOpenScheduled,
  onOpenSession,
}: Props) {
  const { t } = usePreferences()
  const canSend = llmReady === true
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceErr, setVoiceErr] = useState('')
  const [expandedThought, setExpandedThought] = useState<Record<string, boolean>>({})
  const [expandedCode, setExpandedCode] = useState<Record<string, boolean>>({})
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [logIssueOpen, setLogIssueOpen] = useState(false)
  const [scheduleToast, setScheduleToast] = useState<string | null>(null)
  const [dismissedFollowUps, setDismissedFollowUps] = useState(false)
  const [stickToBottom, setStickToBottom] = useState(true)
  const [submittingHitl, setSubmittingHitl] = useState(false)
  const [children, setChildren] = useState<Session[]>([])
  const [childrenErr, setChildrenErr] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const NEAR_BOTTOM_PX = 96

  const isNearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = true
    setStickToBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  const onTimelineScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = isNearBottom(el)
    stickToBottomRef.current = near
    setStickToBottom(near)
  }

  const clearSession = () => {
    if (!session) return
    if (!window.confirm(t('clearSessionConfirm'))) return
    if (
      session.status === 'running' ||
      session.status === 'queued' ||
      session.status === 'paused' ||
      session.status === 'thinking' ||
      session.status === 'waiting_for_input' ||
      session.status === 'planning' ||
      session.status === 'aggregating'
    ) {
      onControl('stop')
    }
    onClearSession?.()
  }

  // New suggestions when the session finishes a turn
  useEffect(() => {
    setDismissedFollowUps(false)
  }, [session?.id, session?.status, messages.length])

  // New session → resume auto-follow
  useEffect(() => {
    stickToBottomRef.current = true
    setStickToBottom(true)
  }, [session?.id])

  const thinking = isSessionLive(session?.status)

  const childEventToken = useMemo(() => {
    if (session?.role !== 'orchestrator') return ''
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (String(e.type || '').startsWith('child_')) {
        return String(e.id || e.created_at || i)
      }
    }
    return ''
  }, [events, session?.role])

  const parentLive = isSessionLive(session?.status)

  useEffect(() => {
    if (!session || session.role !== 'orchestrator') {
      setChildren([])
      setChildrenErr('')
      return
    }
    const sessionId = session.id
    let cancelled = false

    const load = () => {
      api
        .listSessionChildren(sessionId)
        .then((list) => {
          if (cancelled) return
          setChildren(list || [])
          setChildrenErr('')
        })
        .catch((e) => {
          if (cancelled) return
          setChildren([])
          setChildrenErr(e instanceof Error ? e.message : 'Failed to load children')
        })
    }

    load()
    // Child status changes (HITL in particular) are not always announced as a
    // child_* event on the parent, so poll while the parent can still change.
    const timer = parentLive ? window.setInterval(load, CHILD_POLL_MS) : undefined
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [session?.id, session?.role, parentLive, childEventToken])

  const followUps = useMemo(() => {
    if (!session || thinking || dismissedFollowUps) return []
    if (session.status === 'running' || session.status === 'queued') return []
    return suggestFollowUps({ session, messages, events })
  }, [session, messages, events, thinking, dismissedFollowUps])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    // Instant while the agent is streaming steps; smooth otherwise
    const behavior: ScrollBehavior =
      session?.status === 'running' || session?.status === 'thinking' ? 'auto' : 'smooth'
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [messages.length, events.length, followUps.length, session?.status, stickToBottom])

  const timeline = useMemo(() => {
    const items: TimelineItem[] = []
    const steps = events.filter((e) => e.type === 'step')
    const fileEvents = events.filter((e) => e.type === 'file_written')
    const errors = events.filter((e) => e.type === 'error')

    const ts = (iso?: string | null) => (iso ? Date.parse(iso) : NaN)

    const buildAgentBlock = (turnSteps: Event[], turnFiles: Event[]) => {
      if (!turnSteps.length && !turnFiles.length) return
      const t0 = turnSteps[0]?.created_at ? ts(turnSteps[0].created_at) : Date.now()
      const t1 = turnSteps[turnSteps.length - 1]?.created_at
        ? ts(turnSteps[turnSteps.length - 1].created_at!)
        : t0
      const { plan, thoughtBody } = extractPlan(turnSteps)
      let note: string | undefined
      for (let i = turnSteps.length - 1; i >= 0; i--) {
        const fields = (turnSteps[i].payload.thought_fields || {}) as Record<string, string>
        note =
          fields.memory ||
          fields.thinking ||
          (turnSteps[i].payload.thought as string) ||
          undefined
        if (note) break
      }
      items.push({
        kind: 'agent_block',
        steps: turnSteps,
        files: turnFiles,
        thoughtMs: Math.max(1000, (t1 || 0) - (t0 || 0) || turnSteps.length * 4000),
        plan,
        thoughtBody,
        note,
      })
    }

    // Chronological turns: user → tools/thought → assistant (so new answers appear below)
    let cursor = 0
    while (cursor < messages.length) {
      const m = messages[cursor]
      if (m.role !== 'user') {
        // Orphan assistant (e.g. system) — show as-is
        items.push({ kind: 'message', message: m })
        cursor++
        continue
      }

      items.push({ kind: 'message', message: m })
      const userT = ts(m.created_at)
      const nextUserIdx = messages.findIndex((x, i) => i > cursor && x.role === 'user')
      const nextUserT =
        nextUserIdx >= 0 ? ts(messages[nextUserIdx].created_at) : Number.POSITIVE_INFINITY

      const seenStep = new Set<string>()
      const turnSteps = steps.filter((s) => {
        const id = s.id || ''
        if (id && seenStep.has(id)) return false
        const t = ts(s.created_at)
        const inTurn =
          !Number.isFinite(t) || !Number.isFinite(userT)
            ? nextUserIdx < 0
            : t >= userT - 500 && t < nextUserT
        if (inTurn && id) seenStep.add(id)
        return inTurn
      })
      const seenFile = new Set<string>()
      const turnFiles = fileEvents.filter((s) => {
        const id = s.id || ''
        if (id && seenFile.has(id)) return false
        const t = ts(s.created_at)
        const inTurn =
          !Number.isFinite(t) || !Number.isFinite(userT)
            ? nextUserIdx < 0
            : t >= userT - 500 && t < nextUserT
        if (inTurn && id) seenFile.add(id)
        return inTurn
      })
      buildAgentBlock(turnSteps, turnFiles)

      cursor++
      while (cursor < messages.length && messages[cursor].role !== 'user') {
        items.push({ kind: 'message', message: messages[cursor] })
        cursor++
      }
    }

    // Steps with no matching user timestamp (legacy) — append once
    if (!messages.some((m) => m.role === 'user') && (steps.length || fileEvents.length)) {
      buildAgentBlock(steps, fileEvents)
    } else if (
      !thinking &&
      (session?.step_count || 0) > 0 &&
      steps.length === 0 &&
      !items.some((it) => it.kind === 'agent_block')
    ) {
      items.push({
        kind: 'agent_block',
        steps: [],
        files: fileEvents,
        thoughtMs: 1000,
        plan: [],
        thoughtBody: '',
        note:
          `Agent reported ${session?.step_count} steps but no thinking was recorded. ` +
          `Usually the local LLM returned empty/invalid JSON.`,
      })
    }

    for (const e of errors) {
      items.push({ kind: 'error', event: e })
    }
    return items
  }, [messages, events, thinking, session?.step_count])

  /** Prompt that produced each assistant message (nearest prior user turn). */
  const promptByAssistantId = useMemo(() => {
    const map = new Map<string, string>()
    let lastUser = session?.task || ''
    for (const m of messages) {
      if (m.role === 'user') lastUser = m.content
      else if (m.role === 'assistant') map.set(m.id, lastUser)
    }
    return map
  }, [messages, session?.task])

  const send = async (raw?: string) => {
    const content = (raw ?? text).trim()
    if (!content || !session || sending || !canSend) return
    setSending(true)
    setText('')
    setDismissedFollowUps(true)
    scrollToBottom('smooth')
    try {
      await onSend(content)
    } finally {
      setSending(false)
    }
  }

  if (!session) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center bg-ink-900 text-slate-500 text-sm">
        <div className="text-4xl mb-3 opacity-40">B</div>
        <p>Select a session or create a new agent</p>
      </main>
    )
  }

  const hitlPending = parseHitlPending(session, events)
  const waitingForInput = session.status === 'waiting_for_input'
  const planOutline = extractSessionPlan(session)
  const waitingChildren = (children || []).filter(isChildWaitingForInput)

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-ink-900">
      <div className="h-12 border-b border-line flex items-center px-4 gap-3 flex-shrink-0">
        <div className="type-title text-slate-100 truncate">{session.title}</div>
        {session.model && (
          <span className="px-2 py-0.5 rounded-full bg-bu-500/10 text-bu-500 text-[11px] font-semibold border border-bu-500/30 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-bu-500" />
            {session.model}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-[12px] text-slate-400">
          <button
            type="button"
            onClick={() => setLogIssueOpen(true)}
            className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-bu-500/60 hover:text-bu-400 text-slate-300 font-medium text-[12px]"
            title={t('logIssue')}
          >
            {t('logIssue')}
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-bu-500/60 hover:text-bu-400 text-slate-300 font-medium text-[12px]"
            title="Schedule this agent task to run on a recurring schedule"
          >
            ⏱ {t('scheduleJob')}
          </button>
          <span className="px-2 py-0.5 rounded bg-ink-800 border border-line text-[11px]">
            {session.step_count} {t('steps')}
          </span>
          <span className="px-2 py-0.5 rounded bg-ink-800 border border-line capitalize text-[11px]">
            {sessionStatusLabel(session.status, t)}
          </span>
          {(session.status === 'running' || session.status === 'thinking') && (
            <>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-amber-500/50 text-amber-300 font-medium text-[12px]"
                onClick={() => onControl('pause')}
                title={t('pause')}
              >
                ⏸ {t('pause')}
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/40 hover:border-red-500/50 text-red-300 font-medium text-[12px]"
                onClick={() => onControl('stop')}
                title={t('stop')}
              >
                ■ {t('stop')}
              </button>
            </>
          )}
          {session.status === 'queued' && (
            <button
              type="button"
              className="px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/40 text-red-300 font-medium text-[12px]"
              onClick={() => onControl('stop')}
              title={t('cancelQueue')}
            >
              ■ {t('cancelQueue')}
            </button>
          )}
          {session.status === 'paused' && (
            <>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-bu-500/50 text-bu-400 font-medium text-[12px]"
                onClick={() => onControl('resume')}
                title={t('resume')}
              >
                ▶ {t('resume')}
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/40 text-red-300 font-medium text-[12px]"
                onClick={() => onControl('stop')}
                title={t('stop')}
              >
                ■ {t('stop')}
              </button>
            </>
          )}
          {waitingForInput && (
            <button
              type="button"
              className="px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/40 text-red-300 font-medium text-[12px]"
              onClick={() => onControl('stop')}
              title={t('stop')}
            >
              ■ {t('stop')}
            </button>
          )}
          <button
            type="button"
            className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-slate-500 text-slate-300 font-medium text-[12px]"
            onClick={clearSession}
            title={t('clearSession')}
          >
            {t('clear')}
          </button>
        </div>
      </div>

      {hitlPending && (
        <HumanInputBanner
          pending={hitlPending}
          busy={submittingHitl}
          onSubmit={async (value) => {
            setSubmittingHitl(true)
            try {
              await api.submitHumanInput(session.id, {
                value,
                request_id: hitlPending.request_id || undefined,
              })
            } finally {
              setSubmittingHitl(false)
            }
          }}
          onStop={() => onControl('stop')}
        />
      )}

      {scheduleToast && (
        <div className="mx-4 mt-3 text-xs border border-emerald-800/50 bg-emerald-950/40 text-emerald-300 rounded-md px-3 py-2 flex items-center justify-between gap-3">
          <span>{scheduleToast}</span>
          <button
            type="button"
            className="text-bu-400 hover:underline whitespace-nowrap"
            onClick={() => {
              setScheduleToast(null)
              onOpenScheduled?.()
            }}
          >
            View jobs →
          </button>
        </div>
      )}

      {session.role === 'child' && session.parent_id && (
        <div className="mx-4 mt-3 text-xs border border-bu-500/30 bg-bu-500/10 text-slate-200 rounded-md px-3 py-2 flex items-center justify-between gap-3">
          <span className="truncate">
            <span className="text-bu-400 font-semibold mr-1.5">⎇</span>
            {t('subagentOf')}{' '}
            <span className="mono text-slate-300">{String(session.parent_id).slice(0, 8)}…</span>
          </span>
          <button
            type="button"
            disabled={!onOpenSession}
            onClick={() => onOpenSession?.(String(session.parent_id))}
            className="text-bu-400 hover:underline whitespace-nowrap disabled:opacity-50 disabled:hover:no-underline"
            title={t('openParentSession')}
          >
            {t('openParentSession')} →
          </button>
        </div>
      )}

      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollRef}
          onScroll={onTimelineScroll}
          className="flex-1 overflow-y-auto scroll p-6 space-y-5"
        >
        {session.role === 'orchestrator' && (
          <div className="max-w-3xl space-y-4">
            <div className="rounded-xl border border-line/80 bg-ink-850/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-line/50 flex items-center gap-2">
                <span className="text-bu-400 font-semibold">⎇</span>
                <span className="text-slate-200 font-medium">{t('parallelSubagents')}</span>
                <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
                  {(children || []).length} {t('subagents')}
                </span>
              </div>
              <div className="p-4 space-y-4">
                {planOutline.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t('planOutline')}
                    </div>
                    <ol className="list-decimal pl-5 space-y-1.5 text-[14px] text-slate-300 leading-[1.5]">
                      {planOutline.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {childrenErr && (
                  <div className="text-xs border border-red-700/40 bg-red-950/30 text-red-300 rounded-md px-3 py-2">
                    {childrenErr}
                  </div>
                )}

                <div className="overflow-hidden rounded-lg border border-line bg-ink-950/40">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2.5 font-medium">{t('colGoal')}</th>
                        <th className="px-3 py-2.5 font-medium w-[120px]">{t('branchId')}</th>
                        <th className="px-3 py-2.5 font-medium w-[88px]">{t('attempt')}</th>
                        <th className="px-3 py-2.5 font-medium w-[140px]">{t('colStatus')}</th>
                        <th className="px-3 py-2.5 font-medium w-[90px]">{t('open')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(children || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-slate-500 text-sm">
                            {t('noSubagentsYet')}
                          </td>
                        </tr>
                      ) : (
                        (children || []).map((c) => (
                          <tr key={c.id} className="border-b border-line/80 last:border-0">
                            <td className="px-3 py-2.5 align-middle text-slate-200">
                              <span className="truncate block max-w-[340px]">
                                {c.title || c.task || t('untitled')}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 align-middle mono text-[12px] text-slate-400">
                              {c.branch_id ? String(c.branch_id) : '—'}
                            </td>
                            <td className="px-3 py-2.5 align-middle mono text-[12px] text-slate-400">
                              {c.attempt != null ? String(c.attempt) : '—'}
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${sessionStatusClass(
                                  c.status,
                                )}`}
                              >
                                {sessionStatusLabel(c.status, t)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <button
                                type="button"
                                disabled={!onOpenSession}
                                onClick={() => onOpenSession?.(c.id)}
                                className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-bu-500/60 hover:text-bu-400 text-slate-300 font-medium text-[12px] disabled:opacity-50 disabled:hover:border-line disabled:hover:text-slate-300"
                              >
                                {t('open')}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {waitingChildren.length > 0 && (
                  <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-amber-300 font-semibold">
                        {t('waitingChildren')} ({waitingChildren.length})
                      </span>
                      <span className="text-slate-500">{t('waitingForInput')}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {waitingChildren.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!onOpenSession}
                          onClick={() => onOpenSession?.(c.id)}
                          className="px-2.5 py-1 rounded-lg border border-amber-700/40 bg-ink-900 hover:border-amber-500/60 text-amber-200 text-[12px] disabled:opacity-50"
                          title={c.title || c.task || c.id}
                        >
                          {c.title || c.task || c.id.slice(0, 8)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {session.aggregate_report && (
                  <div className="rounded-xl border border-line/80 bg-ink-850/40 overflow-hidden">
                    <div className="px-4 py-3 border-b border-line/50 flex items-center gap-2">
                      <span className="text-bu-400 font-semibold">✦</span>
                      <span className="text-slate-200 font-medium">{t('aggregateReport')}</span>
                    </div>
                    <div
                      className="p-4 text-[14px] leading-[1.55] text-slate-200 md-preview"
                      dangerouslySetInnerHTML={{ __html: contentToHtmlBody(session.aggregate_report) }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {timeline.map((item, idx) => {
          if (item.kind === 'message') {
            const m = item.message
            const msgKey = `msg-${m.id}-${idx}`
            return m.role === 'user' ? (
              <div key={msgKey} className="flex justify-end">
                <div className="relative max-w-2xl accent-fill rounded-2xl rounded-tr-sm px-4 py-3 pr-9 text-[14px] leading-[1.5] whitespace-pre-wrap">
                  {m.content}
                  <div className="absolute bottom-2 right-2">
                    <CopyIconButton
                      text={m.content}
                      title="Copy message"
                      className="opacity-80 hover:opacity-100"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={msgKey}
                className="max-w-3xl text-[14px] leading-[1.5] text-slate-300 bg-ink-800 border border-line rounded-lg px-4 py-3"
              >
                <div
                  className="md-preview chat-md"
                  dangerouslySetInnerHTML={{ __html: contentToHtmlBody(m.content) }}
                />
                <MessageActions
                  content={m.content}
                  title={session?.title || session?.task || 'AgentBrowser report'}
                  prompt={promptByAssistantId.get(m.id) || session?.task || ''}
                  sessionId={session?.id}
                  events={events}
                  onOpenFile={onOpenFile}
                  onPreviewReport={onPreviewReport}
                />
              </div>
            )
          }

          if (item.kind === 'error') {
            return (
              <div
                key={`err-${item.event.id || 'x'}-${idx}`}
                className="max-w-3xl bg-ink-800 border border-red-700/40 rounded-lg p-3 text-xs text-red-300"
              >
                {String(item.event.payload.error || 'Error')}
              </div>
            )
          }

          const blockKey = `block-${idx}-${item.steps[0]?.id || 'empty'}`
          const thoughtOpen = expandedThought[blockKey] !== false
          const thoughtClipboard = thoughtCopyText(
            item.plan,
            item.thoughtBody,
            item.note || '',
          )

          // Flatten tool calls in step order for Browser: cards
          const tools: { key: string; step: Event; tool: ToolCall; stepNo: number }[] = []
          item.steps.forEach((e, i) => {
            const stepNo = (e.payload.step as number | undefined) || i + 1
            const actions = (e.payload.actions as string[] | undefined) || []
            if (actions.length === 0) {
              tools.push({
                key: `${blockKey}-${e.id || i}-${i}-think`,
                step: e,
                stepNo,
                tool: {
                  kind: 'other',
                  title: `Step ${stepNo} — thinking`,
                  code: '// no tool call this step',
                  outputLines: e.payload.url
                    ? [`URL: ${String(e.payload.url)}`]
                    : ['(no actions)'],
                },
              })
              return
            }
            actions.forEach((a, j) => {
              tools.push({
                key: `${blockKey}-${e.id || i}-${i}-${j}`,
                step: e,
                stepNo,
                tool: toToolCall(a, e),
              })
            })
          })

          return (
            <div key={blockKey} className="max-w-3xl space-y-4 text-[14px]">
              {/* Thought for Xs — plan style */}
              <div className="rounded-xl border border-line/80 bg-ink-850/40 overflow-hidden">
                <div className="flex items-stretch">
                  <button
                    type="button"
                    className="min-w-0 flex-1 flex items-center gap-2 px-3 py-2 text-[12px] text-slate-400 hover:text-slate-200 hover:bg-ink-800/50"
                    onClick={() =>
                      setExpandedThought((p) => ({ ...p, [blockKey]: !thoughtOpen }))
                    }
                  >
                    <span className="text-slate-500">▹</span>
                    <span className="font-medium text-[13px] text-slate-300">
                      Thought for {formatDuration(item.thoughtMs)}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>
                      {item.steps.length} steps · {tools.length} tool calls
                    </span>
                    <span className="ml-auto text-slate-600">{thoughtOpen ? '▾' : '▸'}</span>
                  </button>
                  <div className="flex items-center pr-2">
                    <CopyIconButton text={thoughtClipboard} title="Copy thought" />
                  </div>
                </div>

                {thoughtOpen && (
                  <div className="px-4 pb-3 pt-1 border-t border-line/50 space-y-3">
                    {item.plan.length > 0 ? (
                      <ol className="list-decimal pl-5 space-y-1.5 text-[14px] text-slate-300 leading-[1.5]">
                        {item.plan.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ol>
                    ) : item.thoughtBody ? (
                      <pre className="text-[14px] text-slate-300 whitespace-pre-wrap leading-[1.5] font-sans">
                        {item.thoughtBody.length > 1200
                          ? `${item.thoughtBody.slice(0, 1200)}…`
                          : item.thoughtBody}
                      </pre>
                    ) : item.note ? (
                      <pre className="text-xs text-slate-400 whitespace-pre-wrap">{item.note}</pre>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No plan captured for this run.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Browser / Files tool cards */}
              {tools.map(({ key, tool, step }, ti) => {
                const codeOpen = expandedCode[key] !== false
                const shot = step.payload.screenshot
                  ? api.screenshotUrl(session.id, String(step.payload.screenshot))
                  : null
                return (
                  <div key={key} className="space-y-2">
                    <div className="flex items-center gap-2 text-[14px]">
                      <span className="text-bu-400 font-semibold">{labelForKind(tool.kind)}:</span>
                      <span className="text-slate-200 font-medium">{tool.title}</span>
                    </div>

                    <div className="rounded-lg border border-line overflow-hidden bg-ink-950">
                      <div className="flex items-stretch border-b border-line/60">
                        <button
                          type="button"
                          className="min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:text-slate-300"
                          onClick={() =>
                            setExpandedCode((p) => ({ ...p, [key]: !codeOpen }))
                          }
                        >
                          <span className="mono text-slate-400">js</span>
                          <span className="ml-auto">{codeOpen ? '▾' : '▸'}</span>
                        </button>
                        <div className="flex items-center pr-2">
                          <CopyIconButton text={tool.code} title="Copy code" />
                        </div>
                      </div>
                      {codeOpen && (
                        <pre className="px-3 py-3 text-[12px] leading-[1.55] text-slate-200 mono overflow-x-auto scroll whitespace-pre">
                          {tool.code}
                        </pre>
                      )}
                    </div>

                    <div className="rounded-lg border border-line/70 bg-ink-850/60 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-line/50">
                        <span>Output</span>
                        <div className="ml-auto">
                          <CopyIconButton
                            text={
                              tool.outputMarkdown
                                ? [...tool.outputLines, tool.outputMarkdown].filter(Boolean).join('\n')
                                : tool.outputLines.join('\n')
                            }
                            title="Copy output"
                          />
                        </div>
                      </div>
                      <div className="px-3 py-2.5 space-y-1">
                        {tool.outputLines.map((line, li) => (
                          <div key={li} className="text-[12px] text-slate-300 mono whitespace-pre-wrap">
                            {line}
                          </div>
                        ))}
                        {tool.outputMarkdown ? (
                          <div
                            className="md-preview chat-md text-[13px] text-slate-200 mt-1"
                            dangerouslySetInnerHTML={{
                              __html: contentToHtmlBody(tool.outputMarkdown),
                            }}
                          />
                        ) : null}
                        {shot && (
                          <a
                            href={shot}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block mt-2 border border-line rounded overflow-hidden hover:border-bu-500"
                          >
                            <img
                              src={shot}
                              alt="Step screenshot"
                              className="max-h-36 max-w-full object-contain bg-black"
                            />
                          </a>
                        )}
                        {tool.filePath && (
                          <button
                            type="button"
                            onClick={() => onOpenFile?.(tool.filePath!)}
                            className="mt-1 mono text-xs text-blue-300 hover:underline"
                          >
                            Open {tool.filePath.split('/').pop()}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Subtle next-step cue like the screenshot */}
                    {ti < tools.length - 1 && (
                      <div className="pt-1 text-[13px]">
                        <span className="text-bu-400 font-semibold">
                          {labelForKind(tools[ti + 1].tool.kind)}:
                        </span>{' '}
                        <span className="text-slate-400">{tools[ti + 1].tool.title}</span>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Wrote chips from file_written events */}
              <div className="space-y-1">
                {item.files.map((fe, fi) => {
                  const rawName = String(fe.payload.name || fe.payload.path || 'file')
                  if (!isPlausibleFileName(rawName)) return null
                  const name = sanitizeFileLabel(rawName)
                  const path = String(fe.payload.path || name)
                  return (
                    <div key={`${blockKey}-file-${fe.id || path}-${fi}`} className="flex items-center gap-2 py-1 text-sm">
                      <span className="text-slate-400">Wrote</span>
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(path)}
                        className="mono text-xs bg-ink-800 border border-line px-2 py-1 rounded inline-flex items-center gap-1.5 hover:border-bu-500"
                      >
                        <span className="text-blue-400">📄</span>
                        <span className="text-blue-300">{name}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {thinking && (
          <div className="flex items-center gap-2 text-slate-500 text-sm pt-2">
            <span className="spin inline-block w-3 h-3 border-2 border-bu-500 border-t-transparent rounded-full" />
            <span>
              {session.status === 'queued'
                ? (() => {
                    const running = (sessions || []).filter(
                      (s) =>
                        s.status === 'running' ||
                        s.status === 'thinking' ||
                        s.status === 'paused' ||
                        s.status === 'waiting_for_input',
                    ).length
                    return running > 0
                      ? `${t('queued')} (${running})`
                      : t('queued')
                  })()
                : session.status === 'paused'
                  ? t('paused')
                  : session.status === 'waiting_for_input'
                    ? t('waitingForInput')
                  : t('thinking')}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
        </div>
        {!stickToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-line bg-ink-850/95 text-slate-200 text-[12px] font-semibold shadow-xl hover:border-bu-500/50 hover:text-bu-400 backdrop-blur-sm"
            title={t('scrollToLatest')}
            aria-label={t('scrollToLatest')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('scrollToLatest')}
          </button>
        )}
      </div>

      <div className="border-t border-line p-4 flex-shrink-0 bg-ink-900 space-y-2">
        {(session.status === 'running' ||
          session.status === 'thinking' ||
          session.status === 'paused' ||
          session.status === 'queued' ||
          session.status === 'waiting_for_input' ||
          session.status === 'planning' ||
          session.status === 'aggregating') && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-850 px-3 py-2"
            role="toolbar"
            aria-label={t('agentControls')}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">
              {t('agentControls')}
            </span>
            {(session.status === 'running' || session.status === 'thinking') && (
              <button
                type="button"
                onClick={() => onControl('pause')}
                className="px-3 py-1.5 rounded-lg border border-amber-800/50 bg-amber-950/30 text-amber-300 text-[12px] font-semibold hover:border-amber-500/50"
              >
                ⏸ {t('pause')}
              </button>
            )}
            {session.status === 'paused' && (
              <button
                type="button"
                onClick={() => onControl('resume')}
                className="px-3 py-1.5 rounded-lg border border-bu-500/40 bg-bu-500/10 text-bu-400 text-[12px] font-semibold hover:border-bu-500/60"
              >
                ▶ {t('resume')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onControl('stop')}
              className="px-3 py-1.5 rounded-lg border border-red-900/50 bg-red-950/40 text-red-300 text-[12px] font-semibold hover:border-red-500/50"
            >
              ■ {t('stop')}
            </button>
            <button
              type="button"
              onClick={clearSession}
              className="px-3 py-1.5 rounded-lg border border-line bg-ink-900 text-slate-300 text-[12px] font-semibold hover:border-slate-500"
            >
              {t('clearSession')}
            </button>
          </div>
        )}

        {followUps.length > 0 && (
          <div className="rounded-xl border border-line bg-ink-850/80 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('suggestedFollowUps')}
              </div>
              <button
                type="button"
                onClick={() => setDismissedFollowUps(true)}
                className="text-[11px] text-slate-500 hover:text-slate-300"
                title={t('close')}
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {followUps.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending || !canSend}
                  onClick={() => void send(prompt)}
                  className="text-left text-[12px] leading-snug px-2.5 py-1.5 rounded-lg border border-line bg-ink-900 hover:border-bu-500/50 hover:bg-bu-500/10 text-slate-300 transition-colors max-w-full"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5">{t('followUpHint')}</p>
          </div>
        )}
        {(session.status === 'completed' ||
          session.status === 'failed' ||
          session.status === 'stopped' ||
          session.status === 'partial') && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearSession}
              className="text-xs px-3 py-2 rounded-lg border border-line bg-ink-850 hover:border-slate-500 text-slate-300 font-medium"
            >
              {t('clearSession')}
            </button>
          </div>
        )}
        {llmReady === false && (
          <div className="rounded-xl border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-[12px] text-amber-200">
            {t('modelNotConnected')}
          </div>
        )}
        <div className="bg-ink-800 border border-line rounded-2xl p-3 flex items-end gap-2">
          <textarea
            rows={1}
            value={text}
            disabled={!canSend || waitingForInput}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={
              waitingForInput
                ? t('waitingForInput')
                : llmReady === false
                  ? t('modelNotConnected')
                  : t('replyPlaceholder')
            }
            className="flex-1 bg-transparent text-[14px] leading-[1.5] text-slate-200 placeholder-slate-500 resize-none outline-none disabled:cursor-not-allowed"
          />
          {text.trim() && (
            <button
              type="button"
              onClick={() => setText('')}
              className="px-2 py-2 text-[11px] text-slate-500 hover:text-slate-300"
              title={t('clearInput')}
            >
              {t('clear')}
            </button>
          )}
          <VoiceInputButton
            value={text}
            onChange={(next) => {
              setVoiceErr('')
              setText(next)
            }}
            disabled={sending || thinking || !canSend || waitingForInput}
            onError={setVoiceErr}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim() || thinking || !canSend || waitingForInput}
            className="accent-fill disabled:opacity-40 p-2 rounded-lg"
            title={
              !canSend
                ? t('modelNotConnected')
                : waitingForInput
                  ? t('waitingForInput')
                  : thinking
                    ? t('thinking')
                    : undefined
            }
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        {voiceErr && <p className="text-[11px] text-red-400 mt-1.5">{voiceErr}</p>}
        <div className="text-[10px] text-slate-500 mt-2">⏎ send · ⇧⏎ newline · {t('voiceHint')}</div>
      </div>

      {scheduleOpen && (
        <ScheduleJobModal
          defaultModel={session.model || ''}
          sessions={sessions.length ? sessions : [session]}
          title={t('scheduleModalTitle')}
          subtitle={t('scheduleModalSubtitleChat')}
          defaults={{
            sessionId: session.id,
            task: session.task || '',
            name: session.title?.slice(0, 60) || undefined,
            model: session.model || undefined,
            startUrl:
              session.current_url && !session.current_url.startsWith('about:')
                ? session.current_url
                : firstUrlInText(session.task || ''),
          }}
          onClose={() => setScheduleOpen(false)}
          onCreate={async (body: CreateScheduledJobBody) => {
            await api.createScheduledJob(body)
            setScheduleOpen(false)
            setScheduleToast(t('scheduleCreatedToast'))
            onScheduled?.()
            window.setTimeout(() => setScheduleToast(null), 8000)
          }}
        />
      )}

      {logIssueOpen && session && (
        <LogIssueModal
          session={session}
          onClose={() => setLogIssueOpen(false)}
          onDone={() => {
            setScheduleToast(t('issueLoggedToast'))
            window.setTimeout(() => setScheduleToast(null), 8000)
          }}
        />
      )}
    </main>
  )
}
