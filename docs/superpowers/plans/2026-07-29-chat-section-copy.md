# Chat Timeline Section Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a copy-to-clipboard control on every chat timeline section (user messages, Thought/plan, tool code, Output) while keeping assistant MessageActions (Copy/HTML/PDF) and showing it for general-chat turns too.

**Architecture:** Add a small reusable `CopyIconButton` that calls existing `copyText` from `messageExport.ts`. Wire icons into `ChatPanel` section headers (restructure Thought/code headers so the icon is a sibling of the expand toggle, with `stopPropagation`). Extract a pure `thoughtCopyText` helper so Thought copies the full plan/body, not the truncated UI preview. Remove the `looksLikeGeneralChat` gate around `MessageActions`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind; existing `copyText` in `frontend/src/messageExport.ts`.

## Global Constraints

- Frontend only — no backend/API changes
- Reuse `copyText` from `messageExport.ts` — do not duplicate clipboard logic
- Icon buttons on user / Thought / code / Output; keep MessageActions row on assistants
- Empty copy payloads: do not render the button
- Thought UI may truncate `thoughtBody` at 1200 chars — clipboard must use the full body
- Output copies text lines only (no screenshot bytes)
- No suggested-follow-ups / Snaps / Artifacts copy
- Frontend has no unit-test runner — verify with `npm run build` + manual QA per task
- Match existing header control styling (`text-slate-500` → hover `text-slate-300`)

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/components/CopyIconButton.tsx` | Reusable copy icon; calls `copyText`; brief Copied state |
| `frontend/src/thoughtCopyText.ts` | Pure helper: plan / thoughtBody / note → clipboard string |
| `frontend/src/components/ChatPanel.tsx` | Wire icons + always show MessageActions |
| Spec: `docs/superpowers/specs/2026-07-29-chat-section-copy-design.md` | Source of truth |

---

### Task 1: `CopyIconButton` + `thoughtCopyText` helper

**Files:**
- Create: `frontend/src/components/CopyIconButton.tsx`
- Create: `frontend/src/thoughtCopyText.ts`

**Interfaces:**
- Produces:
  - `CopyIconButton({ text, title?, className? }: { text: string; title?: string; className?: string })` — returns `null` when `!(text || '').trim()`
  - `thoughtCopyText(plan: string[], thoughtBody: string, note: string): string` — numbered plan if `plan.length > 0`, else full `thoughtBody`, else `note`, else `''`

- [ ] **Step 1: Add `thoughtCopyText` helper**

```ts
// frontend/src/thoughtCopyText.ts
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
```

- [ ] **Step 2: Add `CopyIconButton`**

```tsx
// frontend/src/components/CopyIconButton.tsx
import { useState } from 'react'
import { copyText } from '../messageExport'

type Props = {
  text: string
  title?: string
  className?: string
}

export default function CopyIconButton({ text, title = 'Copy', className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const value = (text || '').trim()
  if (!value) return null

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-ink-800/60 disabled:opacity-40 ${className}`}
      title={copied ? 'Copied' : title}
      aria-label={copied ? 'Copied' : title}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        void (async () => {
          const ok = await copyText(text)
          if (ok) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }
        })()
      }}
    >
      <span aria-hidden className="text-[12px] leading-none">
        {copied ? '✓' : '⧉'}
      </span>
    </button>
  )
}
```

- [ ] **Step 3: Verify TypeScript build**

Run from `frontend/`:

```bash
npm run build
```

Expected: build succeeds (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CopyIconButton.tsx frontend/src/thoughtCopyText.ts
git commit -m "$(cat <<'EOF'
feat: add CopyIconButton and thought copy helper

EOF
)"
```

---

### Task 2: User message + always-on assistant MessageActions

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx` (imports + message branch ~746–771)

**Interfaces:**
- Consumes: `CopyIconButton` from Task 1
- Produces: user bubbles with copy icon; assistant always shows `MessageActions`

- [ ] **Step 1: Update imports**

At top of `ChatPanel.tsx`:

- Add: `import CopyIconButton from './CopyIconButton'`
- Keep `looksLikeGeneralChat` import for now if still used elsewhere; after removing the MessageActions gate, remove the import if unused (check with build)

- [ ] **Step 2: Wire user bubble copy**

Replace the user message branch:

```tsx
return m.role === 'user' ? (
  <div key={msgKey} className="flex justify-end">
    <div className="relative max-w-2xl accent-fill rounded-2xl rounded-tr-sm px-4 py-3 pr-9 text-[14px] leading-[1.5] whitespace-pre-wrap">
      {m.content}
      <div className="absolute bottom-2 right-2">
        <CopyIconButton text={m.content} title="Copy message" className="opacity-80 hover:opacity-100" />
      </div>
    </div>
  </div>
) : (
```

- [ ] **Step 3: Always show MessageActions on assistants**

Replace the gated block:

```tsx
{m.content}
{!looksLikeGeneralChat(
  promptByAssistantId.get(m.id) || session?.task || '',
) && (
  <MessageActions
    ...
  />
)}
```

with:

```tsx
{m.content}
<MessageActions
  content={m.content}
  title={session?.title || session?.task || 'AgentBrowser report'}
  prompt={promptByAssistantId.get(m.id) || session?.task || ''}
  sessionId={session?.id}
  events={events}
  onOpenFile={onOpenFile}
/>
```

- [ ] **Step 4: Remove unused `looksLikeGeneralChat` import** if nothing else in the file references it.

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Manual check**

In a session: copy a user prompt; paste matches. Open a general-chat assistant reply; Confirm Copy / HTML / PDF row is visible and Copy works.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat: copy on user messages; always show assistant actions

EOF
)"
```

---

### Task 3: Thought / plan header copy

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx` (Thought block ~821–862)

**Interfaces:**
- Consumes: `CopyIconButton`, `thoughtCopyText(plan, thoughtBody, note)`
- Produces: Thought header with copy that does not toggle expand

- [ ] **Step 1: Import helper**

```ts
import { thoughtCopyText } from '../thoughtCopyText'
```

- [ ] **Step 2: Restructure Thought header**

The Thought header is currently a single full-width `<button>`. Split into a flex row: expand toggle button + copy icon sibling.

Before the return for the steps block, compute:

```ts
const thoughtClipboard = thoughtCopyText(item.plan, item.thoughtBody, item.note || '')
```

Replace the Thought header markup with:

```tsx
<div className="rounded-xl border border-line/80 bg-ink-850/40 overflow-hidden">
  <div className="flex items-stretch border-b border-transparent">
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
      {/* existing plan / thoughtBody / note / empty content unchanged */}
    </div>
  )}
</div>
```

Keep the truncated display for `thoughtBody` (`slice(0, 1200)`) — only the clipboard uses the full string via `thoughtCopyText`.

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual check**

- Click Thought copy: paste shows numbered plan (or full body), not truncated with `…`
- Click Thought copy: panel does **not** expand/collapse
- Click the Thought label area: still toggles expand

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat: add copy control to Thought section header

EOF
)"
```

---

### Task 4: Tool code + Output header copy

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx` (tool cards ~877–908)

**Interfaces:**
- Consumes: `CopyIconButton`
- Produces: copy on code header and Output header

- [ ] **Step 1: Restructure code header**

Replace the full-width code toggle button with a flex row (toggle + copy):

```tsx
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
```

- [ ] **Step 2: Add Output header copy**

```tsx
<div className="rounded-lg border border-line/70 bg-ink-850/60 overflow-hidden">
  <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-line/50">
    <span>Output</span>
    <div className="ml-auto">
      <CopyIconButton
        text={tool.outputLines.join('\n')}
        title="Copy output"
      />
    </div>
  </div>
  <div className="px-3 py-2.5 space-y-1">
    {/* existing output lines / screenshot / file link unchanged */}
  </div>
</div>
```

`CopyIconButton` already returns `null` when joined output is empty (screenshot-only).

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual check**

- Copy code → paste matches `tool.code`
- Copy Output → paste is newline-joined lines (no image data)
- Code copy does not toggle the `js` panel
- Empty/whitespace-only output: no copy icon

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat: add copy controls to tool code and Output

EOF
)"
```

---

### Task 5: End-to-end QA pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 2: Walk the checklist against a live session**

| Check | Expected |
|-------|----------|
| User bubble copy | Pastes full prompt |
| Assistant MessageActions Copy | Pastes full reply |
| General-chat assistant | MessageActions visible; Copy works |
| Thought plan copy | Numbered list; no expand toggle |
| Long thoughtBody | UI truncated; clipboard full |
| Code copy | Full code; no collapse |
| Output copy | Text lines only |
| Screenshot-only output | No copy icon |
| Empty Thought | No copy icon |

- [ ] **Step 3: Fix any gaps found, then commit if needed**

```bash
git add -u frontend/src
git commit -m "$(cat <<'EOF'
fix: polish section copy edge cases

EOF
)"
```

(Skip commit if nothing to change.)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `CopyIconButton` + `copyText` | Task 1 |
| User message icon | Task 2 |
| Always show MessageActions (general chat) | Task 2 |
| Thought header icon; full body copy | Task 3 |
| Tool code header icon | Task 4 |
| Output header icon; lines only | Task 4 |
| Empty → no button | Task 1 (`return null`) |
| stopPropagation / no toggle on copy | Tasks 1, 3, 4 |
| Manual QA | Tasks 2–5 |
| Non-goals (follow-ups, artifacts, backend) | Not implemented ✓ |
