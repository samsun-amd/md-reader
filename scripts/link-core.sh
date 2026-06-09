#!/bin/bash
#
# Link @ssh-manager/core into md-reader's node_modules so remote (SFTP) roots
# work. Local-only installs don't need this — core is loaded lazily and only a
# config with a "type":"remote" root will require it.
#
# Why a symlink instead of a package.json dependency:
#   npm rewrites any `file:` path to an ugly normalized form and does NOT expand
#   ~ or $HOME (both become literal dir names -> dangling link). So core is kept
#   out of package.json deps and linked here, anchored on a shell-expanded path.
#
# Run this AFTER `npm install` (npm prunes pre-existing extraneous links).
#
# Layout (default): ssh-manager is a sibling of md-reader under the same parent.
# Override SSH_MANAGER_CORE for a non-adjacent checkout:
#   SSH_MANAGER_CORE=$HOME/shared/ssh-manager/packages/core ./scripts/link-core.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
PARENT_DIR="$(dirname "$APP_DIR")"

CORE_DIR="${SSH_MANAGER_CORE:-$PARENT_DIR/ssh-manager/packages/core}"
CORE_DIR="$(cd "$CORE_DIR" 2>/dev/null && pwd || echo "$CORE_DIR")"

RED='\033[1;31m'; GREEN='\033[1;32m'; NC='\033[0m'
die() { echo -e "${RED}Error:${NC} $*" >&2; exit 1; }

[[ -d "$CORE_DIR" ]] || die "Cannot find @ssh-manager/core at:
    $CORE_DIR
  Clone ssh-manager beside md-reader, or set SSH_MANAGER_CORE=/path/to/packages/core"

# Build core if it has no dist yet (md-reader requires the compiled CJS).
if [[ ! -f "$CORE_DIR/dist/index.js" ]]; then
  echo "Building @ssh-manager/core (no dist yet)…"
  ( cd "$CORE_DIR" && npm install --no-audit --no-fund && npm run build )
fi

mkdir -p "$APP_DIR/node_modules/@ssh-manager"
ln -sfn "$CORE_DIR" "$APP_DIR/node_modules/@ssh-manager/core"
( cd "$APP_DIR" && node -e 'require("@ssh-manager/core"); console.log("  @ssh-manager/core linked & resolves OK")' ) \
  || die "core symlink does not resolve from md-reader"

echo -e "${GREEN}==>${NC} Linked @ssh-manager/core -> $CORE_DIR"
