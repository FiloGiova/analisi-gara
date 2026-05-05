#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Creato .env locale da .env.example."
fi

cleanup() {
  if [ -n "${API_PID:-}" ]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "${WEB_PID:-}" ]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM EXIT

echo "Avvio API locale su http://localhost:3000"
npm run dev:api &
API_PID=$!

echo "Avvio web locale su http://localhost:5173"
npm run dev:web &
WEB_PID=$!

echo ""
echo "Apri: http://localhost:5173"
echo "Premi Ctrl+C per fermare API e web."
echo ""

while kill -0 "$API_PID" >/dev/null 2>&1 && kill -0 "$WEB_PID" >/dev/null 2>&1; do
  sleep 1
done

cleanup
wait "$API_PID" >/dev/null 2>&1 || true
wait "$WEB_PID" >/dev/null 2>&1 || true
exit 1
