# Human-in-the-loop (OTP / mid-run input) — design

**Date:** 2026-07-29  
**Status:** Approved (Approach 1 — custom `request_human_input` tool)  
**Scope:** AgentBrowser live sessions + scheduled-job sessions; backend runner, WebSocket, API, ChatPanel UI

## Problem

Browser agents often hit steps only a human can complete — especially OTP / MFA / one-time codes. Today the platform supports manual pause/resume/stop and Keycloak `sensitive_data` for known SSO passwords, but a live run cannot **block, ask the operator for a one-time value, then continue** with that value.

## Goals

- Agent-driven HITL: when the model needs a human value (OTP, MFA code, similar), it calls a dedicated tool and waits
- Dedicated UI banner/modal (not the chat composer) for the prompt + input + Submit / Stop
- Wait indefinitely until Submit or Stop (no auto-timeout)
- Scheduled / unattended runs use the same path: status `waiting_for_input` until the operator opens the session and submits or stops
- Clear status distinct from manual `paused`

## Non-goals (v1)

- Auto-detect OTP pages without the tool calling
- Reading OTP from email/SMS/authenticator apps
- Auto-timeout or resume-without-value
- Submitting the value via the normal chat box
- Multiple concurrent pending HITL requests per session
- Changing Keycloak / stored password `sensitive_data` flow

## Approach

**Approach 1 — Custom browser-use tool `request_human_input` (chosen)**

Register a custom action on the agent’s Tools. When called, the runner:

1. Sets session status to `waiting_for_input`
2. Persists a pending request (prompt, type, request id)
3. Emits WebSocket `human_input_required`
4. Blocks until `POST .../human-input` or Stop
5. Returns the submitted value as the tool result so the agent can type it into the page

Rejected:

- Step-callback auto-detect (brittle; unclear which field to fill)
- Reuse pause + chat as the input channel (conflicts with dedicated modal; weaker for scheduled waiting)

## Architecture

```
Agent (LLM) ──► request_human_input(prompt, input_type)
                      │
                      ▼
              agent_runner (pending Future)
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   status =      WS emit      UI modal
 waiting_for_   human_input_  Submit / Stop
   input         _required
         │
         ▼
 POST /api/sessions/{id}/human-input  ──► resolve Future ──► tool result ──► agent continues
```

Manual pause/resume remains separate. While `waiting_for_input`, Stop cancels the wait and stops the run as today.

## Session status

| Status | Meaning |
|--------|---------|
| `waiting_for_input` | Agent blocked on HITL; operator must Submit or Stop |
| `paused` | Manual pause (existing control) — unchanged |

UI chips / history / analytics treat `waiting_for_input` as a live / attention-needed state (alongside running / queued / thinking / paused where those lists already surface live sessions).

## Tool contract

**Name:** `request_human_input`

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | yes | Shown in the modal (e.g. “Enter the 6-digit OTP sent to your phone”) |
| `input_type` | `"otp"` \| `"text"` | no | Default `"text"`; UI may hint numeric/OTP styling for `"otp"` |

**Result:** the submitted string (trimmed). On Stop: tool/action fails or returns a clear cancelled message and the run ends as `stopped`.

**Concurrency:** one pending request per session. A new call is only valid after the previous Future resolves (or the session stops).

## System message hint

Append a short instruction via existing `extend_system_message` (alongside Keycloak / response-style hints):

- For OTP, MFA, verification codes, or any value only a human can provide, call `request_human_input`
- Never invent or guess one-time codes
- After receiving the value, enter it into the correct field and continue

## API

### Submit human input

`POST /api/sessions/{id}/human-input`

Body:

```json
{ "value": "123456", "request_id": "<optional, must match pending if provided>" }
```

Behavior:

- 200 if a pending wait exists and is resolved with `value`
- 409 if session is not `waiting_for_input` / no pending request
- 400 if `value` is empty after trim

Stop continues to use existing `POST /api/sessions/{id}/control` with `action: "stop"`, which must also cancel any pending HITL Future.

### Persistence

Store enough to restore the modal after refresh / reopen:

- Pending fields on the session row or a small side table/key: `request_id`, `prompt`, `input_type`, `created_at`
- Clear pending fields when resolved or stopped

Exact storage shape is an implementation detail; must survive process-local Future loss on reopen only for **display** — if the agent process died, the run is already failed/stopped and there is no Future to resolve. Live wait requires the agent still running in `_live`.

## WebSocket

Event type: `human_input_required`

Payload:

```json
{
  "request_id": "...",
  "prompt": "Enter the 6-digit OTP",
  "input_type": "otp"
}
```

Also emit `status` with `{ "status": "waiting_for_input" }` so clients that only watch status update correctly.

On submit: emit `status` back to `running` / `thinking` as appropriate, and optionally `human_input_resolved` (optional for v1; status + modal dismiss is enough).

## Frontend

### Modal / banner

When the active session status is `waiting_for_input` (or a `human_input_required` event arrives):

- Dedicated overlay or sticky banner on the chat/session workspace (not the main chat composer)
- Shows prompt text, text input, **Submit**, **Stop**
- Submit calls `POST .../human-input`; Stop calls existing control API
- After success, dismiss UI and return to normal running chrome

### Lists & scheduled

- Session history / Agents rail / Scheduled-run sessions: chip label **Waiting for input**
- Opening a session that is still live and waiting restores the modal from session pending fields + status
- Scheduled jobs: no special timeout; job session stays `waiting_for_input` until Submit or Stop

### i18n

Add keys for modal title, placeholder, Submit, Waiting for input status (en / ar / hi).

## Privacy / logging

- Prefer not to echo the raw OTP in assistant “thought” timeline text when avoidable
- Event log may record that human input was provided (redacted), not the cleartext value, where practical
- Tool result is available to the agent for typing; that is expected

## Edge cases

1. **Operator closes the browser tab:** wait continues server-side; reopening the live session shows the modal again from status + pending prompt.
2. **Stop while waiting:** cancel Future, stop agent, clear pending, status `stopped`.
3. **Agent / process crash while waiting:** session ends failed/stopped; pending cleared; no orphan modal that can submit into a dead run.
4. **Empty submit:** rejected client- and server-side.
5. **Manual pause while waiting:** out of scope for v1 — Stop and Submit are the supported exits from `waiting_for_input`. Do not require Resume to clear HITL.

## Testing (manual)

- [ ] Agent on an OTP page calls `request_human_input`; status becomes `waiting_for_input`; modal appears
- [ ] Submit value → agent continues and uses the value in the form
- [ ] Stop while waiting → session `stopped`, modal gone, no hang
- [ ] Refresh / reopen live waiting session → modal still shown with same prompt
- [ ] Scheduled job run that hits OTP stays `waiting_for_input` until Submit/Stop
- [ ] Empty value cannot be submitted
- [ ] Manual pause/resume still works on non-waiting runs
- [ ] Status chip shows Waiting for input in history/rail

## Approach decision

**Approach 1 (chosen):** Custom `request_human_input` tool + dedicated modal + indefinite wait + `waiting_for_input` status for interactive and scheduled sessions.
