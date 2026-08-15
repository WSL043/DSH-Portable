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
  [[ -n "${HOST_PID:-}" ]] && kill -TERM "$HOST_PID" 2>/dev/null || true
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
export DSH_PORTABLE_SKIP_UPDATE_CHECK=1
HOST_LOG="$TEST_ROOT/native-host.log"
"$APP/Contents/MacOS/DeepSeek-Herness" >"$HOST_LOG" 2>&1 &
HOST_PID=$!

NODE="$APP/Contents/Resources/runtime/node/bin/node"
CLI="$APP/Contents/Resources/launcher/portable-cli.mjs"
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  kill -0 "$HOST_PID" 2>/dev/null || { cat "$HOST_LOG" >&2; echo 'Installed native host exited before ready.' >&2; exit 1; }
  STATUS="$($NODE "$CLI" status --json 2>/dev/null || true)"
  READY="$(printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).status||"")}catch{}})')"
  [[ "$READY" == 'running' ]] && break
  sleep 0.25
done
[[ "${READY:-}" == 'running' ]] || { cat "$HOST_LOG" >&2; echo 'Installed native host did not become ready.' >&2; exit 1; }
URL="$(printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).url))')"
curl --fail --silent --show-error "$URL" >/dev/null

"$STOP_APP/Contents/MacOS/Stop DeepSeek-Herness"
STOPPED="$($NODE "$CLI" status --json)"
printf '%s' "$STOPPED" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).status!=="stopped")process.exit(1)})'
[[ -f "$STATE/data/portable.json" ]]

/usr/bin/osascript -e 'tell application id "io.github.wsl043.dsh-portable.installed" to quit'
deadline=$((SECONDS + 45))
while kill -0 "$HOST_PID" 2>/dev/null && (( SECONDS < deadline )); do sleep 0.25; done
kill -0 "$HOST_PID" 2>/dev/null && { cat "$HOST_LOG" >&2; echo 'Installed native host did not exit after the quit request.' >&2; exit 1; }
wait "$HOST_PID" || { cat "$HOST_LOG" >&2; echo 'Installed native host exited unsuccessfully.' >&2; exit 1; }
HOST_PID=''

rm -rf "$APP" "$STOP_APP"
[[ -d "$STATE" ]]
printf '{"dmg":"%s","state":"%s","status":"passed"}\n' "$DMG" "$STATE"
