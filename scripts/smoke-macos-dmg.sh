#!/bin/bash
set -euo pipefail

DMG="${1:?usage: smoke-macos-dmg.sh <dmg>}"
DMG="$(cd "$(dirname "$DMG")" && pwd)/$(basename "$DMG")"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-portable-dmg-smoke.XXXXXX")"
MOUNT="$TEST_ROOT/mount"
INSTALL="$TEST_ROOT/Applications"
STATE="$TEST_ROOT/state"
mkdir -p "$MOUNT" "$INSTALL"

cleanup() {
  hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" >/dev/null
ditto "$MOUNT/DeepSeek-Herness.app" "$INSTALL/DeepSeek-Herness.app"
ditto "$MOUNT/Stop DeepSeek-Herness.app" "$INSTALL/Stop DeepSeek-Herness.app"

APP="$INSTALL/DeepSeek-Herness.app"
STOP_APP="$INSTALL/Stop DeepSeek-Herness.app"
codesign --verify --deep --strict "$APP"
codesign --verify --deep --strict "$STOP_APP"

export DSH_PORTABLE_STATE_ROOT="$STATE"
export DSH_PORTABLE_NO_BROWSER=1
"$APP/Contents/MacOS/DeepSeek-Herness"

NODE="$APP/Contents/Resources/runtime/node/bin/node"
CLI="$APP/Contents/Resources/launcher/portable-cli.mjs"
STATUS="$($NODE "$CLI" status --json)"
URL="$(printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).url))')"
curl --fail --silent --show-error "$URL" >/dev/null

"$STOP_APP/Contents/MacOS/Stop DeepSeek-Herness"
STOPPED="$($NODE "$CLI" status --json)"
printf '%s' "$STOPPED" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).status!=="stopped")process.exit(1)})'
[[ -f "$STATE/data/portable.json" ]]

rm -rf "$APP" "$STOP_APP"
[[ -d "$STATE" ]]
printf '{"dmg":"%s","state":"%s","status":"passed"}\n' "$DMG" "$STATE"
