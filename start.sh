#!/usr/bin/env bash
# Start MD Reader.
#
# If the systemd user units are installed (see ./systemd/install.sh) this
# delegates to `systemctl --user`. Otherwise it falls back to nohup +
# PID files in run/.

set -e
cd "$(dirname "$0")"

mkdir -p logs run

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
USE_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 \
   && [ -f "$UNIT_DIR/md-reader-server.service" ] \
   && [ -f "$UNIT_DIR/md-reader-client.service" ]; then
  USE_SYSTEMD=1
fi

if [ "$USE_SYSTEMD" = "1" ]; then
  echo "Using systemd user units."
  systemctl --user start md-reader-server.service md-reader-client.service
  systemctl --user --no-pager status md-reader-server.service md-reader-client.service \
    | grep -E 'Active:|Loaded:|●' || true
else
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
fi

SERVER_PORT=$(node -e "console.log(require('./config.json').port || 3001)")
CLIENT_PORT=$(node -e "console.log(require('./config.json').clientPort || 5173)")

echo ""
echo "MD Reader started."
echo "  Server : http://localhost:${SERVER_PORT}"
echo "  Client : http://localhost:${CLIENT_PORT}"
echo ""
if [ "$USE_SYSTEMD" = "1" ]; then
  echo "Stop with: ./stop.sh   (or: systemctl --user stop md-reader-{server,client})"
  echo "Logs    : journalctl --user -u md-reader-server -f"
else
  echo "Stop with: ./stop.sh"
fi
