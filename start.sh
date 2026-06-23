#!/usr/bin/env bash
# Start MD Reader.
#
# If the systemd user units are installed (see ./systemd/install.sh) AND the
# systemd user bus is reachable, this delegates to `systemctl --user`.
# Otherwise it falls back to nohup + PID files in run/.

set -e
cd "$(dirname "$0")"

mkdir -p logs run

# Print a concise environment diagnosis and exit with an error message.
# Called when systemd units are installed but the user bus is unreachable.
diagnose_systemd() {
  echo ""
  echo "ERROR: systemd user units are installed but the user bus is not reachable."
  echo ""
  echo "--- Diagnosis ---"

  if [ -f /etc/wsl.conf ]; then
    echo "[/etc/wsl.conf]"
    cat /etc/wsl.conf
  else
    echo "[/etc/wsl.conf] NOT FOUND"
    echo "  Fix: echo -e '[boot]\\nsystemd=true' | sudo tee /etc/wsl.conf"
    echo "       then run: wsl --shutdown  (from Windows PowerShell)"
  fi

  echo ""
  local running
  running=$(systemctl is-system-running 2>&1 || true)
  echo "[systemctl is-system-running] $running"

  echo ""
  local bus_err
  bus_err=$(systemctl --user status 2>&1 | head -3 || true)
  echo "[systemctl --user status]"
  echo "$bus_err"

  echo ""
  echo "If /etc/wsl.conf looks correct, run 'wsl --shutdown' from PowerShell and reopen WSL."
  echo "-----------------"
  echo ""
  exit 1
}

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNITS_INSTALLED=0
if [ -f "$UNIT_DIR/md-reader-server.service" ] \
   && [ -f "$UNIT_DIR/md-reader-client.service" ]; then
  UNITS_INSTALLED=1
fi

USE_SYSTEMD=0
if [ "$UNITS_INSTALLED" = "1" ]; then
  # Verify the user bus is actually reachable before committing to systemd path.
  if systemctl --user is-system-running >/dev/null 2>&1 \
     || systemctl --user status >/dev/null 2>&1; then
    USE_SYSTEMD=1
  else
    diagnose_systemd
  fi
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

  # Wait until a TCP port is listening, or the process dies, up to ~5 s.
  wait_for_port() {
    local pid="$1" port="$2" name="$3"
    local i=0
    while [ $i -lt 50 ]; do
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "  ERROR: $name (PID $pid) exited unexpectedly. Check logs."
        return 1
      fi
      if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
        return 0
      fi
      sleep 0.1
      i=$((i + 1))
    done
    echo "  WARNING: $name did not listen on port $port within 5s. Check logs."
    return 0
  }

  if is_running "$SERVER_PID_FILE"; then
    echo "Server already running (PID $(cat "$SERVER_PID_FILE"))"
  else
    echo "Starting server..."
    nohup node server/index.js >logs/server.log 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID >"$SERVER_PID_FILE"
    wait_for_port "$SERVER_PID" "${SERVER_PORT:-3001}" "server"
    echo "  → PID $SERVER_PID  log: logs/server.log"
  fi

  if is_running "$CLIENT_PID_FILE"; then
    echo "Client already running (PID $(cat "$CLIENT_PID_FILE"))"
  else
    echo "Starting client (Vite)..."
    nohup npm --prefix client run dev >logs/client.log 2>&1 &
    CLIENT_PID=$!
    echo $CLIENT_PID >"$CLIENT_PID_FILE"
    wait_for_port "$CLIENT_PID" "${CLIENT_PORT:-5174}" "client"
    echo "  → PID $CLIENT_PID  log: logs/client.log"
  fi
fi

SERVER_PORT=$(node -e "console.log(require('./config.json').port || 3001)")
CLIENT_PORT=$(node -e "console.log(require('./config.json').clientPort || 5174)")

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
  echo "Logs    : tail -f logs/server.log"
fi
