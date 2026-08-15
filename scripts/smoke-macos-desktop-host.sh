#!/bin/bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "${1:?usage: smoke-macos-desktop-host.sh <extracted-DSH-Portable-root>}" && pwd)"
NODE="$ROOT/runtime/node/bin/node"
CLI="$ROOT/launcher/portable-cli.mjs"
APP="$ROOT/DSH-Portable.app"
START="$APP/Contents/MacOS/DSH-Portable"
BROWSER_STATE="$ROOT/data/runtime/browser.json"
WORKSPACE_MARKER="$ROOT/workspace/desktop-host-smoke.txt"
HOME_MARKER="$ROOT/data/dsh-home/desktop-host-smoke.txt"

for file in "$NODE" "$CLI" "$START"; do
  [[ -e "$file" ]] || { echo "Missing package entry: $file" >&2; exit 1; }
done
otool -L "$START" | grep -q 'WebKit.framework' || { echo 'Native host is not linked to WebKit/WKWebView.' >&2; exit 1; }

cleanup() {
  "$NODE" "$CLI" stop --no-browser --json >/dev/null 2>&1 || true
  [[ -n "${HOST_PID:-}" ]] && kill -TERM "$HOST_PID" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$(dirname "$WORKSPACE_MARKER")" "$(dirname "$HOME_MARKER")"
printf 'workspace survives native host shutdown\n' > "$WORKSPACE_MARKER"
printf 'home survives native host shutdown\n' > "$HOME_MARKER"
WORKSPACE_HASH="$(shasum -a 256 "$WORKSPACE_MARKER" | awk '{print $1}')"
HOME_HASH="$(shasum -a 256 "$HOME_MARKER" | awk '{print $1}')"

DSH_PORTABLE_SKIP_UPDATE_CHECK=1 "$START" >/tmp/dsh-portable-native-host.log 2>&1 &
HOST_PID=$!
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  kill -0 "$HOST_PID" 2>/dev/null || { cat /tmp/dsh-portable-native-host.log >&2; echo 'Native host exited before ready.' >&2; exit 1; }
  STATUS="$($NODE "$CLI" status --json 2>/dev/null || true)"
  READY="$(printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).status||"")}catch{}})' )"
  WINDOWS="$(/usr/bin/osascript -e 'tell application "System Events" to count windows of first process whose unix id is '"$HOST_PID" 2>/dev/null || echo 0)"
  if [[ "$READY" == 'running' && "$WINDOWS" -gt 0 ]]; then break; fi
  sleep 0.25
done
[[ "${READY:-}" == 'running' && "${WINDOWS:-0}" -gt 0 ]] || { echo 'Native DSH-Portable.app window did not become ready.' >&2; exit 1; }
[[ ! -e "$BROWSER_STATE" ]] || { echo 'Native desktop startup created legacy browser.json state.' >&2; exit 1; }
if ps -ww -A -o command= | grep -E '[Cc]hrome|Microsoft Edge' | grep -E -- '--app=|data/browser' >/dev/null; then
  echo 'Native desktop startup launched a Chrome/Edge app-mode window.' >&2
  exit 1
fi

/usr/bin/osascript -e 'tell application id "io.github.wsl043.dsh-portable" to quit'
deadline=$((SECONDS + 45))
while kill -0 "$HOST_PID" 2>/dev/null && (( SECONDS < deadline )); do sleep 0.25; done
kill -0 "$HOST_PID" 2>/dev/null && { echo 'Native host did not exit after the app quit request.' >&2; exit 1; }
STATUS="$($NODE "$CLI" status --json)"
printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).status!=="stopped")process.exit(1)})'
[[ "$(shasum -a 256 "$WORKSPACE_MARKER" | awk '{print $1}')" == "$WORKSPACE_HASH" ]]
[[ "$(shasum -a 256 "$HOME_MARKER" | awk '{print $1}')" == "$HOME_HASH" ]]

printf '{"platform":"darwin","hostPid":%s,"windowCount":%s,"renderer":"WebKit","status":"passed"}\n' "$HOST_PID" "$WINDOWS"
