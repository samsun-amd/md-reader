#!/usr/bin/env bash
# Start MD Reader (server + Vite dev server) in the background.

set -e
cd "$(dirname "$0")"

mkdir -p logs run

SERVER_PID_FILE="run/server.pid"
CLIENT_PID_FILE="run/client.pid"

is_running() {
  local pid_file="$1"
  [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

if is_running "$SERVER_PID_FILE"; then
  echo "Server already running (PID $(cat "$SERVER_PID_FILE"))"
else
  echo "Starting server..."
  nohup node server/index.js >logs/server.log 2>&1 &
  echo $! >"$SERVER_PID_FILE"
  echo "  → PID $(cat "$SERVER_PID_FILE")  log: logs/server.log"
fi

if is_running "$CLIENT_PID_FILE"; then
  echo "Client already running (PID $(cat "$CLIENT_PID_FILE"))"
else
  echo "Starting client (Vite)..."
  nohup npm --prefix client run dev >logs/client.log 2>&1 &
  echo $! >"$CLIENT_PID_FILE"
  echo "  → PID $(cat "$CLIENT_PID_FILE")  log: logs/client.log"
fi

sleep 1

SERVER_PORT=$(node -e "console.log(require('./config.json').port || 3001)")
CLIENT_PORT=$(node -e "console.log(require('./config.json').clientPort || 5173)")

echo ""
echo "MD Reader started."
echo "  Server : http://localhost:${SERVER_PORT}"
echo "  Client : http://localhost:${CLIENT_PORT}"
echo ""
echo "Stop with: ./stop.sh"
