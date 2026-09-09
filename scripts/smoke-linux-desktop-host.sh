#!/bin/bash
set -euo pipefail

ROOT="$(realpath "${1:?usage: smoke-linux-desktop-host.sh ROOT}")"
LAUNCHER="$ROOT/DeepSeek-Herness"
NODE="$ROOT/runtime/node/bin/node"
CLI="$ROOT/launcher/portable-cli.mjs"
LOG="$(mktemp "${TMPDIR:-/tmp}/dsh-linux-desktop.XXXXXX.log")"
COOKIE_JAR="$(mktemp "${TMPDIR:-/tmp}/dsh-linux-desktop-cookies.XXXXXX")"
RESPONSE_BODY="$(mktemp "${TMPDIR:-/tmp}/dsh-linux-desktop-response.XXXXXX")"
PID=''
BACKEND_PID=''

cleanup() {
  "$NODE" "$CLI" stop --json >/dev/null 2>&1 || true
  if [[ -n "$PID" ]]; then kill "$PID" >/dev/null 2>&1 || true; fi
  rm -f "$LOG" "$COOKIE_JAR" "$RESPONSE_BODY"
}
trap cleanup EXIT

[[ -x "$LAUNCHER" ]] || { echo "Linux native launcher is missing: $LAUNCHER" >&2; exit 1; }
DSH_PORTABLE_SKIP_UPDATE_CHECK=1 DSH_PORTABLE_TEST_AUTH_RECOVERY=1 "$LAUNCHER" >"$LOG" 2>&1 &
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
BACKEND_PID="$(printf '%s' "$status" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).pid ?? "")))')"
[[ "$BACKEND_PID" =~ ^[0-9]+$ ]] || { cat "$LOG" >&2; echo 'running status did not expose a backend pid' >&2; exit 1; }
kill -0 "$BACKEND_PID" >/dev/null 2>&1 || { cat "$LOG" >&2; echo 'backend exited before auth recovery' >&2; exit 1; }

recovery_deadline=$((SECONDS + 90))
while (( SECONDS < recovery_deadline )); do
  kill -0 "$PID" >/dev/null 2>&1 || { cat "$LOG" >&2; echo 'native Linux host exited during auth recovery' >&2; exit 1; }
  if grep -Fq 'DSH_AUTH_RECOVERY_TEST_PASSED' "$LOG"; then break; fi
  sleep 0.25
done
grep -Fq 'DSH_AUTH_RECOVERY_TEST_PASSED' "$LOG" || { cat "$LOG" >&2; echo 'Linux auth recovery did not reach the real workspace' >&2; exit 1; }
recovered_status="$($NODE "$CLI" status --json 2>/dev/null)"
recovered_backend_pid="$(printf '%s' "$recovered_status" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).pid ?? "")))')"
[[ "$recovered_backend_pid" == "$BACKEND_PID" ]] || { cat "$LOG" >&2; echo 'auth recovery replaced the backend process' >&2; exit 1; }
kill -0 "$BACKEND_PID" >/dev/null 2>&1 || { cat "$LOG" >&2; echo 'backend exited after auth recovery' >&2; exit 1; }

window_id="$(xdotool search --onlyvisible --name '^DeepSeek-Herness$' 2>/dev/null | head -n 1 || true)"
[[ -n "$window_id" ]] || { cat "$LOG" >&2; echo 'native DeepSeek-Herness window was not found' >&2; exit 1; }
command_line="$(ps -ww -p "$PID" -o command=)"
grep -Fq "$LAUNCHER" <<<"$command_line"
if pgrep -P "$PID" -af 'firefox|chromium|google-chrome|microsoft-edge' >/dev/null 2>&1; then
  echo 'native launcher spawned an external browser' >&2
  exit 1
fi

url="$(printf '%s' "$recovered_status" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).url))')"
http_status="$(curl --fail --silent --show-error --location --cookie "$COOKIE_JAR" --cookie-jar "$COOKIE_JAR" --output "$RESPONSE_BODY" --write-out '%{http_code}' "$url")" || {
  cat "$LOG" >&2
  echo 'the authenticated workspace URL did not return successfully' >&2
  exit 1
}
[[ "$http_status" == '200' ]] || { cat "$LOG" >&2; echo "authenticated workspace returned HTTP $http_status" >&2; exit 1; }
grep -Eiq '<!doctype html|<html[ >]' "$RESPONSE_BODY" || { cat "$LOG" >&2; echo 'authenticated workspace response was not HTML' >&2; exit 1; }

"$NODE" "$CLI" stop --json | grep -q '"status":"stopped"'
kill -TERM "$PID"
wait "$PID" || code=$?
if [[ "${code:-0}" -ne 0 && "${code:-0}" -ne 143 ]]; then
  cat "$LOG" >&2
  exit "${code:-1}"
fi
PID=''

printf '{"platform":"linux","windowId":"%s","status":"passed"}\n' "$window_id"
