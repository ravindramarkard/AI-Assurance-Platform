/** Build clipboard text for a Thought section (full body, never truncated). */
export function thoughtCopyText(
  plan: string[],
  thoughtBody: string,
  note: string,
): string {
  if (plan.length > 0) {
    return plan.map((line, i) => `${i + 1}. ${line}`).join('\n')
  }
  const body = (thoughtBody || '').trim()
  if (body) return thoughtBody
  return note || ''
}
