#!/usr/bin/env bash
# Remove MD Reader systemd user services.

set -e

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

for svc in md-reader-client.service md-reader-server.service; do
  if systemctl --user list-unit-files | grep -q "^${svc}"; then
    echo "Stopping + disabling $svc ..."
    systemctl --user disable --now "$svc" 2>/dev/null || true
  fi
  rm -f "$UNIT_DIR/$svc"
done

systemctl --user daemon-reload
systemctl --user reset-failed 2>/dev/null || true

echo "Removed."
