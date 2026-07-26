#!/bin/bash
# Double-click this in Finder to start AI Assurance Platform in Terminal.app
# (avoids Chromium SIGABRT when API is launched from Cursor)
cd "$(dirname "$0")"
chmod +x ./start.sh 2>/dev/null || true
exec ./start.sh
