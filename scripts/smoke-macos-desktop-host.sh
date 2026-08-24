#!/bin/bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "${1:?usage: smoke-macos-desktop-host.sh <extracted-DSH-Portable-root>}" && pwd)"
"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/smoke-unix-dsh-terminal.sh" "$ROOT"
NODE="$ROOT/runtime/node/bin/node"
CLI="$ROOT/launcher/portable-cli.mjs"
APP="$ROOT/DSH-Portable.app"
START="$APP/Contents/MacOS/DSH-Portable"
BROWSER_STATE="$ROOT/data/runtime/browser.json"
WORKSPACE_MARKER="$ROOT/workspace/desktop-host-smoke.txt"
HOME_MARKER="$ROOT/data/dsh-home/desktop-host-smoke.txt"
WINDOW_PROBE_SOURCE="$(mktemp "${TMPDIR:-/tmp}/dsh-window-probe.XXXXXX.swift")"
WINDOW_PROBE="${WINDOW_PROBE_SOURCE%.swift}"

for file in "$NODE" "$CLI" "$START"; do
  [[ -e "$file" ]] || { echo "Missing package entry: $file" >&2; exit 1; }
done
otool -L "$START" | grep -q 'WebKit.framework' || { echo 'Native host is not linked to WebKit/WKWebView.' >&2; exit 1; }

cat > "$WINDOW_PROBE_SOURCE" <<'SWIFT'
import CoreGraphics
import Darwin
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]) else {
    exit(2)
}
let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
let count = entries.filter { entry in
    let owner = (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
    let layer = (entry[kCGWindowLayer as String] as? NSNumber)?.intValue
    return owner == pid && layer == 0
}.count
print(count)
SWIFT
xcrun swiftc "$WINDOW_PROBE_SOURCE" -framework CoreGraphics -o "$WINDOW_PROBE"

cleanup() {
  "$NODE" "$CLI" stop --no-browser --json >/dev/null 2>&1 || true
  [[ -n "${HOST_PID:-}" ]] && kill -TERM "$HOST_PID" 2>/dev/null || true
  [[ -n "${LAUNCH_PID:-}" ]] && kill -TERM "$LAUNCH_PID" 2>/dev/null || true
  rm -f "$WINDOW_PROBE_SOURCE" "$WINDOW_PROBE"
}
trap cleanup EXIT

mkdir -p "$(dirname "$WORKSPACE_MARKER")" "$(dirname "$HOME_MARKER")"
printf 'workspace survives native host shutdown\n' > "$WORKSPACE_MARKER"
printf 'home survives native host shutdown\n' > "$HOME_MARKER"
WORKSPACE_HASH="$(shasum -a 256 "$WORKSPACE_MARKER" | awk '{print $1}')"
HOME_HASH="$(shasum -a 256 "$HOME_MARKER" | awk '{print $1}')"

case "$(uname -m)" in
  arm64|x86_64)
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac
/usr/bin/open -n -W "$APP" --args --skip-update-check >/tmp/dsh-portable-native-host.log 2>&1 &
LAUNCH_PID=$!
deadline=$((SECONDS + 30))
while (( SECONDS < deadline )); do
  HOST_PID="$(pgrep -f "$START" | head -n 1 || true)"
  [[ -n "$HOST_PID" ]] && break
  kill -0 "$LAUNCH_PID" 2>/dev/null || {
    cat /tmp/dsh-portable-native-host.log >&2
    echo 'LaunchServices exited before the native host appeared.' >&2
    exit 1
  }
  sleep 0.25
done
[[ -n "${HOST_PID:-}" ]] || {
  cat /tmp/dsh-portable-native-host.log >&2
  echo 'LaunchServices did not start the native host.' >&2
  exit 1
}
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  kill -0 "$HOST_PID" 2>/dev/null || { cat /tmp/dsh-portable-native-host.log >&2; echo 'Native host exited before ready.' >&2; exit 1; }
  STATUS="$($NODE "$CLI" status --json 2>/dev/null || true)"
  READY="$(printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).status||"")}catch{}})' )"
  if [[ "$READY" == 'running' ]]; then
    WINDOWS="$("$WINDOW_PROBE" "$HOST_PID" 2>/dev/null || echo 0)"
    [[ "$WINDOWS" -gt 0 ]] && break
  fi
  sleep 0.25
done
if [[ "${READY:-}" != 'running' || "${WINDOWS:-0}" -le 0 ]]; then
  printf 'Native DSH-Portable.app window did not become ready (status=%s, windows=%s, pid=%s).\n' \
    "${READY:-unknown}" "${WINDOWS:-0}" "$HOST_PID" >&2
  ps -p "$HOST_PID" -o pid=,comm=,state= >&2 || true
  cat /tmp/dsh-portable-native-host.log >&2 || true
  exit 1
fi
[[ ! -e "$BROWSER_STATE" ]] || { echo 'Native desktop startup created legacy browser.json state.' >&2; exit 1; }
if ps -ww -A -o command= | grep -E '[Cc]hrome|Microsoft Edge' | grep -E -- '--app=|data/browser' >/dev/null; then
  echo 'Native desktop startup launched a Chrome/Edge app-mode window.' >&2
  exit 1
fi

/usr/bin/osascript -e 'tell application id "io.github.wsl043.dsh-portable" to quit'
deadline=$((SECONDS + 45))
while kill -0 "$HOST_PID" 2>/dev/null && (( SECONDS < deadline )); do sleep 0.25; done
kill -0 "$HOST_PID" 2>/dev/null && { echo 'Native host did not exit after the app quit request.' >&2; exit 1; }
if [[ -n "${LAUNCH_PID:-}" ]]; then
  wait "$LAUNCH_PID"
  LAUNCH_PID=''
else
  wait "$HOST_PID"
fi
STATUS="$($NODE "$CLI" status --json)"
printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).status!=="stopped")process.exit(1)})'
[[ "$(shasum -a 256 "$WORKSPACE_MARKER" | awk '{print $1}')" == "$WORKSPACE_HASH" ]]
[[ "$(shasum -a 256 "$HOME_MARKER" | awk '{print $1}')" == "$HOME_HASH" ]]

printf '{"platform":"darwin","hostPid":%s,"windowCount":%s,"renderer":"WebKit","status":"passed"}\n' "$HOST_PID" "$WINDOWS"
