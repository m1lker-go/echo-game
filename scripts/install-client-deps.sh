#!/usr/bin/env bash
# Pin browser dependencies locally: VK Android WebView must not depend on
# third-party CDN requests before main-menu click handlers are installed.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/client/vendor"

if [[ -s "$DEST/three/build/three.module.js" &&
      -s "$DEST/three/build/three.core.js" &&
      -s "$DEST/three/examples/jsm/loaders/GLTFLoader.js" &&
      -s "$DEST/three/examples/jsm/utils/SkeletonUtils.js" &&
      -s "$DEST/socket.io-4.8.1.min.js" &&
      -s "$DEST/fontawesome/css/all.min.css" &&
      -s "$DEST/fontawesome/webfonts/fa-solid-900.woff2" &&
      -s "$DEST/livekit-client-2.23.0.min.js" ]]; then
  echo "[echo vendor] Local Three.js, Socket.IO and Font Awesome assets are ready"
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
cd "$TMP_DIR"

pack_and_extract() {
  local spec="$1"; shift
  local archive
  archive="$(npm pack --silent --ignore-scripts "$spec")"
  test -s "$archive"
  tar -xzf "$archive" "$@"
}

pack_and_extract 'three@0.180.0' package/build/three.module.js package/build/three.core.js package/examples/jsm
mkdir -p "$TMP_DIR/staged/three/build" "$TMP_DIR/staged/three/examples"
cp package/build/three.module.js "$TMP_DIR/staged/three/build/three.module.js"
cp package/build/three.core.js "$TMP_DIR/staged/three/build/three.core.js"
cp -R package/examples/jsm "$TMP_DIR/staged/three/examples/jsm"
rm -rf package

pack_and_extract 'socket.io@4.8.1' package/client-dist/socket.io.min.js
cp package/client-dist/socket.io.min.js "$TMP_DIR/staged/socket.io-4.8.1.min.js"
rm -rf package

pack_and_extract 'livekit-client@2.23.0' package/dist/livekit-client.umd.js
cp package/dist/livekit-client.umd.js "$TMP_DIR/staged/livekit-client-2.23.0.min.js"
rm -rf package

pack_and_extract '@fortawesome/fontawesome-free@6.7.2' package/css/all.min.css package/webfonts
mkdir -p "$TMP_DIR/staged/fontawesome/css"
cp package/css/all.min.css "$TMP_DIR/staged/fontawesome/css/all.min.css"
cp -R package/webfonts "$TMP_DIR/staged/fontawesome/webfonts"

node --input-type=module --check < "$TMP_DIR/staged/three/build/three.module.js"
node --input-type=module --check < "$TMP_DIR/staged/three/build/three.core.js"
node --input-type=module --check < "$TMP_DIR/staged/three/examples/jsm/loaders/GLTFLoader.js"
node --input-type=module --check < "$TMP_DIR/staged/three/examples/jsm/utils/SkeletonUtils.js"
node --check "$TMP_DIR/staged/socket.io-4.8.1.min.js"
node --check "$TMP_DIR/staged/livekit-client-2.23.0.min.js"
test -s "$TMP_DIR/staged/fontawesome/webfonts/fa-solid-900.woff2"

mkdir -p "$DEST"
cp -R "$TMP_DIR/staged/." "$DEST/"
for resource in \
  "$DEST/three/build/three.module.js" \
  "$DEST/three/build/three.core.js" \
  "$DEST/three/examples/jsm/loaders/GLTFLoader.js" \
  "$DEST/three/examples/jsm/utils/SkeletonUtils.js" \
  "$DEST/socket.io-4.8.1.min.js" \
  "$DEST/livekit-client-2.23.0.min.js" \
  "$DEST/fontawesome/css/all.min.css" \
  "$DEST/fontawesome/webfonts/fa-solid-900.woff2"; do
  test -s "$resource"
done
echo "[echo vendor] Installed local Three.js 0.180.0, Socket.IO 4.8.1, Font Awesome 6.7.2"
