import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import {
  copyText,
  downloadHtml,
  extractMentionedFiles,
  printAsPdf,
  type ReportMeta,
} from '../messageExport'

type Props = {
  content: string
  title?: string
  /** User prompt that produced this assistant reply */
  prompt?: string
  sessionId?: string | null
  onOpenFile?: (path: string) => void
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
  onOpenFile,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [username, setUsername] = useState(cachedUsername || '')
  const mentioned = useMemo(() => extractMentionedFiles(content), [content])

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

  const run = async (key: string, fn: () => void | Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
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
          onClick={() =>
            void run('html', async () => {
              const user = username || (await resolveUsername())
              downloadHtml(content, { ...reportMeta(), username: user })
            })
          }
          title="Download as HTML file"
        >
          <span aria-hidden>📄</span>
          HTML
        </button>
        <button
          type="button"
          className={btn}
          disabled={!!busy}
          onClick={() =>
            void run('pdf', async () => {
              const user = username || (await resolveUsername())
              const meta = { ...reportMeta(), username: user }
              if (!printAsPdf(content, meta)) {
                window.alert(
                  'Could not open the print dialog. An HTML file was downloaded instead — open it and use Print → Save as PDF.',
                )
              }
            })
          }
          title="Open print dialog — choose Save as PDF"
        >
          <span aria-hidden>⇩</span>
          PDF
        </button>
      </div>

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
