#!/bin/bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "${1:?usage: smoke-unix-dsh-terminal.sh <finished-product-root>}" && pwd)"
HELPER="$ROOT/launcher/dsh-terminal"
[[ -x "$HELPER" ]] || HELPER="$ROOT/launcher/dsh-terminal.command"
SHIM="$ROOT/launcher/terminal-bin/dsh"
NODE="$ROOT/runtime/node/bin/node"
CLI="$ROOT/launcher/dsh-cli.mjs"

for file in "$HELPER" "$SHIM" "$NODE" "$CLI"; do
  [[ -e "$file" ]] || { echo "DSH Terminal smoke prerequisite is missing: $file" >&2; exit 1; }
done

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-terminal-smoke.XXXXXX")"
TEST_HOME="$TEST_ROOT/home"
PROBE="$TEST_ROOT/probe-shell"
RESULT="$TEST_ROOT/result"
mkdir -p "$TEST_HOME"
printf '%s\n' '# sentinel' > "$TEST_HOME/.profile"
PROFILE_BEFORE="$(shasum -a 256 "$TEST_HOME/.profile" | awk '{print $1}')"
PARENT_PATH="$PATH"

cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT

cat > "$PROBE" <<'EOF'
#!/bin/sh
set -eu
FOUND=$(command -v dsh)
VERSION=$(dsh --version)
printf 'command=%s\nversion=%s\nstate=%s\nportable=%s\n' \
  "$FOUND" "$VERSION" "$DSH_PORTABLE_STATE_ROOT" "$DSH_PORTABLE" > "$DSH_TERMINAL_SMOKE_RESULT"
EOF
chmod 755 "$PROBE"

HOME="$TEST_HOME" \
DSH_PORTABLE_TERMINAL_SHELL="$PROBE" \
DSH_TERMINAL_SMOKE_RESULT="$RESULT" \
  "$HELPER"

EXPECTED="$ROOT/launcher/terminal-bin/dsh"
grep -Fqx "command=$EXPECTED" "$RESULT"
grep -Eq '^version=.+$' "$RESULT"
grep -Fqx "state=$ROOT" "$RESULT"
grep -Fqx 'portable=1' "$RESULT"
[[ "$PATH" == "$PARENT_PATH" ]] || { echo 'Parent PATH was modified' >&2; exit 1; }
[[ "$(shasum -a 256 "$TEST_HOME/.profile" | awk '{print $1}')" == "$PROFILE_BEFORE" ]]
[[ "$(find "$TEST_HOME" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" == 1 ]]

echo 'USER_PATH_UNCHANGED=true shell configuration unchanged'
