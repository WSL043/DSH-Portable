#!/bin/bash
set -euo pipefail

ROOT="$(realpath "${1:?usage: smoke-linux-desktop-host.sh ROOT}")"
LAUNCHER="$ROOT/DeepSeek-Herness"
NODE="$ROOT/runtime/node/bin/node"
CLI="$ROOT/launcher/portable-cli.mjs"
LOG="$(mktemp "${TMPDIR:-/tmp}/dsh-linux-desktop.XXXXXX.log")"
PID=''

cleanup() {
  "$NODE" "$CLI" stop --json >/dev/null 2>&1 || true
  if [[ -n "$PID" ]]; then kill "$PID" >/dev/null 2>&1 || true; fi
  rm -f "$LOG"
}
trap cleanup EXIT

[[ -x "$LAUNCHER" ]] || { echo "Linux native launcher is missing: $LAUNCHER" >&2; exit 1; }
DSH_PORTABLE_SKIP_UPDATE_CHECK=1 "$LAUNCHER" >"$LOG" 2>&1 &
PID=$!

deadline=$((SECONDS + 90))
status=''
while (( SECONDS < deadline )); do
  kill -0 "$PID" >/dev/null 2>&1 || { cat "$LOG" >&2; echo 'native Linux host exited early' >&2; exit 1; }
  status="$($NODE "$CLI" status --json 2>/dev/null || true)"
  grep -q '"status":"running"' <<<"$status" && break
  sleep 0.25
done
grep -q '"status":"running"' <<<"$status" || { cat "$LOG" >&2; echo 'DSH did not become ready' >&2; exit 1; }

window_id="$(xdotool search --onlyvisible --name '^DeepSeek-Herness$' 2>/dev/null | head -n 1 || true)"
[[ -n "$window_id" ]] || { cat "$LOG" >&2; echo 'native DeepSeek-Herness window was not found' >&2; exit 1; }
command_line="$(ps -ww -p "$PID" -o command=)"
grep -Fq "$LAUNCHER" <<<"$command_line"
if pgrep -P "$PID" -af 'firefox|chromium|google-chrome|microsoft-edge' >/dev/null 2>&1; then
  echo 'native launcher spawned an external browser' >&2
  exit 1
fi

url="$(printf '%s' "$status" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).url))')"
curl --fail --silent --show-error "$url" >/dev/null

"$NODE" "$CLI" stop --json | grep -q '"status":"stopped"'
kill -TERM "$PID"
wait "$PID" || code=$?
if [[ "${code:-0}" -ne 0 && "${code:-0}" -ne 143 ]]; then
  cat "$LOG" >&2
  exit "${code:-1}"
fi
PID=''

printf '{"platform":"linux","windowId":"%s","status":"passed"}\n' "$window_id"
