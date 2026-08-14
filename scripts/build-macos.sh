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
PORTABLE_VERSION="$("$BUILD_NODE" -p 'require(process.argv[1]).version' "$PROJECT_ROOT/package.json")"

DOWNLOAD_DIR="$CACHE_DIR/downloads"
ARCHIVE="$DOWNLOAD_DIR/$NODE_ARCHIVE"
NODE_CACHE="$CACHE_DIR/node-$NODE_VERSION-$RUNTIME_KEY"
NODE_FOLDER="$NODE_CACHE/node-v$NODE_VERSION-darwin-$ARCH"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-portable-macos.XXXXXX")"
STAGE="$BUILD_ROOT/DSH-Portable"

mkdir -p "$OUTPUT_DIR" "$DOWNLOAD_DIR" "$STAGE"/{app,launcher,runtime/node/bin,licenses,data,workspace}

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
cp "$PROJECT_ROOT/launcher/portable-core.mjs" "$STAGE/launcher/portable-core.mjs"
cp "$PROJECT_ROOT/launcher/portable-cli.mjs" "$STAGE/launcher/portable-cli.mjs"
cp "$PROJECT_ROOT/launcher/portable-host.mjs" "$STAGE/launcher/portable-host.mjs"
cp "$PROJECT_ROOT/templates/USER-README.txt" "$STAGE/README.txt"
cp "$PROJECT_ROOT/templates/DATA-README.txt" "$STAGE/data/README.txt"
cp "$PROJECT_ROOT/templates/WORKSPACE-README.txt" "$STAGE/workspace/README.txt"
cp "$PROJECT_ROOT/LICENSE" "$STAGE/licenses/DSH-Portable-LICENSE.txt"
cp "$NODE_EXE" "$STAGE/runtime/node/bin/node"
chmod 755 "$STAGE/runtime/node/bin/node"
cp "$NODE_FOLDER/LICENSE" "$STAGE/licenses/Node.js-LICENSE.txt"

"$NODE_EXE" "$PROJECT_ROOT/scripts/verify-lock.mjs" "$PROJECT_ROOT/app/package-lock.json" "$LOCK_FILE"
PATH="$NODE_FOLDER/bin:$PATH" npm_config_cache="$CACHE_DIR/npm" \
  "$NODE_EXE" "$NPM_CLI" ci --prefix "$STAGE/app" --omit=dev --no-audit --no-fund
"$NODE_EXE" "$PROJECT_ROOT/scripts/prune-runtime.mjs" "$STAGE/app" darwin "$ARCH"
"$NODE_EXE" "$PROJECT_ROOT/scripts/verify-runtime.mjs" "$STAGE/app"

cp "$STAGE/app/node_modules/@deepseek-ai/dsh/LICENSE" "$STAGE/licenses/DeepSeek-Harness-LICENSE.txt"
NOTICES="$DOWNLOAD_DIR/DeepSeek-Harness-THIRD_PARTY_NOTICES-$DSH_COMMIT.md"
if [[ ! -f "$NOTICES" ]]; then
  curl --fail --location --retry 3 --output "$NOTICES" "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$DSH_COMMIT/THIRD_PARTY_NOTICES.md"
fi
printf '%s  %s\n' '61f68731049dbea19ba91ad8cf363dd2778c5f7b1f9a63496a6a62c1129eefee' "$NOTICES" | shasum -a 256 -c -
cp "$NOTICES" "$STAGE/licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md"

cat > "$STAGE/licenses/COMPONENTS.json" <<EOF
{
  "product": "DSH-Portable",
  "portableVersion": "$PORTABLE_VERSION",
  "platform": "macos-$ARCH",
  "dshPackage": "@deepseek-ai/dsh",
  "dshVersion": "$DSH_VERSION",
  "dshCommit": "$DSH_COMMIT",
  "nodeVersion": "$NODE_VERSION",
  "nodeSha256": "$NODE_SHA256"
}
EOF

APP="$STAGE/DSH-Portable.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$PROJECT_ROOT/launcher/macos/Info.plist" "$APP/Contents/Info.plist"
cp "$PROJECT_ROOT/launcher/macos/DSH-Portable" "$APP/Contents/MacOS/DSH-Portable"
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

ZIP="$OUTPUT_DIR/DSH-Portable-macos-$ARCH.zip"
rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --sequesterRsrc --keepParent "$STAGE" "$ZIP"
HASH="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
printf '%s  %s\n' "$HASH" "$(basename "$ZIP")" > "$ZIP.sha256"

DMG_ROOT="$BUILD_ROOT/dmg"
INSTALLED_APP="$DMG_ROOT/DeepSeek-Herness.app"
STOP_APP="$DMG_ROOT/Stop DeepSeek-Herness.app"
INSTALLED_RESOURCES="$INSTALLED_APP/Contents/Resources"
mkdir -p \
  "$INSTALLED_APP/Contents/MacOS" \
  "$INSTALLED_RESOURCES" \
  "$STOP_APP/Contents/MacOS" \
  "$STOP_APP/Contents/Resources"

ditto "$STAGE/app" "$INSTALLED_RESOURCES/app"
ditto "$STAGE/launcher" "$INSTALLED_RESOURCES/launcher"
ditto "$STAGE/runtime" "$INSTALLED_RESOURCES/runtime"
ditto "$STAGE/licenses" "$INSTALLED_RESOURCES/licenses"
cp "$PROJECT_ROOT/templates/INSTALLED-MACOS-README.txt" "$DMG_ROOT/README.txt"
cp "$PROJECT_ROOT/launcher/macos/Info-installed.plist" "$INSTALLED_APP/Contents/Info.plist"
cp "$PROJECT_ROOT/launcher/macos/DeepSeek-Herness-installed" "$INSTALLED_APP/Contents/MacOS/DeepSeek-Herness"
cp "$PROJECT_ROOT/assets/DSH-Portable.icns" "$INSTALLED_RESOURCES/DSH-Portable.icns"
chmod 755 "$INSTALLED_APP/Contents/MacOS/DeepSeek-Herness" "$INSTALLED_RESOURCES/runtime/node/bin/node"

cp "$PROJECT_ROOT/launcher/macos/Info-stop-installed.plist" "$STOP_APP/Contents/Info.plist"
cp "$PROJECT_ROOT/launcher/macos/Stop-DeepSeek-Herness-installed" "$STOP_APP/Contents/MacOS/Stop DeepSeek-Herness"
cp "$PROJECT_ROOT/assets/DSH-Portable.icns" "$STOP_APP/Contents/Resources/DSH-Portable.icns"
chmod 755 "$STOP_APP/Contents/MacOS/Stop DeepSeek-Herness"

plutil -lint "$INSTALLED_APP/Contents/Info.plist" "$STOP_APP/Contents/Info.plist"
codesign --force --deep --sign - "$INSTALLED_APP"
codesign --force --deep --sign - "$STOP_APP"
codesign --verify --deep --strict "$INSTALLED_APP"
codesign --verify --deep --strict "$STOP_APP"
ln -s /Applications "$DMG_ROOT/Applications"

DMG="$OUTPUT_DIR/DeepSeek-Herness-macos-$ARCH.dmg"
rm -f "$DMG" "$DMG.sha256"
hdiutil create -volname "DeepSeek-Herness" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG" >/dev/null
DMG_HASH="$(shasum -a 256 "$DMG" | awk '{print $1}')"
printf '%s  %s\n' "$DMG_HASH" "$(basename "$DMG")" > "$DMG.sha256"

printf '{"archive":"%s","sha256":"%s","dmg":"%s","dmgSha256":"%s","stage":"%s","architecture":"%s"}\n' \
  "$ZIP" "$HASH" "$DMG" "$DMG_HASH" "$STAGE" "$ARCH"
