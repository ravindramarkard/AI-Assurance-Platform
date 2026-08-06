import { useEffect, useMemo, useState } from 'react'
import { api, type Event } from '../api'
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
import { normalizeScreenshotArchiveMode } from '../qaReport'

type Props = {
  content: string
  title?: string
  /** User prompt that produced this assistant reply */
  prompt?: string
  sessionId?: string | null
  /** Session events — used to include step screenshots in HTML/PDF */
  events?: Event[]
  onOpenFile?: (path: string) => void
  onPreviewReport?: (payload: ReportPreviewPayload) => void
}

let cachedUsername: string | null = null

async function resolveUsername(): Promise<string> {
  if (cachedUsername) return cachedUsername
  try {
    const h = await api.health()
    cachedUsername = (h.username || '').trim() || 'Unknown'
  } catch {
    cachedUsername = 'Unknown'
  }
  return cachedUsername
}

export default function MessageActions({
  content,
  title = 'AgentBrowser report',
  prompt,
  sessionId,
  events = [],
  onOpenFile,
  onPreviewReport,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [username, setUsername] = useState(cachedUsername || '')
  const mentioned = useMemo(() => extractMentionedFiles(content), [content])
  const stepCount = useMemo(
    () => (events || []).filter((e) => e.type === 'step').length,
    [events],
  )

  useEffect(() => {
    if (username) return
    void resolveUsername().then(setUsername)
  }, [username])

  const reportMeta = (): ReportMeta => ({
    title,
    username: username || 'Unknown',
    prompt: (prompt || '').trim() || undefined,
    timestamp: new Date().toLocaleString(),
  })

  const buildMetaWithSteps = async (): Promise<ReportMeta> => {
    const user = username || (await resolveUsername())
    let screenshotArchive: ReportMeta['screenshotArchive'] = 'on_failure'
    try {
      const s = await api.getSettings()
      screenshotArchive = normalizeScreenshotArchiveMode(s.screenshot_archive, {
        headless: Boolean(s.headless),
      })
    } catch {
      /* keep default */
    }
    const meta: ReportMeta = { ...reportMeta(), username: user, screenshotArchive }
    if (!sessionId || !events?.length) return meta
    let steps = eventsToReportSteps(events)
    if (!steps.length) return meta
    steps = await embedStepScreenshots(sessionId, steps, api.screenshotUrl, screenshotArchive)
    return { ...meta, steps }
  }

  const run = async (key: string, fn: () => void | Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

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

  const btn =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line bg-ink-900/80 hover:border-bu-500/50 text-[11px] font-medium text-slate-300 disabled:opacity-50'

  return (
    <div className="mt-3 pt-2.5 border-t border-line/60 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={btn}
          disabled={!!busy}
          onClick={() =>
            void run('copy', async () => {
              const ok = await copyText(content)
              if (ok) {
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              }
            })
          }
          title="Copy message text"
        >
          <span aria-hidden>{copied ? '✓' : '⧉'}</span>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!!busy}
          onClick={() => void run('html', openReportPreview)}
          title={
            stepCount > 0
              ? `Preview HTML report with ${stepCount} step screenshot(s)`
              : 'Preview as HTML in the Report panel'
          }
        >
          <span aria-hidden>📄</span>
          {busy === 'html' ? 'Preparing…' : 'HTML'}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!!busy}
          onClick={() => void run('pdf', openReportPreviewOrPrint)}
          title={
            stepCount > 0
              ? `Preview report (PDF download available) with ${stepCount} step screenshot(s)`
              : 'Preview report — download PDF from the Report panel'
          }
        >
          <span aria-hidden>⇩</span>
          {busy === 'pdf' ? 'Preparing…' : 'PDF'}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!!busy}
          onClick={() =>
            void run('excel', async () => {
              const meta = await buildMetaWithSteps()
              downloadExcel(content, meta)
            })
          }
          title="Download test cases as Excel-compatible CSV (proper columns)"
        >
          <span aria-hidden>▦</span>
          {busy === 'excel' ? 'Preparing…' : 'Excel'}
        </button>
      </div>
      {stepCount > 0 && (
        <p className="text-[10px] text-slate-500">
          HTML / PDF open a Report preview ({stepCount} step{stepCount === 1 ? '' : 's'} with
          screenshots). Download from the panel.
        </p>
      )}

      {sessionId && mentioned.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-0.5">
            Files
          </span>
          {mentioned.map((name) => (
            <span key={name} className="inline-flex items-center gap-1">
              <button
                type="button"
                className={btn}
                onClick={() => onOpenFile?.(name)}
                title={`Open ${name} in Artifacts`}
              >
                <span aria-hidden>📂</span>
                {name}
              </button>
              <a
                className={btn}
                href={api.fileRawUrl(sessionId, name)}
                download={name}
                target="_blank"
                rel="noreferrer"
                title={`Download ${name}`}
              >
                ↓
              </a>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
