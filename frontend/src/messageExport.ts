/** Client-side copy / HTML / PDF export for assistant messages. */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
    // markdown table
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

    // Collect a paragraph. Must always advance `i` — lines that look like list/table
    // markers but failed the stricter parsers above used to stall here forever
    // (RangeError: Invalid array length from unbounded parts.push).
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
  /** User prompt that requested this report / answer */
  prompt?: string
  /** ISO or display timestamp; defaults to now */
  timestamp?: string
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
  // Inline SVG — works offline in HTML download and print-to-PDF
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
      max-width: 800px;
      margin: 0 auto;
      padding: 28px 24px 64px;
      color: #1f2937;
      background: #fff;
    }
    h1 { font-size: 1.35rem; margin: 0 0 0.75rem; color: #111827; }
    p { margin: 0 0 0.85rem; }
    ol, ul { margin: 0 0 1rem; padding-left: 1.35rem; }
    li { margin: 0.35rem 0; }
    .report-body table { width: 100%; border-collapse: collapse; margin: 0.75rem 0 1.25rem; font-size: 0.95rem; }
    .report-body th, .report-body td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
    .report-body th { background: #f3f4f6; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; }
    a { color: #2563eb; }
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
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
      font-size: 0.9rem;
      background: #fff;
    }
    .meta-table th,
    .meta-table td {
      border: none;
      border-top: 1px solid #fed7aa;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    .meta-table th {
      width: 118px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }
    .meta-table td {
      color: #111827;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .meta-table tr.row-title th { background: #fff7ed; color: #c2410c; }
    .meta-table tr.row-title td { background: #fffbeb; font-weight: 600; font-size: 0.98rem; }
    .meta-table tr.row-user th { background: #eff6ff; color: #1d4ed8; }
    .meta-table tr.row-user td { background: #f8fafc; }
    .meta-table tr.row-prompt th { background: #ecfdf5; color: #047857; }
    .meta-table tr.row-prompt td { background: #f8fafc; }
    .meta-table tr.row-time th { background: #f1f5f9; color: #334155; }
    .meta-table tr.row-time td { background: #fafafa; color: #374151; }
    .chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .chip-user { background: #dbeafe; color: #1e40af; }
    .chip-time { background: #e2e8f0; color: #334155; }
    .report-footer {
      margin-top: 2.5rem;
      padding-top: 0.85rem;
      border-top: 1px solid #fed7aa;
      text-align: center;
      color: #9a3412;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .report-footer .ab-icon { display: inline-block; }
    @media print {
      @page { margin: 16mm 14mm 18mm; }
      body { padding: 0 0 28px; max-width: none; }
      a { color: inherit; text-decoration: none; }
      .report-header { break-inside: avoid; box-shadow: none; }
      .report-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        margin: 0;
        padding: 6px 0 0;
        border-top: 1px solid #fdba74;
        background: #fff;
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
  ${body}
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

/**
 * Open the system print dialog (user can choose "Save as PDF").
 * Uses a hidden iframe — `window.open(..., 'noopener')` returns null in Chrome
 * and popup blockers often block blank windows, so that path never reached print.
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

  const doPrint = () => {
    try {
      win.focus()
      win.print()
    } catch {
      cleanup()
      downloadHtml(content, titleOrMeta)
      return
    }
    // Remove iframe after print UI closes (or shortly if afterprint never fires)
    win.addEventListener('afterprint', cleanup, { once: true })
    setTimeout(cleanup, 60_000)
  }

  // document.write content is usually ready immediately; small delay for layout/CSS
  setTimeout(doPrint, 100)
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
