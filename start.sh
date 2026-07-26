#!/usr/bin/env bash
# Start AI Assurance Platform (API + UI)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"
if [[ ! -d .venv ]]; then
  uv sync --python 3.12
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created backend/.env — edit LLM settings as needed."
fi

# Kill previous listeners if present (old API/UI must restart to pick up browser fixes)
for port in 8742 8743 8744 8745 8746 8747 8748 5173 5174 5175; do
  pid=$(lsof -ti tcp:$port 2>/dev/null || true)
  if [[ -n "${pid:-}" ]]; then
    kill $pid 2>/dev/null || true
  fi
done
sleep 0.5

# Ensure Playwright Chromium + headless-shell exist
CHROME_FOR_TESTING=$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing 2>/dev/null | tail -1 || true)
HEADLESS_SHELL=$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell 2>/dev/null | tail -1 || true)
if [[ -z "${CHROME_FOR_TESTING}" || -z "${HEADLESS_SHELL}" ]]; then
  echo "Installing Playwright Chromium (Chrome for Testing + headless shell)..."
  (cd "$ROOT/backend" && uv run browser-use install)
fi

# Warn if somehow started from Cursor's embedded terminal without a real TTY app
if [[ -n "${CURSOR_TRACE_ID:-}" || -n "${VSCODE_PID:-}" ]]; then
  echo "WARNING: Starting under Cursor can crash Chromium on macOS."
  echo "         Prefer running this script from Terminal.app / iTerm."
fi


uv run uvicorn app.main:app --host 127.0.0.1 --port 8742 --reload &
API_PID=$!
cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then
  npm install
fi
npm run dev &
UI_PID=$!

cleanup() {
  kill $API_PID $UI_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "API  http://127.0.0.1:8742"
echo "UI   http://127.0.0.1:5173"
echo "Press Ctrl+C to stop."
wait
