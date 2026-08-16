#!/bin/bash
set -euo pipefail

SOURCE_APPIMAGE="$(realpath "${1:?usage: smoke-linux-appimage-plugins.sh APPIMAGE [FIXTURE]}")"
PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
FIXTURE="$(realpath "${2:-$PROJECT_ROOT/tests/fixtures/dsh-portable-smoke-plugin}")"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-linux-appimage-plugin.XXXXXX")"
MOVED="$ROOT-moved"
APPIMAGE="$ROOT/DeepSeek-Herness.AppImage"
ARCHIVE="$ROOT/dsh-portable-smoke-plugin.tgz"
PROFILE=web

cleanup() {
  rm -rf "$ROOT" "$MOVED"
}
trap cleanup EXIT

cp "$SOURCE_APPIMAGE" "$APPIMAGE"
chmod 755 "$APPIMAGE"
tar -czf "$ARCHIVE" -C "$(dirname "$FIXTURE")" "$(basename "$FIXTURE")"

run_dsh() {
  APPIMAGE_EXTRACT_AND_RUN=1 DSH_PORTABLE_SKIP_UPDATE_CHECK=1 \
    "$APPIMAGE" dsh "$@"
}

echo '[linux-appimage-plugin-smoke] add/list/dump/remove from the one-click package'
mutation="$(run_dsh plugin --profile "$PROFILE" add "$ARCHIVE" 2>&1)"
grep -Eq '不会自动重启|never restarts' <<<"$mutation"
run_dsh plugin --profile "$PROFILE" list --depth 0 --json | grep -q 'dsh-portable-smoke-plugin'
run_dsh --profile "$PROFILE" --dump-config | grep -q 'dsh-portable-smoke-v1'
run_dsh plugin --profile "$PROFILE" remove dsh-portable-smoke-plugin >/dev/null
[[ -d "$ROOT/DSH-Portable-data/data/dsh-home/profiles/$PROFILE" ]]

echo '[linux-appimage-plugin-smoke] move the AppImage and its portable data together'
mv "$ROOT" "$MOVED"
ROOT="$MOVED"
APPIMAGE="$ROOT/DeepSeek-Herness.AppImage"
ARCHIVE="$ROOT/dsh-portable-smoke-plugin.tgz"
run_dsh plugin --profile "$PROFILE" add "$ARCHIVE" >/dev/null
run_dsh --profile "$PROFILE" --dump-config | grep -q 'dsh-portable-smoke-v1'
run_dsh plugin --profile "$PROFILE" remove dsh-portable-smoke-plugin >/dev/null

printf '{"platform":"linux-appimage","root":"%s","status":"passed"}\n' "$ROOT"
