# Chat timeline section copy — design

**Date:** 2026-07-29  
**Status:** Approved (Approach 1)  
**Scope:** Frontend only — ChatPanel timeline sections; reuse existing `copyText`

## Problem

Users need to copy content from individual chat timeline sections (user prompts, Thought/plan, tool code, Output). Today only assistant replies expose Copy (via `MessageActions`), and that row is hidden for general-chat turns. The orange user bubble and Thought block have no copy control.

## Goals

- Provide a copy option on **every** chat timeline content section
- Use a lightweight **icon button** on Thought / tool code / Output headers and user messages
- Keep the existing assistant **Copy / HTML / PDF** row (`MessageActions`)
- Always show `MessageActions` on assistant messages (including general chat)
- Reuse `copyText` from `messageExport.ts`

## Non-goals

- Suggested follow-ups
- Snaps / Artifacts panel copy
- Session ID copy (already exists elsewhere)
- HTML / PDF export on non-assistant sections
- Backend or API changes

## Approach

**Shared `CopyIconButton` + wire into `ChatPanel`**, reusing `copyText`.

Not chosen:

- Extending `MessageActions` into a full actions bar on every section (too heavy)
- Hover-only floating toolbars (easy to miss; worse on touch)

## What gets copied

| Section | Control | Clipboard content |
|--------|---------|-------------------|
| User message | Copy icon on bubble | Full `m.content` |
| Assistant message | Existing MessageActions | Full message text (unchanged Copy) |
| General-chat assistant | Same MessageActions row (no longer gated) | Same as assistant |
| Thought / plan | Icon in Thought header | Numbered plan lines, else full `thoughtBody` / `note` |
| Tool code (`js`) | Icon on code header | Full `tool.code` |
| Output | Icon on Output header | `outputLines` joined by newlines (no screenshot bytes) |

## Components

### `CopyIconButton` (`frontend/src/components/CopyIconButton.tsx`)

- Props: `text: string`, optional `title`, optional `className`
- Calls `copyText(text)` from `messageExport.ts`
- Success: brief “Copied” / check state for ~1.6s (match MessageActions timing)
- `stopPropagation` on click so header toggles do not fire
- Empty `text`: do not render the button
- Accessible: `type="button"`, `aria-label` Copy → Copied

### `ChatPanel.tsx` wiring

- User bubble: relative container + `CopyIconButton` (corner)
- Thought header: icon before expand chevron; click does not toggle expand
- Tool code header: icon on the `js` bar
- Output header: icon on the Output label row
- Assistant: keep `MessageActions`; remove `looksLikeGeneralChat` gate so the actions row always renders

### Visual

Match existing small header controls (`text-slate-500` → hover `text-slate-300`). No new card chrome.

## Edge cases

- Empty Thought (no plan / body / note): do not render copy
- UI truncates `thoughtBody` at 1200 chars: **copy the full body**, not the truncated preview
- Output with only a screenshot and no text lines: do not render copy
- Clipboard failure: rely on `copyText` fallback (`execCommand`); on total failure, do not show “Copied” (same as MessageActions)

## Testing

- Manual: copy user, Thought plan, code, Output, and assistant Copy; paste matches source
- Manual: Thought copy does not collapse/expand the panel
- Manual: general-chat assistant shows MessageActions with working Copy
- Optional: small unit test if plan→clipboard string formatting is extracted to a helper

## Implementation notes

- Prefer one new component file; avoid duplicating clipboard logic
- Do not change `messageExport.copyText` behavior unless a clear bug is found
- Keep scope limited to `ChatPanel` + `CopyIconButton` (+ any tiny text helper colocated or next to ChatPanel)
