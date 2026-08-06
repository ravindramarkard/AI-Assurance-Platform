import { useEffect, useRef, useState } from 'react'
import { api, type Event, type FileEntry } from '../api'
import {
  contentToHtmlBody,
  downloadHtml,
  printAsPdf,
  type ReportPreviewPayload,
} from '../messageExport'
import { usePreferences } from '../preferences'
import EventLogsPanel from './EventLogsPanel'

type Shot = { kind: 'b64' | 'url'; value: string } | null

type NonReportTab = 'browser' | 'files' | 'logs'
type Tab = NonReportTab | 'report'

type Props = {
  sessionId: string | null
  screenshot: Shot
  url: string
  events: Event[]
  status?: string
  tab?: Tab
  onTabChange?: (t: NonReportTab) => void
  focusFile?: string | null
  onHide?: () => void
  reportPreview?: ReportPreviewPayload | null
  onCloseReport?: () => void
  /** Pixel width of the panel (resizable from the parent). */
  width?: number
}

function IconHidePanel({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  )
}

function IconLogs({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19V5M4 19h16" strokeLinecap="round" />
      <path d="M8 15v-4M12 15V8M16 15v-6" strokeLinecap="round" />
    </svg>
  )
}

function IconClose({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

export default function RightPanel({
  sessionId,
  screenshot,
  url,
  events,
  status,
  tab: controlledTab,
  onTabChange,
  focusFile,
  onHide,
  reportPreview = null,
  onCloseReport,
  width = 560,
}: Props) {
  const { t: tr } = usePreferences()
  const [internalTab, setInternalTab] = useState<Tab>('browser')
  const tab = controlledTab ?? internalTab
  const setTab = (t: Tab) => {
    if (t !== 'report') onTabChange?.(t)
    setInternalTab(t)
  }

  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [fileView, setFileView] = useState<'preview' | 'source'>('preview')
  const [fileTabOpen, setFileTabOpen] = useState(false)
  const [gifBusy, setGifBusy] = useState(false)
  const [gifError, setGifError] = useState<string | null>(null)
  const autoGifForSession = useRef<string | null>(null)

  const shotFrameCount = files.filter(
    (f) =>
      !f.is_dir &&
      /^screenshots\/(live|step)_\d+\.png$/i.test(f.path.replace(/\\/g, '/')),
  ).length

  const recordingEntry = files.find(
    (f) => !f.is_dir && /(?:^|\/)recording\.gif$/i.test(f.path.replace(/\\/g, '/')),
  )
  const sessionIdle =
    status !== 'running' && status !== 'queued' && status !== 'thinking'

  const isHtml = (path: string | null) => !!path && /\.html?$/i.test(path)
  const isPdf = (path: string | null) => !!path && /\.pdf$/i.test(path)
  const isImage = (path: string | null) =>
    !!path && /\.(png|jpe?g|gif|webp|svg)$/i.test(path)
  const isMarkdown = (path: string | null) => !!path && /\.md$/i.test(path)

  const fileName = selected ? selected.split('/').pop() || selected : null
  const shortFile =
    fileName && fileName.length > 22 ? `${fileName.slice(0, 18)}…` : fileName

  const refreshFiles = async () => {
    if (!sessionId) {
      setFiles([])
      return
    }
    try {
      const list = await api.listFiles(sessionId)
      setFiles(list)
      if (!selected) {
        const report =
          list.find((f) => !f.is_dir && f.name.toLowerCase() === 'report.html') ||
          list.find((f) => !f.is_dir && f.path.toLowerCase().endsWith('/report.html'))
        if (report) {
          void openFile(report.path, list)
        }
      }
    } catch {
      setFiles([])
    }
  }

  useEffect(() => {
    setSelected(null)
    setContent('')
    setFileView('preview')
    setFileTabOpen(false)
    setGifError(null)
    autoGifForSession.current = null
    void refreshFiles()
  }, [sessionId])

  useEffect(() => {
    const last = events[events.length - 1]
    if (!last) return
    if (
      last.type === 'file_written' ||
      last.type === 'files' ||
      last.type === 'step' ||
      last.type === 'done' ||
      last.type === 'recording_gif'
    ) {
      void refreshFiles()
    }
  }, [events, sessionId])

  // Auto-build GIF for older sessions that finished before server-side auto-GIF
  useEffect(() => {
    if (!sessionId || !sessionIdle) return
    if (shotFrameCount < 2) return
    if (recordingEntry) {
      autoGifForSession.current = sessionId
      return
    }
    if (autoGifForSession.current === sessionId) return
    autoGifForSession.current = sessionId
    let cancelled = false
    setGifBusy(true)
    setGifError(null)
    void (async () => {
      try {
        await api.createRecordingGif(sessionId)
        if (!cancelled) await refreshFiles()
      } catch (e) {
        if (!cancelled) {
          setGifError(e instanceof Error ? e.message : 'GIF generation failed')
          autoGifForSession.current = null
        }
      } finally {
        if (!cancelled) setGifBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshFiles is stable enough per session
  }, [sessionId, sessionIdle, shotFrameCount, recordingEntry?.path])

  useEffect(() => {
    if (!focusFile || !sessionId) return
    void openFile(focusFile)
  }, [focusFile, sessionId])

  const resolveListedPath = (path: string, listing: FileEntry[]) => {
    const exact = listing.find((f) => !f.is_dir && f.path === path)
    if (exact) return exact.path
    const byName = listing.find(
      (f) =>
        !f.is_dir &&
        (f.name === path || f.path.endsWith(`/${path}`) || f.name === path.split('/').pop()),
    )
    return byName?.path || path
  }

  const openFile = async (path: string, listOverride?: FileEntry[]) => {
    if (!sessionId) return
    const listing = listOverride || files
    const resolved = resolveListedPath(path, listing)
    setSelected(resolved)
    setFileTabOpen(true)
    setTab('files')
    setFileView('preview')
    try {
      if (isImage(resolved) || isPdf(resolved)) {
        // Binary — preview via raw URL; still resolve canonical path
        try {
          const f = await api.readFile(sessionId, resolved)
          if (f.path && f.path !== resolved) setSelected(f.path)
        } catch {
          /* keep resolved */
        }
        setContent('')
        return
      }
      const f = await api.readFile(sessionId, resolved)
      if (f.path && f.path !== resolved) setSelected(f.path)
      setContent(f.content)
    } catch {
      setContent(`File not found in workspace: ${resolved}`)
    }
  }

  const closeFileTab = () => {
    setFileTabOpen(false)
    setSelected(null)
    setContent('')
  }

  const recordingSrc =
    sessionId && recordingEntry && sessionIdle
      ? `${api.fileRawUrl(sessionId, recordingEntry.path)}?t=${recordingEntry.size || 0}`
      : null

  const liveSrc =
    screenshot?.kind === 'b64'
      ? `data:image/png;base64,${screenshot.value}`
      : screenshot?.value || null

  const imgSrc = recordingSrc || liveSrc
  const showingRecording = !!recordingSrc

  const fileCount = files.filter((f) => !f.is_dir).length

  const folders = new Map<string, FileEntry[]>()
  for (const f of files.filter((x) => !x.is_dir)) {
    const parts = f.path.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    const list = folders.get(dir) || []
    list.push(f)
    folders.set(dir, list)
  }

  const showFilePreview = tab === 'files' && fileTabOpen && !!selected

  return (
    <section
      className="flex flex-col bg-ink-950 border-l border-line flex-shrink-0 min-w-0"
      style={{ width, maxWidth: '72vw' }}
    >
      {/* Tab bar — Snaps / Artifacts / file tab / Event Logs + Hide */}
      <div className="h-10 border-b border-line flex items-center bg-ink-900 px-1.5 flex-shrink-0 gap-0.5">
        <button
          type="button"
          onClick={() => setTab('browser')}
          className={`${tab === 'browser' ? 'tab-active' : 'tab-inactive'} px-3 py-1.5 text-[13px] font-medium rounded-md flex items-center gap-2`}
        >
          <span>⊡</span>
          <span>{tr('snaps')}</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${status === 'running' ? 'bg-green-400 pulse-dot' : 'bg-slate-600'}`}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('files')
            setFileTabOpen(false)
          }}
          className={`${tab === 'files' && !fileTabOpen ? 'tab-active' : 'tab-inactive'} px-3 py-1.5 text-[13px] font-medium rounded-md flex items-center gap-2`}
        >
          <span>📄</span>
          <span>{tr('artifacts')}</span>
          {fileCount > 0 && (
            <span className="text-[11px] bg-ink-700 text-slate-300 px-1.5 rounded-full">{fileCount}</span>
          )}
        </button>

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

        {fileTabOpen && selected && fileName && (
          <button
            type="button"
            onClick={() => {
              setTab('files')
              setFileTabOpen(true)
            }}
            className={`${showFilePreview ? 'tab-active' : 'tab-inactive'} px-2.5 py-1.5 text-[13px] font-medium rounded-md flex items-center gap-1.5 max-w-[140px]`}
            title={fileName}
          >
            <span className="text-bu-400">📄</span>
            <span className="truncate">{shortFile}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                closeFileTab()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  closeFileTab()
                }
              }}
              className="text-slate-500 hover:text-slate-200 p-0.5"
              title="Close"
            >
              <IconClose />
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setTab('logs')}
          className={`${tab === 'logs' ? 'tab-active' : 'tab-inactive'} px-3 py-1.5 text-[13px] font-medium rounded-md flex items-center gap-2`}
        >
          <IconLogs className="w-3.5 h-3.5" />
          <span>{tr('eventLogs')}</span>
        </button>

        <div className="flex-1" />

        {onHide && (
          <button
            type="button"
            onClick={onHide}
            title={tr('hideSnapsPanel')}
            className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:bg-ink-800 hover:text-slate-200 flex-shrink-0"
            aria-label={tr('hideSnapsPanel')}
          >
            <IconHidePanel />
          </button>
        )}
      </div>

      {tab === 'browser' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="h-9 bg-ink-800 flex items-center px-2 gap-1 text-xs flex-shrink-0">
            <div className="flex gap-1 mr-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
            </div>
            <div className="flex-1 bg-ink-900 border border-line rounded px-2 py-1 mono text-[11px] text-slate-300 truncate">
              {url || 'about:blank'}
            </div>
          </div>
          <div className="flex-1 overflow-auto scroll bg-ink-850 flex items-center justify-center">
            {imgSrc ? (
              <img
                src={imgSrc}
                alt={showingRecording ? 'Session recording' : 'Snap preview'}
                className="max-w-full h-auto"
              />
            ) : (
              <div className="text-slate-500 text-sm p-8 text-center max-w-xs space-y-2">
                {gifBusy ? (
                  <>
                    <div className="spin mx-auto w-5 h-5 border-2 border-bu-500 border-t-transparent rounded-full" />
                    <p>Building recording GIF…</p>
                  </>
                ) : status === 'running' || status === 'queued' ? (
                  <>
                    <div className="spin mx-auto w-5 h-5 border-2 border-bu-500 border-t-transparent rounded-full" />
                    <p>{tr('waitingFrame')}</p>
                  </>
                ) : status === 'failed' ? (
                  <p>
                    No preview — browser didn&apos;t start. Restart with{' '}
                    <span className="mono text-slate-300">./start.sh</span> in Terminal.
                  </p>
                ) : (
                  <p>{tr('noPreview')}</p>
                )}
              </div>
            )}
          </div>
          <div className="h-8 bg-ink-800 border-t border-line flex items-center px-3 text-[10px] text-slate-500 gap-3">
            <span className="flex items-center gap-1 min-w-0 truncate">
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status === 'running' ? 'bg-bu-500 pulse-dot' : 'bg-slate-600'}`}
              />
              {status === 'running' ? tr('agentInControl') : status || tr('idle')}
            </span>
            <span className="ml-auto flex-shrink-0 text-slate-400">
              {gifBusy
                ? 'Building GIF…'
                : showingRecording
                  ? `Recording · ${shotFrameCount || '—'} frames`
                  : shotFrameCount > 0
                    ? `${shotFrameCount} frames`
                    : null}
            </span>
          </div>
          {gifError && tab === 'browser' && (
            <div className="px-3 py-1.5 text-[11px] text-red-300 bg-ink-900 border-t border-red-900/40">
              {gifError}
            </div>
          )}
        </div>
      )}

      {tab === 'files' && !showFilePreview && (
        <div className="flex-1 flex min-h-0">
          <div className="w-52 border-r border-line overflow-y-auto scroll p-2 text-xs">
            <div className="flex items-center justify-between px-2 mb-2 gap-1">
              <span className="text-slate-500">{tr('workspace')}</span>
              <button className="text-slate-500 hover:text-white" onClick={() => void refreshFiles()} title="Refresh">
                ↻
              </button>
            </div>
            {gifBusy && (
              <div className="px-2 mb-2 text-[10px] text-slate-400">Building recording GIF…</div>
            )}
            {gifError && (
              <div className="px-2 mb-2 text-[10px] text-red-300 leading-snug">{gifError}</div>
            )}
            {!sessionId && <div className="text-slate-500 px-2">No session</div>}
            {sessionId && fileCount === 0 && (
              <div className="text-slate-500 px-2 leading-relaxed">
                Empty workspace.
                <br />
                Agent-written files show up here.
              </div>
            )}
            {[...folders.entries()].map(([dir, list]) => (
              <div key={dir || '__root'} className="mb-2">
                {dir ? (
                  <div className="px-2 py-1 text-slate-500 font-semibold truncate">📁 {dir}</div>
                ) : null}
                {list.map((f) => (
                  <div
                    key={f.path}
                    onClick={() => void openFile(f.path)}
                    className={`ml-1 px-2 py-1 rounded cursor-pointer truncate flex items-center gap-1.5 ${
                      selected === f.path
                        ? 'bg-ink-800 text-bu-400 border-l-2 border-bu-500'
                        : 'hover:bg-ink-800 text-slate-300'
                    }`}
                    title={f.size === 0 ? `${f.name} (empty)` : f.name}
                  >
                    <span className="truncate">📄 {f.name}</span>
                    {f.size === 0 && (
                      <span className="text-[10px] text-slate-600 flex-shrink-0">empty</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-6">
            Select a file to preview
          </div>
        </div>
      )}

      {showFilePreview && selected && sessionId && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Filename only — no size, open, or download (as marked) */}
          <div className="h-9 border-b border-line flex items-center px-3 gap-2 text-xs flex-shrink-0 bg-ink-900">
            <span className="text-bu-400">📄</span>
            <span className="truncate flex-1 text-slate-200 font-medium">{fileName}</span>
            {(isHtml(selected) || isMarkdown(selected)) && (
              <div className="flex rounded border border-line overflow-hidden">
                <button
                  type="button"
                  onClick={() => setFileView('preview')}
                  className={`px-2 py-0.5 ${
                    fileView === 'preview' ? 'bg-bu-500/20 text-bu-400' : 'hover:bg-ink-800 text-slate-400'
                  }`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setFileView('source')}
                  className={`px-2 py-0.5 border-l border-line ${
                    fileView === 'source' ? 'bg-bu-500/20 text-bu-400' : 'hover:bg-ink-800 text-slate-400'
                  }`}
                >
                  Source
                </button>
              </div>
            )}
            {(isPdf(selected) || isHtml(selected) || isMarkdown(selected) || isImage(selected)) && (
              <>
                <a
                  href={api.fileRawUrl(sessionId, selected)}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded border border-line text-slate-300 hover:border-bu-500/50"
                  title="Open in new tab"
                >
                  Open
                </a>
                <a
                  href={api.fileRawUrl(sessionId, selected)}
                  download={fileName || undefined}
                  className="px-2 py-0.5 rounded border border-line text-slate-300 hover:border-bu-500/50"
                  title="Download file"
                >
                  ↓
                </a>
              </>
            )}
          </div>
          <div className="flex-1 overflow-auto scroll bg-ink-900 min-h-0 flex flex-col">
            {isPdf(selected) && (
              <iframe
                key={selected}
                title={selected}
                src={api.fileRawUrl(sessionId, selected)}
                className="w-full flex-1 min-h-[480px] border-0 bg-ink-850"
              />
            )}
            {isHtml(selected) && fileView === 'preview' && (
              content.trim() ? (
                <iframe
                  key={`${selected}:${content.length}`}
                  title={selected}
                  srcDoc={content}
                  className="w-full flex-1 min-h-[420px] border-0 bg-white"
                  sandbox="allow-same-origin allow-popups allow-forms"
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-6 text-center">
                  This HTML file is empty.
                </div>
              )
            )}
            {isMarkdown(selected) && fileView === 'preview' && (
              content.trim() ? (
                <div
                  className="flex-1 overflow-auto scroll p-4 text-[14px] leading-[1.55] text-slate-200 md-preview"
                  dangerouslySetInnerHTML={{ __html: contentToHtmlBody(content) }}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm p-6 text-center gap-2">
                  <div className="text-2xl opacity-40">📝</div>
                  <p>
                    <span className="text-slate-300 font-medium">{fileName}</span> is empty.
                  </p>
                  <p className="text-[12px] text-slate-600 max-w-xs">
                    The agent created this placeholder file but hasn&apos;t written any content yet.
                    Ask it to update the markdown, or open another artifact (e.g. a report).
                  </p>
                </div>
              )
            )}
            {isImage(selected) && (
              <div className="p-3 flex items-center justify-center min-h-full bg-ink-850">
                <img
                  src={api.fileRawUrl(sessionId, selected)}
                  alt={selected}
                  className="max-w-full max-h-[70vh] object-contain"
                />
              </div>
            )}
            {!isImage(selected) &&
              !isPdf(selected) &&
              ((!isHtml(selected) && !isMarkdown(selected)) || fileView === 'source') && (
              content.trim() || fileView === 'source' ? (
                <pre
                  className={`p-3 text-[11px] text-slate-300 mono whitespace-pre-wrap ${
                    isMarkdown(selected) ? 'leading-relaxed' : ''
                  }`}
                >
                  {content || '(empty file)'}
                </pre>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-6">
                  This file is empty.
                </div>
              )
            )}
          </div>
        </div>
      )}

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

      {tab === 'logs' && <EventLogsPanel events={events} sessionId={sessionId} />}
    </section>
  )
}
