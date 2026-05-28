#!/usr/bin/env bash
# Stop MD Reader.
#
# Mirrors start.sh: uses systemd user units if installed, otherwise
# falls back to PID-file based shutdown.

cd "$(dirname "$0")"

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
if command -v systemctl >/dev/null 2>&1 \
   && [ -f "$UNIT_DIR/md-reader-server.service" ] \
   && [ -f "$UNIT_DIR/md-reader-client.service" ]; then
  echo "Stopping via systemd..."
  systemctl --user stop md-reader-client.service md-reader-server.service
  echo "Done."
  exit 0
fi

stop_one() {
  local name="$1"
  local pid_file="$2"

  if [ ! -f "$pid_file" ]; then
    echo "$name: no PID file"
    return
  fi

  local pid
  pid=$(cat "$pid_file")

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name: process $pid not running"
    rm -f "$pid_file"
    return
  fi

  echo "Stopping $name (PID $pid and children)..."
  # Kill the whole process group (Vite spawns esbuild/node workers).
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true

  for _ in 1 2 3 4 5; do
    sleep 0.3
    kill -0 "$pid" 2>/dev/null || break
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo "  → force killing"
    pkill -KILL -P "$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
  fi

  rm -f "$pid_file"
  echo "  → stopped"
}

stop_one "server" "run/server.pid"
stop_one "client" "run/client.pid"

echo "Done."
