#!/bin/bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "${1:?usage: smoke-macos-browser-lifecycle.sh <extracted-DSH-Portable-root>}" && pwd)"
NODE="$ROOT/runtime/node/bin/node"
CLI="$ROOT/launcher/portable-cli.mjs"
START="$ROOT/DSH-Portable.app/Contents/MacOS/DSH-Portable"
STOP="$ROOT/Stop DSH-Portable.command"
PROFILE="$ROOT/data/browser"
DECOY_PROFILE="$ROOT/data/browser-decoy"
BROWSER_STATE="$ROOT/data/runtime/browser.json"
HOST_STATE="$ROOT/data/runtime/process.json"

for file in "$NODE" "$CLI" "$START" "$STOP"; do
  [[ -e "$file" ]] || { echo "Missing package entry: $file" >&2; exit 1; }
done

CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
EDGE='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
if [[ -x "$CHROME" ]]; then
  BROWSER="$CHROME"
elif [[ -x "$EDGE" ]]; then
  BROWSER="$EDGE"
else
  echo 'Chrome or Edge is required for the browser lifecycle smoke.' >&2
  exit 1
fi

owned_pids() {
  "$NODE" --input-type=module - "$ROOT" <<'NODE'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.argv[2]
const { isOwnedPortableBrowserProcess, layoutForRoot, queryPosixBrowserProcesses } = await import(
  pathToFileURL(path.join(root, 'launcher', 'portable-core.mjs')).href
)
const layout = layoutForRoot(root, 'darwin')
for (const item of queryPosixBrowserProcesses()) {
  if (isOwnedPortableBrowserProcess(item, layout)) console.log(item.pid)
}
NODE
}

profile_pids() {
  local profile="$1"
  ps -ww -A -o pid=,command= | awk -v needle="--user-data-dir=$profile" 'index($0, needle) { print $1 }'
}

wait_for_owned_browser() {
  local deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    if [[ -n "$(owned_pids)" ]]; then return 0; fi
    sleep 0.2
  done
  return 1
}

kill_profile() {
  local profile="$1"
  local pid
  while read -r pid; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
  done < <(profile_pids "$profile")
}

cleanup() {
  "$NODE" "$CLI" stop --json >/dev/null 2>&1 || true
  kill_profile "$DECOY_PROFILE"
  kill_profile "$PROFILE"
}
trap cleanup EXIT

mkdir -p "$ROOT/data/dsh-home" "$ROOT/workspace"
printf 'browser-lifecycle-data\n' > "$ROOT/data/dsh-home/browser-lifecycle-sentinel.txt"
printf 'browser-lifecycle-workspace\n' > "$ROOT/workspace/browser-lifecycle-sentinel.txt"
DATA_HASH="$(shasum -a 256 "$ROOT/data/dsh-home/browser-lifecycle-sentinel.txt" | awk '{print $1}')"
WORKSPACE_HASH="$(shasum -a 256 "$ROOT/workspace/browser-lifecycle-sentinel.txt" | awk '{print $1}')"

"$START"
wait_for_owned_browser || { echo 'The portable browser did not start with its owned profile.' >&2; exit 1; }
[[ -f "$BROWSER_STATE" ]] || { echo 'The portable browser state was not recorded.' >&2; exit 1; }
OWNED_OBSERVED="$(owned_pids | wc -l | tr -d ' ')"

"$BROWSER" --headless=new --disable-gpu --no-first-run --user-data-dir="$DECOY_PROFILE" about:blank >/dev/null 2>&1 &
DECOY_PID=$!
sleep 1
kill -0 "$DECOY_PID" 2>/dev/null || { echo 'The unrelated browser profile did not stay alive.' >&2; exit 1; }

# Simulate an older package that left its browser alive without browser.json.
rm -f "$BROWSER_STATE"
"$STOP"

[[ -z "$(owned_pids)" ]] || { echo 'Portable browser processes remained after Stop.' >&2; exit 1; }
kill -0 "$DECOY_PID" 2>/dev/null || { echo 'Stop terminated an unrelated browser profile.' >&2; exit 1; }
STATUS="$($NODE "$CLI" status --json)"
printf '%s' "$STATUS" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).status!=="stopped")process.exit(1)})'
[[ ! -e "$HOST_STATE" ]] || { echo 'Host process state remained after Stop.' >&2; exit 1; }
[[ ! -e "$BROWSER_STATE" ]] || { echo 'Browser process state remained after Stop.' >&2; exit 1; }
[[ "$(shasum -a 256 "$ROOT/data/dsh-home/browser-lifecycle-sentinel.txt" | awk '{print $1}')" == "$DATA_HASH" ]]
[[ "$(shasum -a 256 "$ROOT/workspace/browser-lifecycle-sentinel.txt" | awk '{print $1}')" == "$WORKSPACE_HASH" ]]

printf '{"platform":"darwin","browserProcessesObserved":%s,"status":"passed"}\n' "$OWNED_OBSERVED"
