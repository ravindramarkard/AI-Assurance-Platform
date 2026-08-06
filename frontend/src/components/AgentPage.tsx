import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings } from '../api'
import { usePreferences } from '../preferences'
import VoiceInputButton from './VoiceInputButton'

type Props = {
  settings: AppSettings | null
  llmReady?: boolean | null
  onCreate: (
    task: string,
    model?: string,
    files?: File[],
    runtimeUrl?: string,
    forceParallel?: boolean,
  ) => Promise<void>
  onOpenSettings: () => void
}

type PendingFile = {
  id: string
  file: File
}

const EXAMPLE_PROMPTS = [
  'Get the latest AED to INR exchange rate and summarize it.',
  'Show the homepage of the default URL and describe the main sections.',
  'Open the Application URL and list the navigation links you see.',
  'Search for today’s top tech headlines and list the first five titles.',
  'Go to the default site, take a screenshot, and describe the hero area.',
  'Find the login form on the default page and list its fields.',
  'Check the default URL and report any visible errors or banners.',
]

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function IconInfo({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7.5h.01" strokeLinecap="round" />
    </svg>
  )
}

export default function AgentPage({ settings, llmReady = true, onCreate, onOpenSettings }: Props) {
  const { t } = usePreferences()
  const canSubmit = llmReady === true
  const [task, setTask] = useState('')
  const [runtimeUrl, setRuntimeUrl] = useState('')
  const [forceParallel, setForceParallel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [exampleIndex, setExampleIndex] = useState(0)
  const [attachments, setAttachments] = useState<PendingFile[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const infoRef = useRef<HTMLDivElement>(null)

  const modelLabel = settings?.llm_model || 'local-model'
  const provider = settings?.llm_provider || 'local'
  const applicationUrl = (settings?.application_url || '').trim()

  const liveExample = EXAMPLE_PROMPTS[exampleIndex % EXAMPLE_PROMPTS.length]
  const livePlaceholder = useMemo(
    () => `Try: ${liveExample}`,
    [liveExample],
  )

  // Rotate example prompts in real time
  useEffect(() => {
    const id = window.setInterval(() => {
      setExampleIndex((i) => (i + 1) % EXAMPLE_PROMPTS.length)
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!infoOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!infoRef.current?.contains(e.target as Node)) setInfoOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [infoOpen])

  const addFiles = (list: FileList | File[]) => {
    const next = Array.from(list)
    setAttachments((prev) => {
      const merged = [...prev]
      for (const file of next) {
        if (file.size > 25 * 1024 * 1024) {
          setErr(`"${file.name}" is over 25MB`)
          continue
        }
        if (merged.some((p) => p.file.name === file.name && p.file.size === file.size)) continue
        if (merged.length >= 10) {
          setErr('Max 10 attachments')
          break
        }
        merged.push({ id: crypto.randomUUID(), file })
      }
      return merged
    })
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((p) => p.id !== id))
  }

  const useExample = (prompt: string) => {
    setTask(prompt)
    setInfoOpen(false)
    taRef.current?.focus()
  }

  const submit = async () => {
    if (!task.trim() || busy || !canSubmit) return
    setBusy(true)
    setErr('')
    try {
      await onCreate(
        task.trim(),
        modelLabel,
        attachments.map((a) => a.file),
        runtimeUrl.trim() || undefined,
        forceParallel,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to start agent')
      setBusy(false)
    }
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-ink-950 relative overflow-hidden">
      <div className="h-11 flex items-center px-4 justify-end text-xs text-slate-500 flex-shrink-0">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line bg-ink-900 hover:border-bu-500/50 text-slate-300"
        >
          <span>🔑</span>
          <span>Settings / API</span>
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-3xl flex flex-col items-center">
        <div className="flex flex-col items-center mb-8">
          <div className="w-[4.25rem] h-[4.25rem] rounded-full accent-gradient accent-shadow flex items-center justify-center text-[22px] font-extrabold mb-4">
            AB
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-100 leading-tight" style={{ color: 'var(--fg)' }}>
            {t('agentBrowser')}
          </h1>
          <p className="text-[14px] text-slate-500 mt-1.5" style={{ color: 'var(--fg-muted)' }}>
            {t('localBrowserAgent')} · {provider}
          </p>
          {llmReady === false && (
            <div className="mt-3 max-w-md text-center rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-2.5 text-[13px] text-amber-200">
              <p className="font-medium">{t('modelNotConnected')}</p>
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-1.5 text-[12px] text-bu-400 hover:underline"
              >
                {t('openSettingsToConfigure')}
              </button>
            </div>
          )}
          {llmReady === null && (
            <p className="mt-3 text-[13px] text-slate-500">{t('modelChecking')}</p>
          )}
        </div>

        <div className="w-full">
          <div
            className={`bg-ink-850 border border-line rounded-2xl shadow-2xl focus-within:border-bu-500/40 transition-colors ${
              !canSubmit ? 'opacity-60 pointer-events-none' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!canSubmit) return
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
            }}
          >
            <div className="flex items-start gap-1 px-3 pt-3">
              <textarea
                ref={taRef}
                rows={3}
                value={task}
                disabled={!canSubmit}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                placeholder={task ? t('taskPlaceholder') : livePlaceholder}
                className="flex-1 bg-transparent px-2.5 pt-1.5 pb-2 text-[15px] leading-[1.55] text-slate-100 placeholder-slate-500 resize-none outline-none min-h-[112px] disabled:cursor-not-allowed"
              />
              <div className="relative flex-shrink-0" ref={infoRef}>
                <button
                  type="button"
                  onClick={() => setInfoOpen((v) => !v)}
                  title="Example prompts"
                  className={`mt-1 p-2 rounded-lg transition-colors ${
                    infoOpen
                      ? 'text-bu-400 bg-bu-500/10'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-ink-800'
                  }`}
                  aria-label="Example prompts"
                  aria-expanded={infoOpen}
                >
                  <IconInfo />
                </button>
                {infoOpen && (
                  <div className="absolute right-0 top-10 z-30 w-80 bg-ink-900 border border-line rounded-xl shadow-2xl p-3 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-300 font-medium">Ask with an example</span>
                      <span className="text-[10px] text-bu-400 animate-pulse">Live</span>
                    </div>
                    <p className="text-slate-500 mb-3 leading-relaxed">
                      Prompts rotate in real time. Click one to fill the task box, or watch the
                      placeholder update below.
                    </p>
                    <button
                      type="button"
                      onClick={() => useExample(liveExample)}
                      className="w-full text-left px-3 py-2.5 rounded-lg border border-bu-500/40 bg-bu-500/10 hover:bg-bu-500/20 text-slate-200 mb-2"
                    >
                      <div className="text-[10px] uppercase tracking-wider text-bu-400 mb-1">
                        Now suggesting
                      </div>
                      <div className="leading-relaxed">{liveExample}</div>
                    </button>
                    <div className="space-y-1 max-h-40 overflow-y-auto scroll">
                      {EXAMPLE_PROMPTS.filter((_, i) => i !== exampleIndex % EXAMPLE_PROMPTS.length)
                        .slice(0, 4)
                        .map((ex) => (
                          <button
                            key={ex}
                            type="button"
                            onClick={() => useExample(ex)}
                            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-ink-800 text-slate-400 hover:text-slate-200 leading-relaxed"
                          >
                            {ex}
                          </button>
                        ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setExampleIndex((i) => (i + 1) % EXAMPLE_PROMPTS.length)}
                      className="mt-2 w-full text-center text-bu-400 hover:text-bu-300 py-1.5"
                    >
                      Next example →
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 pb-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                  {t('runtimeUrl')}
                  <span className="normal-case tracking-normal font-normal text-slate-600 ml-1">
                    {t('runtimeUrlOptional')}
                  </span>
                </span>
                <input
                  type="url"
                  value={runtimeUrl}
                  onChange={(e) => setRuntimeUrl(e.target.value)}
                  placeholder={
                    applicationUrl
                      ? `Default: ${applicationUrl}`
                      : 'e.g. https://duckduckgo.com — or set Application URL in Settings'
                  }
                  className="mt-1 w-full bg-ink-900/80 border border-line rounded-lg px-3 py-2 text-xs mono text-slate-300 placeholder-slate-600 outline-none focus:border-bu-500/50"
                />
              </label>
              {applicationUrl && !runtimeUrl.trim() && (
                <p className="mt-1 text-[10px] text-slate-600">{t('usingAppUrl')}</p>
              )}
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={forceParallel}
                  onChange={(e) => setForceParallel(e.target.checked)}
                />
                {t('forceParallel')}
              </label>
              <p className="mt-1 text-[10px] text-slate-600">{t('forceParallelHelp')}</p>
            </div>

            {attachments.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 text-[11px] bg-ink-800 border border-line rounded-lg px-2 py-1 text-slate-300 max-w-full"
                  >
                    <span className="text-blue-400">📄</span>
                    <span className="truncate max-w-[180px]">{a.file.name}</span>
                    <span className="text-slate-600">{formatSize(a.file.size)}</span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-red-400 ml-0.5"
                      onClick={() => removeAttachment(a.id)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between px-3 pb-3 gap-2">
              <div className="flex items-center gap-1 relative">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  title="Attach files"
                  onClick={() => fileRef.current?.click()}
                  className={`p-2 rounded-lg hover:bg-ink-800 ${
                    attachments.length ? 'text-bu-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  📎
                  {attachments.length > 0 && (
                    <span className="ml-0.5 text-[10px] font-semibold">{attachments.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  title="Agent settings"
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-ink-800"
                >
                  ⚙
                </button>
                <VoiceInputButton
                  value={task}
                  onChange={(next) => {
                    setErr('')
                    setTask(next)
                  }}
                  disabled={busy}
                  onError={setErr}
                />

                <button
                  type="button"
                  onClick={() => setModelOpen((v) => !v)}
                  className="accent-chip flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border"
                >
                  <span className="w-3.5 h-3.5 rounded-sm accent-dot" />
                  <span className="max-w-[160px] truncate">{modelLabel}</span>
                  <span className="opacity-60">▾</span>
                </button>

                {modelOpen && (
                  <div className="absolute left-16 top-10 z-20 w-64 bg-ink-900 border border-line rounded-lg shadow-xl p-2 text-xs">
                    <div className="px-2 py-1.5 text-slate-500">Current model</div>
                    <div className="px-2 py-2 text-slate-200 mono truncate">{modelLabel}</div>
                    <div className="px-2 py-1 text-slate-500">Provider: {provider}</div>
                    <button
                      className="mt-1 w-full text-left px-2 py-2 rounded hover:bg-ink-800 text-bu-400"
                      onClick={() => {
                        setModelOpen(false)
                        onOpenSettings()
                      }}
                    >
                      Change in Settings…
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !task.trim() || !canSubmit}
                className="w-11 h-11 rounded-full accent-fill accent-shadow flex items-center justify-center"
                title="Start agent"
              >
                {busy ? (
                  <span className="spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {err && <p className="text-red-400 text-xs mt-3 text-center">{err}</p>}
          <p className="text-[11px] text-slate-600 mt-3 text-center">{t('attachHint')}</p>
          {!task.trim() && (
            <p className="text-[13px] text-slate-500 mt-4 text-center px-4 transition-opacity duration-500">
              <button
                type="button"
                onClick={() => useExample(liveExample)}
                className="accent-text underline-offset-2 hover:underline"
              >
                {liveExample}
              </button>
            </p>
          )}
        </div>
        </div>
      </div>
    </main>
  )
}
