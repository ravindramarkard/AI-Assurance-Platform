/** Mirror of backend chat_gate — greetings don't need the Browser panel. */

const BROWSER_HINT =
  /https?:\/\/|\bwww\.|\bgo to\b|\bopen\b|\bnavigate\b|\bvisit\b|\bbrowse\b|\bclick\b|\blog ?in\b|\bsign ?in\b|\bscrape\b|\bscreenshot\b|\bfill\b|\btype\b|\bsubmit\b|\bdownload\b|\bupload\b|\borangehrm\b/i

const ACTION_HINT =
  /\b(get|show|fetch|load|find|search|look\s*up|run|perform|execute|check|read|list)\b|\bdo\s+(the|this|that|it|a|an|my|some)\b/i

const RESEARCH_HINT =
  /\b(price|prices|rate|rates|exchange|convert|latest|today|current|weather|news|stock|quote|how\s+much|aed|inr|usd|eur)\b/i

const GENERAL_CHAT =
  /^(hi|hello|hey|yo|hola|howdy|hiya|sup|good\s+(morning|afternoon|evening))\b|\bhow (can|do|would) you help\b|\bwhat can you (do|help)\b|\bwho are you\b|\bwhat are you\b|\b(can you|could you) help\b|^help[\s?!.]*$|^(thanks|thank you|thx|ty)[\s!.,]*$|^(ok|okay|cool|great|nice|got it)[\s!.,]*$/i

export function looksLikeGeneralChat(task: string): boolean {
  const text = (task || '').trim()
  if (!text) return true
  if (BROWSER_HINT.test(text) || ACTION_HINT.test(text) || RESEARCH_HINT.test(text)) {
    // "hi, get the price" is not general chat
    const greetsOnly = /^(hi|hello|hey|yo|hola|howdy|hiya|sup|good\s+(morning|afternoon|evening))([\s,!.?]|$)/i
    if (greetsOnly.test(text)) {
      const leftover = text.replace(greetsOnly, '').trim()
      if (!leftover) return true
      if (BROWSER_HINT.test(leftover) || ACTION_HINT.test(leftover) || RESEARCH_HINT.test(leftover)) {
        return false
      }
    } else {
      return false
    }
  }
  if (GENERAL_CHAT.test(text) && text.length <= 240) {
    const leftover = text.replace(GENERAL_CHAT, '').trim().replace(/^[.?!,\s:-]+/, '')
    if (leftover.length < 12) return true
  }
  if (text.length <= 24 && !/[/.]/.test(text) && /^[\w\s?!.',-]+$/u.test(text)) return true
  return false
}
