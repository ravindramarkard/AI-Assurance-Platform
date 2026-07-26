# AI Assurance Platform

A local web app for browser agents: task queue, agent sessions, live step logs, browser screenshots, workspace files, and settings — powered by the open-source .

## Features

- **New Agent** — queue a natural-language browser task
- **Session history** — SQLite-backed runs with status
- **Scheduled Jobs** — recurring agent tasks (no workspace picker; files use `schedular/`)
- **Live timeline** — thoughts/actions streamed over WebSocket
- **Browser preview** — per-step screenshots
- **Files tab** — session workspace downloads / generated files
- **Settings** — local LLM (LM Studio / Ollama) or cloud keys (Browser Use / OpenAI / Anthropic); browser engine (Chromium / local Chrome / custom path)
- **Jira & Confluence** — connect self-hosted Server/Data Center (or Cloud) in Settings, then log issues from chat (`log this to Jira: …`) or the **Log issue** button on a session

## Requirements

- Python **3.11+** (managed via `uv`)
- Node.js 18+
- A browser: Playwright Chromium (default), installed Google Chrome, or a custom binary path
- An LLM:
  - **Local:** LM Studio or Ollama with tool calling + context ≥ 16k
  - **Cloud:**  `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`

## Setup

```bash
cd ~/AgentBrower

# Backend
cd backend
cp .env.example .env          # edit LLM settings
uv sync --python 3.12
uv run browser-use install    # or: uvx playwright install chromium
uv run uvicorn app.main:app --host 127.0.0.1 --port 8742 --reload

# Frontend (separate terminal)
cd ../frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173**

Or from the repo root (own terminal — not a restricted sandbox):

```bash
./start.sh
```

> **Chrome crashes:** The launcher starts the selected browser via CDP (default: Playwright Chromium / `chrome-headless-shell`). If Chromium still SIGABRTs, you are almost certainly starting the API **from Cursor** — on macOS that often kills child Chromium. Quit embedded servers and run `./start.sh` from **Terminal.app / iTerm** instead. Install Playwright browsers with `cd backend && uv run browser-use install`, or switch **Settings → Browser engine** to Local Chrome / custom path.

## LLM configuration

Edit `backend/.env` or use **Settings** in the UI.

### Local (default)

```env
LLM_PROVIDER=local
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=your-model-id
```

For Ollama, typically `LLM_BASE_URL=http://localhost:11434/v1`.

### Browser Use Cloud models

```env
LLM_PROVIDER=browser_use
BROWSER_USE_API_KEY=bu_...
LLM_MODEL=bu-latest
```

### OpenAI / Anthropic

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check |
| GET/POST | `/api/sessions` | List / create |
| GET | `/api/sessions/{id}` | Session detail |
| POST | `/api/sessions/{id}/messages` | Follow-up message |
| POST | `/api/sessions/{id}/control` | pause / resume / stop |
| GET | `/api/sessions/{id}/files` | Workspace listing |
| GET/PUT | `/api/settings` | LLM settings |
| GET/POST | `/api/scheduled-jobs` | List / create scheduled jobs |
| PATCH/DELETE | `/api/scheduled-jobs/{id}` | Update / delete job |
| POST | `/api/scheduled-jobs/{id}/run` | Run job immediately |
| WS | `/ws/sessions/{id}` | Live events |

## Layout

```
browser-use/
  backend/app/     # FastAPI + queue + browser-use runner
  frontend/        # Vite + React + Tailwind UI
  schedular/       # Default file folder for scheduled jobs
  data/            # SQLite + per-session screenshots/workspace (gitignored)
```

## Notes

- Concurrent agents limited by `MAX_CONCURRENT_AGENTS` (default 2).
- Scheduled jobs poll every ~15s and enqueue agent sessions; files default to `schedular/` (no workspace picker).
- Screenshot stream is per-step (not 24fps VNC).
