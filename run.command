#!/bin/zsh
# Volume Society Macro Space — start the local server and open the dashboard.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}"

if lsof -ti "tcp:${PORT}" >/dev/null 2>&1; then
  echo "Volume Society Macro Space already running on ${URL}"
  open "${URL}"
  exit 0
fi

python3 server.py --port "${PORT}" &
SERVER_PID=$!
trap 'kill "${SERVER_PID}" 2>/dev/null' EXIT INT TERM

for _ in {1..30}; do
  if curl -sS --max-time 1 "${URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

open "${URL}"
echo "Volume Society Macro Space running at ${URL} (Ctrl+C to stop)"
wait "${SERVER_PID}"
