#!/usr/bin/env bash
# Install MD Reader as systemd user services.
#
# After install both services are enabled and started. To survive reboot
# without an active login (e.g. WSL or a headless box), run:
#   sudo loginctl enable-linger "$USER"
#
# On WSL2, /etc/wsl.conf must also have:
#   [boot]
#   systemd=true
# (then run `wsl --shutdown` from Windows and reopen the shell).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  echo "ERROR: node and npm must be in PATH." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR" "$APP_DIR/logs"

render() {
  local src="$1" dst="$2"
  sed \
    -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    -e "s|__NPM_BIN__|$NPM_BIN|g" \
    "$src" > "$dst"
  echo "  → $dst"
}

echo "Installing unit files into $UNIT_DIR ..."
render "$SCRIPT_DIR/md-reader-server.service.template" "$UNIT_DIR/md-reader-server.service"
render "$SCRIPT_DIR/md-reader-client.service.template" "$UNIT_DIR/md-reader-client.service"

echo ""
echo "Reloading systemd user daemon..."
systemctl --user daemon-reload

echo "Enabling + starting services..."
systemctl --user enable --now md-reader-server.service
systemctl --user enable --now md-reader-client.service

echo ""
systemctl --user --no-pager status md-reader-server.service md-reader-client.service || true

cat <<EOF

Done.

Useful commands:
  systemctl --user status   md-reader-server md-reader-client
  systemctl --user restart  md-reader-server md-reader-client
  systemctl --user stop     md-reader-server md-reader-client
  journalctl --user -u md-reader-server -f
  journalctl --user -u md-reader-client -f

To survive reboot without an interactive login:
  sudo loginctl enable-linger "$USER"

On WSL2, also ensure /etc/wsl.conf contains:
  [boot]
  systemd=true
EOF
