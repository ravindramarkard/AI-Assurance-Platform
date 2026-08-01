import type { Event, Message, Session } from './api'

export type FollowUpContext = {
  session: Session
  messages: Message[]
  events: Event[]
}

function lastOfRole(messages: Message[], role: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role && (messages[i].content || '').trim()) {
      return messages[i].content.trim()
    }
  }
  return ''
}

/** Strip URL-injection preambles so we classify the real user ask. */
function stripTaskPreamble(text: string): string {
  let s = (text || '').trim()
  s = s.replace(
    /^(?:Start by opening|Continue from the last session page:|Reuse the existing session page at)\s+\S+[.\s]*/i,
    '',
  )
  s = s.replace(/^(?:Task|Follow-up task):\s*/im, '')
  s = s.replace(/^Previous user request:\s*/im, '')
  // Keep only the follow-up / task line when wrapped
  const follow = s.match(/Follow-up task:\s*([\s\S]+)$/i)
  if (follow) return follow[1].trim()
  const task = s.match(/\bTask:\s*([\s\S]+)$/i)
  if (task) return task[1].trim()
  return s.trim()
}

function uniq(items: string[], limit = 4): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const s = raw.trim().replace(/\s+/g, ' ')
    if (!s || s.length < 8) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s.length > 120 ? `${s.slice(0, 117)}…` : s)
    if (out.length >= limit) break
  }
  return out
}

type Topic =
  | 'news'
  | 'price'
  | 'login'
  | 'form'
  | 'pdf'
  | 'export'
  | 'hrm'
  | 'greeting'
  | 'jira'
  | 'generic'

/**
 * Classify from the user's ask — not from incidental words in the assistant
 * answer (e.g. a news headline containing "oil prices" must not become FX tips).
 */
function detectTopic(userAsk: string, assistant: string, files: string[]): Topic {
  const u = userAsk.toLowerCase()
  const a = assistant.toLowerCase().slice(0, 800)

  if (/^(hi|hello|hey|yo|hola|howdy)\b/.test(u) && u.length < 40) return 'greeting'
  // Only when the user explicitly asked about Jira/Confluence — never from assistant copy
  if (/\b(jira|confluence)\b/.test(u)) return 'jira'

  // Strong user-intent signals first
  if (/\b(news|headline|headlines|top\s*\d+\s*news|google\s*news)\b/.test(u)) return 'news'
  if (
    /\b(price|prices|exchange|fx|aed|inr|usd|eur|gbp|stock|ticker|quote|convert|conversion|rate)\b/.test(
      u,
    ) &&
    !/\bnews\b/.test(u)
  ) {
    return 'price'
  }
  if (/\b(login|sign\s*in|password|username|auth)\b/.test(u)) return 'login'
  if (/\b(form|fill|submit|checkbox|dropdown)\b/.test(u)) return 'form'
  if (/\b(orangehrm|hrm|employee|leave)\b/.test(u)) return 'hrm'
  if (/\b(pdf|save\s+as\s+pdf)\b/.test(u) || files.some((f) => f.endsWith('.pdf'))) return 'pdf'
  if (/\b(html|report|export|download|csv|markdown|\.md)\b/.test(u)) return 'export'
  if (/\b(search|find|look\s*up|scrape|extract)\b/.test(u)) {
    // search without news → still browse/search follow-ups
    if (/\b(news|headline)\b/.test(a)) return 'news'
    return 'news'
  }

  // Soft fallback from assistant only when user ask is vague
  if (/\b(news|headline|headlines)\b/.test(a)) return 'news'
  if (files.some((f) => /\.(pdf|html?)$/i.test(f))) return files.some((f) => f.endsWith('.pdf')) ? 'pdf' : 'export'
  return 'generic'
}

function mentionedFiles(events: Event[], assistant: string): string[] {
  const names = new Set<string>()
  for (const e of events) {
    if (e.type !== 'file_written') continue
    const n = String(e.payload?.name || e.payload?.path || '')
      .split('/')
      .pop()
    if (n) names.add(n.toLowerCase())
  }
  const re = /\b([a-zA-Z0-9_\-.() ]+\.(?:pdf|html?|md|csv|txt))\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(assistant))) names.add(m[1].trim().toLowerCase())
  return [...names]
}

/** Content-aware follow-up prompts for the current chat turn only. */
export function suggestFollowUps(ctx: FollowUpContext): string[] {
  const { session, messages, events } = ctx

  const rawUser = lastOfRole(messages, 'user') || session.task || ''
  const user = stripTaskPreamble(rawUser)
  const assistant = lastOfRole(messages, 'assistant')
  const files = mentionedFiles(events, assistant)

  const url =
    session.current_url && !session.current_url.startsWith('about:')
      ? session.current_url
      : undefined
  const failed = session.status === 'failed' || !!session.error
  const stopped = session.status === 'stopped'
  const completed = session.status === 'completed'
  const hasSteps = (session.step_count || 0) > 0 || events.some((e) => e.type === 'step')
  const hasPdf = files.some((f) => f.endsWith('.pdf'))
  const hasHtml = files.some((f) => /\.html?$/.test(f))
  const hasMd = files.some((f) => f.endsWith('.md'))

  const topic = detectTopic(user, assistant, files)
  const suggestions: string[] = []

  if (failed) {
    return uniq(
      [
        'Retry the same task and continue from where it failed',
        'Explain what went wrong in the last step',
        'Summarize the last successful step before the failure',
      ],
      4,
    )
  }

  if (stopped && !failed) {
    suggestions.push('Resume and finish the remaining steps')
  }

  switch (topic) {
    case 'news':
      suggestions.push('Open the first result from the previous answer and summarize it')
      suggestions.push('List the next five titles with links from the current page')
      if (hasPdf || /\bpdf\b/i.test(user)) {
        suggestions.push('Open the generated PDF and confirm the top 5 headlines match')
      } else {
        suggestions.push('Generate an HTML report of these headlines for download')
      }
      if (hasHtml) suggestions.push('Open the HTML report in Artifacts and verify the layout')
      suggestions.push('Save these headlines as a short markdown summary in the workspace')
      break

    case 'price':
      suggestions.push('Refresh the latest price and summarize changes')
      suggestions.push('Show the source of the rate on the page')
      suggestions.push('Convert 1000 units and show the result')
      break

    case 'login':
      suggestions.push('List every field on the login form')
      suggestions.push('Try logging in with the demo credentials if available')
      suggestions.push('Report any error banners after submit')
      break

    case 'form':
      suggestions.push('Fill the form with sample data and stop before submit')
      suggestions.push('List all required fields on this form')
      break

    case 'pdf':
      suggestions.push('Open the PDF in Artifacts and summarize page 1')
      suggestions.push('Also generate an HTML version of the same content')
      suggestions.push('List the files created for this task with their sizes')
      break

    case 'export':
      if (hasPdf) suggestions.push('Open the PDF artifact and confirm it looks correct')
      if (hasHtml) suggestions.push('Open the HTML report and check the formatting')
      if (hasMd) suggestions.push('Open the markdown file and fill in any empty sections')
      suggestions.push('Download-ready: confirm the saved file contents look correct')
      break

    case 'hrm':
      suggestions.push('Open the Admin menu and list the sections')
      suggestions.push('Navigate to the employee list and describe columns')
      break

    case 'greeting':
      suggestions.push('Show the homepage of the Application URL and describe it')
      suggestions.push('Go to google.com and get the latest top 5 news')
      suggestions.push('Get the latest AED to INR exchange rate and summarize it')
      break

    case 'jira':
      // Optional integration — only nudge when the user already mentioned Jira/Confluence
      if (/\bjira\b/i.test(user)) {
        suggestions.push('Log this to Jira: session summary')
        suggestions.push('Search Jira for open issues')
        if (/\b[A-Z][A-Z0-9]+-\d+\b/.test(user) || /\b[A-Z][A-Z0-9]+-\d+\b/.test(assistant)) {
          const key =
            user.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] ||
            assistant.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1]
          if (key) {
            suggestions.push(`Comment on ${key}: follow-up from AgentBrowser`)
            suggestions.push(`Set ${key} to Done`)
          }
        }
      }
      if (/\bconfluence\b/i.test(user)) {
        suggestions.push('Create a Confluence page with this session summary')
        suggestions.push('Post result report to Confluence')
      }
      if (!suggestions.length) {
        suggestions.push('Continue the previous browser task without Jira')
      }
      break

    default:
      if (hasSteps && url) {
        suggestions.push('Summarize the main content on the current page')
        suggestions.push('List the main navigation links on this page')
      }
      if (hasPdf) suggestions.push('Open the generated PDF and summarize it')
      if (hasHtml) suggestions.push('Open the HTML report in Artifacts')
      if (hasSteps) suggestions.push('Continue with the next logical step from the previous answer')
      else suggestions.push('Open the Application URL and describe what you see')
      break
  }

  // Result-aware extras (still on-topic) — Confluence is optional; only if user asked
  if (
    completed &&
    hasSteps &&
    topic !== 'greeting' &&
    topic !== 'price' &&
    /\bconfluence\b/i.test(user)
  ) {
    suggestions.push('Post result report to Confluence')
    if (hasPdf || hasHtml) {
      suggestions.push('Create a Confluence page with this session summary')
    }
  }

  if (url && topic !== 'greeting' && topic !== 'price') {
    const host = url.replace(/^https?:\/\//, '').slice(0, 36)
    // Only add if we still have room — uniq will cap
    suggestions.push(`Stay on ${host} and extract any remaining key points`)
  }

  return uniq(suggestions, 4)
}
