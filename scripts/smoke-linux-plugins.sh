#!/bin/bash
set -euo pipefail

ROOT="$(realpath "${1:?usage: smoke-linux-plugins.sh ROOT [FIXTURE]}")"
PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
"$PROJECT_ROOT/scripts/smoke-unix-dsh-terminal.sh" "$ROOT"
FIXTURE="$(realpath "${2:-$PROJECT_ROOT/tests/fixtures/dsh-portable-smoke-plugin}")"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-linux-plugin.XXXXXX")"
TOOLS="$TEST_ROOT/tools"
ARCHIVE="$TEST_ROOT/dsh-portable-smoke-plugin.tgz"
PROFILE=web

cleanup() {
  "$ROOT/runtime/node/bin/node" "$ROOT/launcher/portable-cli.mjs" stop --json >/dev/null 2>&1 || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

for file in \
  "$ROOT/dsh" \
  "$ROOT/runtime/node/bin/node" \
  "$ROOT/launcher/dsh-cli.mjs" \
  "$ROOT/app/node_modules/pnpm/bin/pnpm.mjs"; do
  [[ -f "$file" ]] || { echo "plugin smoke prerequisite is missing: $file" >&2; exit 1; }
done

mkdir -p "$TOOLS"
for tool in dirname pwd; do
  command_path="$(command -v "$tool")"
  ln -s "$command_path" "$TOOLS/$tool"
done
cp -R "$FIXTURE" "$TEST_ROOT/package"
tar -czf "$ARCHIVE" -C "$TEST_ROOT" package

run_dsh() {
  env -i \
    HOME="${HOME:-/tmp}" \
    LANG="${LANG:-C.UTF-8}" \
    PATH="$TOOLS" \
    "$ROOT/dsh" "$@"
}

if env -i PATH="$TOOLS" /bin/sh -c 'command -v node npm npx pnpm dsh' >/dev/null 2>&1; then
  echo "isolated PATH unexpectedly exposes a development runtime" >&2
  exit 1
fi

echo '[linux-plugin-smoke] add/list/dump/remove with bundled Node and pnpm'
mutation="$(run_dsh plugin --profile "$PROFILE" add "$ARCHIVE" 2>&1)"
grep -Eq '不会自动重启|never restarts' <<<"$mutation"
run_dsh plugin --profile "$PROFILE" list --depth 0 --json | grep -q 'dsh-portable-smoke-plugin'
run_dsh --profile "$PROFILE" --dump-config | grep -q 'dsh-portable-smoke-v1'
run_dsh plugin --profile "$PROFILE" remove dsh-portable-smoke-plugin >/dev/null
if run_dsh plugin --profile "$PROFILE" list --depth 0 --json | grep -q 'dsh-portable-smoke-plugin'; then
  echo 'plugin remained installed after remove' >&2
  exit 1
fi

echo '[linux-plugin-smoke] move the finished product and repeat'
MOVED="$ROOT-plugin-moved"
[[ ! -e "$MOVED" ]] || { echo "move target already exists: $MOVED" >&2; exit 1; }
mv "$ROOT" "$MOVED"
ROOT="$MOVED"
run_dsh plugin --profile "$PROFILE" add "$ARCHIVE" >/dev/null
run_dsh --profile "$PROFILE" --dump-config | grep -q 'dsh-portable-smoke-v1'
run_dsh plugin --profile "$PROFILE" remove dsh-portable-smoke-plugin >/dev/null

printf '{"platform":"linux","root":"%s","status":"passed"}\n' "$ROOT"
