#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/artifacts}"
CACHE_DIR="${CACHE_DIR:-$PROJECT_ROOT/.cache}"
BUILD_NODE="${BUILD_NODE:-node}"
LOCK_FILE="$PROJECT_ROOT/upstream.lock.json"

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64|x64) ARCH=x64 ;;
  *) echo "Unsupported Linux architecture: $ARCH" >&2; exit 2 ;;
esac
RUNTIME_KEY="linux-$ARCH"

lock_value() {
  "$BUILD_NODE" -e 'const fs=require("fs"); const value=process.argv[2].split(".").reduce((v,k)=>v[k],JSON.parse(fs.readFileSync(process.argv[1],"utf8"))); process.stdout.write(String(value))' "$LOCK_FILE" "$1"
}

NODE_VERSION="$(lock_value node.version)"
NODE_BASE_URL="$(lock_value node.baseUrl)"
NODE_ARCHIVE="$(lock_value node.runtimes.$RUNTIME_KEY.archive)"
NODE_SHA256="$(lock_value node.runtimes.$RUNTIME_KEY.sha256)"
DSH_VERSION="$(lock_value dsh.version)"
DSH_COMMIT="$(lock_value dsh.reviewedCommit)"
PORTABLE_VERSION="$("$BUILD_NODE" -p 'require(process.argv[1]).version' "$PROJECT_ROOT/package.json")"

DOWNLOAD_DIR="$CACHE_DIR/downloads"
ARCHIVE="$DOWNLOAD_DIR/$NODE_ARCHIVE"
NODE_CACHE="$CACHE_DIR/node-$NODE_VERSION-$RUNTIME_KEY"
NODE_FOLDER="$NODE_CACHE/node-v$NODE_VERSION-linux-$ARCH"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-portable-linux.XXXXXX")"
STAGE="$BUILD_ROOT/DSH-Portable"
PAYLOAD="$PROJECT_ROOT/launcher/linux/payload"
cleanup() {
  rm -rf "$BUILD_ROOT"
  rm -rf "$PAYLOAD"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR" "$DOWNLOAD_DIR" "$STAGE"/{app,launcher,runtime/node,licenses,data,workspace}
cp -R "$PROJECT_ROOT/desktop-bridge" "$STAGE/desktop-bridge"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Downloading pinned Node.js runtime: $NODE_BASE_URL/$NODE_ARCHIVE"
  curl --fail --location --retry 3 --output "$ARCHIVE" "$NODE_BASE_URL/$NODE_ARCHIVE"
fi
printf '%s  %s\n' "$NODE_SHA256" "$ARCHIVE" | sha256sum --check

if [[ ! -x "$NODE_FOLDER/bin/node" ]]; then
  if [[ -e "$NODE_CACHE" ]]; then
    echo "Pinned Node cache is incomplete: $NODE_CACHE" >&2
    exit 1
  fi
  mkdir -p "$NODE_CACHE"
  tar -xJf "$ARCHIVE" -C "$NODE_CACHE"
fi

NODE_EXE="$NODE_FOLDER/bin/node"
NPM_CLI="$NODE_FOLDER/lib/node_modules/npm/bin/npm-cli.js"
[[ -x "$NODE_EXE" && -f "$NPM_CLI" ]] || { echo "Pinned Node archive is incomplete" >&2; exit 1; }

cp "$PROJECT_ROOT/app/package.json" "$STAGE/app/package.json"
cp "$PROJECT_ROOT/app/package-lock.json" "$STAGE/app/package-lock.json"
for file in portable-core.mjs portable-cli.mjs portable-host.mjs update-core.mjs dsh-cli.mjs; do
  cp "$PROJECT_ROOT/launcher/$file" "$STAGE/launcher/$file"
done
cp "$PROJECT_ROOT/launcher/linux/dsh" "$STAGE/dsh"
chmod 755 "$STAGE/dsh"
cp "$PROJECT_ROOT/launcher/linux/pnpm" "$STAGE/launcher/pnpm"
chmod 755 "$STAGE/launcher/pnpm"
cp "$PROJECT_ROOT/templates/USER-README.txt" "$STAGE/README.txt"
cp "$PROJECT_ROOT/templates/DATA-README.txt" "$STAGE/data/README.txt"
cp "$PROJECT_ROOT/templates/WORKSPACE-README.txt" "$STAGE/workspace/README.txt"
cp "$PROJECT_ROOT/LICENSE" "$STAGE/licenses/DSH-Portable-LICENSE.txt"
cp -R "$NODE_FOLDER"/. "$STAGE/runtime/node/"
chmod 755 "$STAGE/runtime/node/bin/node"
cp "$NODE_FOLDER/LICENSE" "$STAGE/licenses/Node.js-LICENSE.txt"

"$NODE_EXE" "$PROJECT_ROOT/scripts/verify-lock.mjs" "$PROJECT_ROOT/app/package-lock.json" "$LOCK_FILE"
(
  cd "$STAGE/app"
  PATH="$NODE_FOLDER/bin:$PATH" npm_config_cache="$CACHE_DIR/npm" \
    "$NODE_EXE" "$NPM_CLI" ci --omit=dev --no-audit --no-fund --install-links
)
rm -rf "$STAGE/desktop-bridge"
"$NODE_EXE" "$PROJECT_ROOT/scripts/prune-runtime.mjs" "$STAGE/app" linux "$ARCH"
"$NODE_EXE" "$PROJECT_ROOT/scripts/verify-runtime.mjs" "$STAGE/app"

cp "$STAGE/app/node_modules/@deepseek-ai/dsh/LICENSE" "$STAGE/licenses/DeepSeek-Harness-LICENSE.txt"
cp "$STAGE/app/node_modules/pnpm/LICENSE" "$STAGE/licenses/pnpm-LICENSE.txt"
NOTICES="$DOWNLOAD_DIR/DeepSeek-Harness-THIRD_PARTY_NOTICES-$DSH_COMMIT.md"
if [[ ! -f "$NOTICES" ]]; then
  curl --fail --location --retry 3 --output "$NOTICES" "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$DSH_COMMIT/THIRD_PARTY_NOTICES.md"
fi
printf '%s  %s\n' '61f68731049dbea19ba91ad8cf363dd2778c5f7b1f9a63496a6a62c1129eefee' "$NOTICES" | sha256sum --check
cp "$NOTICES" "$STAGE/licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md"

cat > "$STAGE/licenses/COMPONENTS.json" <<EOF
{
  "product": "DSH-Portable",
  "portableVersion": "$PORTABLE_VERSION",
  "platform": "linux-$ARCH",
  "dshPackage": "@deepseek-ai/dsh",
  "dshVersion": "$DSH_VERSION",
  "dshCommit": "$DSH_COMMIT",
  "pnpmVersion": "$(lock_value pnpm.version)",
  "pnpmIntegrity": "$(lock_value pnpm.integrity)",
  "nodeVersion": "$NODE_VERSION",
  "nodeSha256": "$NODE_SHA256",
  "updaterSchema": 1,
  "shellSchema": 2
}
EOF

UPDATE_COMPONENT_ROOT="$BUILD_ROOT/update-component"
UPDATE_COMPONENT="$OUTPUT_DIR/DSH-Portable-update-linux-$ARCH.zip"
UPDATE_MANIFEST="$OUTPUT_DIR/portable-update-linux-$ARCH.json"
mkdir -p "$UPDATE_COMPONENT_ROOT/licenses"
cp -R "$STAGE/app" "$UPDATE_COMPONENT_ROOT/app"
for file in COMPONENTS.json DeepSeek-Harness-LICENSE.txt DeepSeek-Harness-THIRD_PARTY_NOTICES.md pnpm-LICENSE.txt; do
  cp "$STAGE/licenses/$file" "$UPDATE_COMPONENT_ROOT/licenses/$file"
done
cat > "$UPDATE_COMPONENT_ROOT/component.json" <<EOF
{
  "schemaVersion": 1,
  "kind": "dsh-app",
  "portableVersion": "$PORTABLE_VERSION",
  "dshVersion": "$DSH_VERSION",
  "dshCommit": "$DSH_COMMIT"
}
EOF
rm -f "$UPDATE_COMPONENT" "$UPDATE_COMPONENT.sha256"
(
  cd "$UPDATE_COMPONENT_ROOT"
  zip -q -y -r "$UPDATE_COMPONENT" .
)
UPDATE_COMPONENT_HASH="$(sha256sum "$UPDATE_COMPONENT" | awk '{print $1}')"
UPDATE_COMPONENT_BYTES="$(stat -c '%s' "$UPDATE_COMPONENT")"
printf '%s  %s\n' "$UPDATE_COMPONENT_HASH" "$(basename "$UPDATE_COMPONENT")" > "$UPDATE_COMPONENT.sha256"
cat > "$UPDATE_MANIFEST" <<EOF
{
  "schemaVersion": 1,
  "portableVersion": "$PORTABLE_VERSION",
  "platform": "linux-$ARCH",
  "minimumUpdaterSchema": 1,
  "requiredShellSchema": 2,
  "component": {
    "kind": "dsh-app",
    "dshVersion": "$DSH_VERSION",
    "dshCommit": "$DSH_COMMIT",
    "requiredNodeVersion": "$NODE_VERSION",
    "bytes": $UPDATE_COMPONENT_BYTES,
    "sha256": "$UPDATE_COMPONENT_HASH",
    "urls": [
      "https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/DSH-Portable-update-linux-$ARCH.zip"
    ]
  }
}
EOF

rm -rf "$PAYLOAD"
mkdir -p "$PAYLOAD"
for item in app launcher runtime licenses README.txt; do
  cp -R "$STAGE/$item" "$PAYLOAD/$item"
done
(
  cd "$PROJECT_ROOT/launcher/linux"
  RUST_VERSION="$(rustc --version)"
  [[ "$RUST_VERSION" == rustc\ 1.88.0* ]] || { echo "Linux build requires rustc 1.88.0, got: $RUST_VERSION" >&2; exit 1; }
  command -v patchelf >/dev/null || { echo "Linux build requires patchelf" >&2; exit 1; }
  cargo fmt --all -- --check
  cargo metadata --locked --format-version 1 >/dev/null
  npm ci --no-audit --no-fund
  NO_STRIP=true npm exec -- tauri build --verbose --bundles appimage
)

NATIVE_HOST="$PROJECT_ROOT/launcher/linux/target/release/deepseek-herness-linux"
[[ -x "$NATIVE_HOST" ]] || { echo "Linux native host is missing: $NATIVE_HOST" >&2; exit 1; }
cp "$NATIVE_HOST" "$STAGE/DeepSeek-Herness"
chmod 755 "$STAGE/DeepSeek-Herness"

TAR="$OUTPUT_DIR/DSH-Portable-linux-$ARCH.tar.gz"
rm -f "$TAR" "$TAR.sha256"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -czf "$TAR" -C "$BUILD_ROOT" DSH-Portable
TAR_HASH="$(sha256sum "$TAR" | awk '{print $1}')"
printf '%s  %s\n' "$TAR_HASH" "$(basename "$TAR")" > "$TAR.sha256"

APPIMAGE_SOURCE="$(find "$PROJECT_ROOT/launcher/linux/target/release/bundle/appimage" -maxdepth 1 -type f -name '*.AppImage' -print -quit)"
[[ -n "$APPIMAGE_SOURCE" && -f "$APPIMAGE_SOURCE" ]] || { echo "Tauri did not create an AppImage" >&2; exit 1; }
APPIMAGE="$OUTPUT_DIR/DeepSeek-Herness-linux-$ARCH.AppImage"
rm -f "$APPIMAGE" "$APPIMAGE.sha256"
cp "$APPIMAGE_SOURCE" "$APPIMAGE"
chmod 755 "$APPIMAGE"
APPIMAGE_HASH="$(sha256sum "$APPIMAGE" | awk '{print $1}')"
printf '%s  %s\n' "$APPIMAGE_HASH" "$(basename "$APPIMAGE")" > "$APPIMAGE.sha256"

if find "$STAGE/data" -type f ! -name README.txt -print -quit | grep -q .; then
  echo "Portable data is not clean" >&2
  exit 1
fi

printf '{"archive":"%s","archiveSha256":"%s","appImage":"%s","appImageSha256":"%s","updateComponent":"%s","updateComponentSha256":"%s","updateManifest":"%s","architecture":"%s"}\n' \
  "$TAR" "$TAR_HASH" "$APPIMAGE" "$APPIMAGE_HASH" "$UPDATE_COMPONENT" "$UPDATE_COMPONENT_HASH" "$UPDATE_MANIFEST" "$ARCH"
