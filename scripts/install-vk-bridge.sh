#!/usr/bin/env bash
# Install the official, version-pinned VK Bridge browser bundle locally.
# No server process uses this file; Nginx serves it under /echo/vendor/.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/client/vendor/vk-bridge-2.15.12.min.js"

if [[ -s "$DEST" ]] && node --check "$DEST" >/dev/null 2>&1; then
  echo "[echo vk] Local VK Bridge 2.15.12 is already installed"
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
cd "$TMP_DIR"
PACKAGE_ARCHIVE="$(npm pack --silent --ignore-scripts '@vkontakte/vk-bridge@2.15.12')"
tar -xzf "$PACKAGE_ARCHIVE" package/dist/browser.min.js
test -s package/dist/browser.min.js
node --check package/dist/browser.min.js
mkdir -p "$(dirname "$DEST")"
install -m 0644 package/dist/browser.min.js "$DEST"
echo "[echo vk] Installed VK Bridge 2.15.12 to $DEST"
