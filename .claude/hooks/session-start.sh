#!/usr/bin/env bash
# SessionStart hook (cloud and local sessions): make sure dependencies are installed so `npm test`,
# the dev server and the playtests work right away. Quiet and fast when there is nothing to do.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
stamp=node_modules/.package-lock.json
if [ ! -d node_modules ] || [ ! -f "$stamp" ] || [ package-lock.json -nt "$stamp" ]; then
  echo "[session-start] installing dependencies (npm ci)…"
  npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1 || npm install --no-audit --no-fund --loglevel=error >/dev/null
  echo "[session-start] dependencies ready"
fi
if [ ! -f .env.local ]; then
  echo "[session-start] no .env.local: the game runs on its rule engine (see .env.example to add a model)"
fi
exit 0
