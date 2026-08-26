#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/artifacts}"
CACHE_DIR="${CACHE_DIR:-$PROJECT_ROOT/.cache}"
BUILD_NODE="${BUILD_NODE:-node}"
LOCK_FILE="$PROJECT_ROOT/upstream.lock.json"

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64) ARCH=arm64 ;;
  x86_64|x64) ARCH=x64 ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 2 ;;
esac
RUNTIME_KEY="darwin-$ARCH"

lock_value() {
  "$BUILD_NODE" -e 'const fs=require("fs"); const value=process.argv[2].split(".").reduce((v,k)=>v[k],JSON.parse(fs.readFileSync(process.argv[1],"utf8"))); process.stdout.write(String(value))' "$LOCK_FILE" "$1"
}

NODE_VERSION="$(lock_value node.version)"
NODE_BASE_URL="$(lock_value node.baseUrl)"
NODE_ARCHIVE="$(lock_value node.runtimes.$RUNTIME_KEY.archive)"
NODE_SHA256="$(lock_value node.runtimes.$RUNTIME_KEY.sha256)"
DSH_VERSION="$(lock_value dsh.version)"
DSH_COMMIT="$(lock_value dsh.reviewedCommit)"
DSH_NOTICES_SHA256="$(lock_value dsh.noticesSha256)"
PORTABLE_VERSION="$("$BUILD_NODE" -p 'require(process.argv[1]).version' "$PROJECT_ROOT/package.json")"
DEFAULT_PLUGIN_URL="$(lock_value defaultPlugins.sessionDelete.url)"
DEFAULT_PLUGIN_VERSION="$(lock_value defaultPlugins.sessionDelete.version)"
DEFAULT_PLUGIN_FILENAME="$(lock_value defaultPlugins.sessionDelete.filename)"
DEFAULT_PLUGIN_SHA256="$(lock_value defaultPlugins.sessionDelete.sha256)"
VERSION_POLICY="$("$BUILD_NODE" "$PROJECT_ROOT/scripts/version-policy.mjs" "$PORTABLE_VERSION")"
RELEASE_CHANNEL="$(printf '%s\n' "$VERSION_POLICY" | awk -F= '$1 == "channel" { print $2 }')"
UPDATE_CHANNEL_TAG="$(printf '%s\n' "$VERSION_POLICY" | awk -F= '$1 == "updateChannelTag" { print $2 }')"
[[ -n "$RELEASE_CHANNEL" && -n "$UPDATE_CHANNEL_TAG" ]] || { echo "Product version policy returned no release channel" >&2; exit 1; }

DOWNLOAD_DIR="$CACHE_DIR/downloads"
ARCHIVE="$DOWNLOAD_DIR/$NODE_ARCHIVE"
NODE_CACHE="$CACHE_DIR/node-$NODE_VERSION-$RUNTIME_KEY"
NODE_FOLDER="$NODE_CACHE/node-v$NODE_VERSION-darwin-$ARCH"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-portable-macos.XXXXXX")"
STAGE="$BUILD_ROOT/DSH-Portable"
trap 'rm -rf "$BUILD_ROOT"' EXIT

mkdir -p "$OUTPUT_DIR" "$DOWNLOAD_DIR" "$STAGE"/{app,launcher,runtime/node/bin,licenses,default-plugins,data,workspace}
cp -R "$PROJECT_ROOT/desktop-bridge" "$STAGE/desktop-bridge"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Downloading pinned Node.js runtime: $NODE_BASE_URL/$NODE_ARCHIVE"
  curl --fail --location --retry 3 --output "$ARCHIVE" "$NODE_BASE_URL/$NODE_ARCHIVE"
fi
printf '%s  %s\n' "$NODE_SHA256" "$ARCHIVE" | shasum -a 256 -c -

if [[ ! -x "$NODE_FOLDER/bin/node" ]]; then
  if [[ -e "$NODE_CACHE" ]]; then
    echo "Pinned Node cache is incomplete. Remove only this cache directory and retry: $NODE_CACHE" >&2
    exit 1
  fi
  mkdir -p "$NODE_CACHE"
  tar -xzf "$ARCHIVE" -C "$NODE_CACHE"
fi

NODE_EXE="$NODE_FOLDER/bin/node"
NPM_CLI="$NODE_FOLDER/lib/node_modules/npm/bin/npm-cli.js"
[[ -x "$NODE_EXE" && -f "$NPM_CLI" ]] || { echo "Pinned Node archive is incomplete" >&2; exit 1; }

cp "$PROJECT_ROOT/app/package.json" "$STAGE/app/package.json"
cp "$PROJECT_ROOT/app/package-lock.json" "$STAGE/app/package-lock.json"
cp -R "$PROJECT_ROOT/app/vendor" "$STAGE/app/vendor"
cp "$PROJECT_ROOT/launcher/portable-core.mjs" "$STAGE/launcher/portable-core.mjs"
cp "$PROJECT_ROOT/launcher/portable-cli.mjs" "$STAGE/launcher/portable-cli.mjs"
cp "$PROJECT_ROOT/launcher/repair-core.mjs" "$STAGE/launcher/repair-core.mjs"
cp "$PROJECT_ROOT/launcher/portable-host.mjs" "$STAGE/launcher/portable-host.mjs"
cp "$PROJECT_ROOT/launcher/update-core.mjs" "$STAGE/launcher/update-core.mjs"
cp "$PROJECT_ROOT/launcher/dsh-cli.mjs" "$STAGE/launcher/dsh-cli.mjs"
cp "$PROJECT_ROOT/launcher/data-transfer.mjs" "$STAGE/launcher/data-transfer.mjs"
cp "$PROJECT_ROOT/templates/DATA-MIGRATION.txt" "$STAGE/DATA-MIGRATION.txt"
cp "$PROJECT_ROOT/launcher/http-readiness.mjs" "$STAGE/launcher/http-readiness.mjs"
cp "$PROJECT_ROOT/launcher/default-plugins.mjs" "$STAGE/launcher/default-plugins.mjs"
cp "$PROJECT_ROOT/launcher/macos/dsh" "$STAGE/dsh"
chmod 755 "$STAGE/dsh"
mkdir -p "$STAGE/launcher/terminal-bin"
cp "$PROJECT_ROOT/launcher/unix/dsh-terminal" "$STAGE/launcher/dsh-terminal.command"
cp "$PROJECT_ROOT/launcher/unix/terminal-bin/dsh" "$STAGE/launcher/terminal-bin/dsh"
chmod 755 "$STAGE/launcher/dsh-terminal.command" "$STAGE/launcher/terminal-bin/dsh"
cp "$PROJECT_ROOT/templates/USER-README.txt" "$STAGE/README.txt"
cp "$PROJECT_ROOT/templates/DATA-README.txt" "$STAGE/data/README.txt"
cp "$PROJECT_ROOT/templates/WORKSPACE-README.txt" "$STAGE/workspace/README.txt"
cp "$PROJECT_ROOT/LICENSE" "$STAGE/licenses/DSH-Portable-LICENSE.txt"
cp "$PROJECT_ROOT/NOTICE.md" "$STAGE/licenses/DSH-Portable-NOTICE.md"
cp "$NODE_EXE" "$STAGE/runtime/node/bin/node"
chmod 755 "$STAGE/runtime/node/bin/node"
cp "$NODE_FOLDER/LICENSE" "$STAGE/licenses/Node.js-LICENSE.txt"

DEFAULT_PLUGIN_ARCHIVE="$DOWNLOAD_DIR/$DEFAULT_PLUGIN_VERSION-$DEFAULT_PLUGIN_FILENAME"
if [[ ! -f "$DEFAULT_PLUGIN_ARCHIVE" ]]; then
  curl --fail --location --retry 3 --output "$DEFAULT_PLUGIN_ARCHIVE" "$DEFAULT_PLUGIN_URL"
fi
printf '%s  %s\n' "$DEFAULT_PLUGIN_SHA256" "$DEFAULT_PLUGIN_ARCHIVE" | shasum -a 256 -c -
cp "$DEFAULT_PLUGIN_ARCHIVE" "$STAGE/default-plugins/$DEFAULT_PLUGIN_FILENAME"
tar -xOf "$DEFAULT_PLUGIN_ARCHIVE" package/LICENSE > "$STAGE/licenses/dsh-native-session-delete-LICENSE.txt"
tar -xOf "$DEFAULT_PLUGIN_ARCHIVE" package/THIRD_PARTY_NOTICES.md > "$STAGE/licenses/dsh-native-session-delete-THIRD-PARTY-NOTICES.txt"

"$NODE_EXE" "$PROJECT_ROOT/scripts/verify-lock.mjs" "$PROJECT_ROOT/app/package-lock.json" "$LOCK_FILE"
(
  cd "$STAGE/app"
  PATH="$NODE_FOLDER/bin:$PATH" npm_config_cache="$CACHE_DIR/npm" \
    "$NODE_EXE" "$NPM_CLI" ci --omit=dev --no-audit --no-fund --install-links
)
"$NODE_EXE" "$PROJECT_ROOT/scripts/patch-session-export-ui.mjs" "$STAGE/app"
"$NODE_EXE" "$PROJECT_ROOT/scripts/patch-permission-localization.mjs" "$STAGE/app"
rm -rf "$STAGE/desktop-bridge"
"$NODE_EXE" "$PROJECT_ROOT/scripts/prune-runtime.mjs" "$STAGE/app" darwin "$ARCH"
"$NODE_EXE" "$PROJECT_ROOT/scripts/verify-runtime.mjs" "$STAGE/app"

cp "$STAGE/app/node_modules/@deepseek-ai/dsh/LICENSE" "$STAGE/licenses/DeepSeek-Harness-LICENSE.txt"
cp "$STAGE/app/node_modules/@wsl043/dsh-portable-plugin-market/LICENSE" "$STAGE/licenses/dsh-market-LICENSE.txt"
cp "$STAGE/app/node_modules/pnpm/LICENSE" "$STAGE/licenses/pnpm-LICENSE.txt"
NOTICES="$DOWNLOAD_DIR/DeepSeek-Harness-THIRD_PARTY_NOTICES-$DSH_COMMIT.md"
if [[ ! -f "$NOTICES" ]]; then
  curl --fail --location --retry 3 --output "$NOTICES" "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$DSH_COMMIT/THIRD_PARTY_NOTICES.md"
fi
printf '%s  %s\n' "$DSH_NOTICES_SHA256" "$NOTICES" | shasum -a 256 -c -
cp "$NOTICES" "$STAGE/licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md"

cat > "$STAGE/licenses/COMPONENTS.json" <<EOF
{
  "product": "DSH-Portable",
  "portableVersion": "$PORTABLE_VERSION",
  "releaseChannel": "$RELEASE_CHANNEL",
  "platform": "macos-$ARCH",
  "dshPackage": "@deepseek-ai/dsh",
  "dshVersion": "$DSH_VERSION",
  "dshCommit": "$DSH_COMMIT",
  "pluginMarketPackage": "@wsl043/dsh-portable-plugin-market",
  "pluginMarketVersion": "$(lock_value pluginMarket.version)",
  "defaultPluginPackage": "$(lock_value defaultPlugins.sessionDelete.package)",
  "defaultPluginVersion": "$(lock_value defaultPlugins.sessionDelete.version)",
  "defaultPluginSha256": "$DEFAULT_PLUGIN_SHA256",
  "defaultPluginIntegrity": "$(lock_value defaultPlugins.sessionDelete.integrity)",
  "pnpmVersion": "$(lock_value pnpm.version)",
  "pnpmIntegrity": "$(lock_value pnpm.integrity)",
  "nodeVersion": "$NODE_VERSION",
  "nodeSha256": "$NODE_SHA256",
  "updaterSchema": 1,
  "shellSchema": 16
}
EOF

NATIVE_HOST="$BUILD_ROOT/DeepSeek-Herness"
xcrun swiftc -O -framework AppKit -framework WebKit \
  "$PROJECT_ROOT/launcher/macos/DeepSeek-Herness.swift" \
  -o "$NATIVE_HOST"

APP="$STAGE/DSH-Portable.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$PROJECT_ROOT/launcher/macos/Info.plist" "$APP/Contents/Info.plist"
cp "$NATIVE_HOST" "$APP/Contents/MacOS/DSH-Portable"
cp "$PROJECT_ROOT/assets/DSH-Portable.icns" "$APP/Contents/Resources/DSH-Portable.icns"
chmod 755 "$APP/Contents/MacOS/DSH-Portable"
cp "$PROJECT_ROOT/launcher/macos/Stop DSH-Portable.command" "$STAGE/Stop DSH-Portable.command"
chmod 755 "$STAGE/Stop DSH-Portable.command"

plutil -lint "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

if find "$STAGE/data" -type f ! -name README.txt -print -quit | grep -q .; then
  echo "Portable data is not clean" >&2
  exit 1
fi

UPDATE_COMPONENT_ROOT="$BUILD_ROOT/update-component"
UPDATE_COMPONENT="$OUTPUT_DIR/DSH-Portable-update-macos-$ARCH.zip"
UPDATE_MANIFEST="$OUTPUT_DIR/portable-update-macos-$ARCH.json"
ENGINE_UPDATE_MANIFEST="$OUTPUT_DIR/dsh-core-update-macos-$ARCH.json"
mkdir -p "$UPDATE_COMPONENT_ROOT/licenses"
ditto "$STAGE/app" "$UPDATE_COMPONENT_ROOT/app"
cp "$STAGE/licenses/COMPONENTS.json" "$UPDATE_COMPONENT_ROOT/licenses/COMPONENTS.json"
cp "$STAGE/licenses/DeepSeek-Harness-LICENSE.txt" "$UPDATE_COMPONENT_ROOT/licenses/DeepSeek-Harness-LICENSE.txt"
cp "$STAGE/licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md" "$UPDATE_COMPONENT_ROOT/licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md"
cp "$STAGE/licenses/dsh-market-LICENSE.txt" "$UPDATE_COMPONENT_ROOT/licenses/dsh-market-LICENSE.txt"
cp "$STAGE/licenses/pnpm-LICENSE.txt" "$UPDATE_COMPONENT_ROOT/licenses/pnpm-LICENSE.txt"
cat > "$UPDATE_COMPONENT_ROOT/component.json" <<EOF
{
  "schemaVersion": 1,
  "kind": "dsh-app",
  "portableVersion": "$PORTABLE_VERSION",
  "releaseChannel": "$RELEASE_CHANNEL",
  "dshVersion": "$DSH_VERSION",
  "dshCommit": "$DSH_COMMIT"
}
EOF
rm -f "$UPDATE_COMPONENT" "$UPDATE_COMPONENT.sha256"
ditto -c -k --norsrc "$UPDATE_COMPONENT_ROOT" "$UPDATE_COMPONENT"
UPDATE_COMPONENT_HASH="$(shasum -a 256 "$UPDATE_COMPONENT" | awk '{print $1}')"
UPDATE_COMPONENT_BYTES="$(stat -f '%z' "$UPDATE_COMPONENT")"
printf '%s  %s\n' "$UPDATE_COMPONENT_HASH" "$(basename "$UPDATE_COMPONENT")" > "$UPDATE_COMPONENT.sha256"
cat > "$UPDATE_MANIFEST" <<EOF
{
  "schemaVersion": 1,
  "portableVersion": "$PORTABLE_VERSION",
  "releaseChannel": "$RELEASE_CHANNEL",
  "platform": "macos-$ARCH",
  "minimumUpdaterSchema": 1,
  "requiredShellSchema": 16,
  "component": {
    "kind": "dsh-app",
    "dshVersion": "$DSH_VERSION",
    "dshCommit": "$DSH_COMMIT",
    "requiredNodeVersion": "$NODE_VERSION",
    "bytes": $UPDATE_COMPONENT_BYTES,
    "sha256": "$UPDATE_COMPONENT_HASH",
    "urls": [
      "https://github.com/WSL043/DSH-Portable/releases/download/$UPDATE_CHANNEL_TAG/DSH-Portable-update-macos-$ARCH.zip"
    ]
  }
}
EOF
cat > "$ENGINE_UPDATE_MANIFEST" <<EOF
{
  "schemaVersion": 1,
  "updateKind": "engine",
  "portableVersion": "$PORTABLE_VERSION",
  "releaseChannel": "$RELEASE_CHANNEL",
  "platform": "macos-$ARCH",
  "minimumUpdaterSchema": 1,
  "requiredShellSchema": 16,
  "component": {
    "kind": "dsh-app",
    "dshVersion": "$DSH_VERSION",
    "dshCommit": "$DSH_COMMIT",
    "requiredNodeVersion": "$NODE_VERSION",
    "bytes": $UPDATE_COMPONENT_BYTES,
    "sha256": "$UPDATE_COMPONENT_HASH",
    "urls": [
      "https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-$RELEASE_CHANNEL/DSH-Portable-update-macos-$ARCH.zip"
    ]
  }
}
EOF

ZIP="$OUTPUT_DIR/DSH-Portable-macos-$ARCH.zip"
rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --sequesterRsrc --keepParent "$STAGE" "$ZIP"
HASH="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
printf '%s  %s\n' "$HASH" "$(basename "$ZIP")" > "$ZIP.sha256"
FOOTPRINT="$OUTPUT_DIR/footprint-macos-$ARCH.json"
"$NODE_EXE" "$PROJECT_ROOT/scripts/report-footprint.mjs" "$STAGE" \
  --platform "macos-$ARCH" --archive "$ZIP" \
  --budget "$PROJECT_ROOT/config/footprint-budgets.json" --output "$FOOTPRINT"

printf '{"archive":"%s","sha256":"%s","updateComponent":"%s","updateComponentSha256":"%s","updateManifest":"%s","footprint":"%s","architecture":"%s"}\n' \
  "$ZIP" "$HASH" "$UPDATE_COMPONENT" "$UPDATE_COMPONENT_HASH" "$UPDATE_MANIFEST" "$FOOTPRINT" "$ARCH"
