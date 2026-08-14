#!/bin/zsh
set -u

PORTABLE_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
NODE="$PORTABLE_ROOT/runtime/node/bin/node"
CLI="$PORTABLE_ROOT/launcher/portable-cli.mjs"

if [[ ! -x "$NODE" || ! -f "$CLI" ]]; then
  echo "This DSH-Portable folder is incomplete."
  exit 1
fi

"$NODE" "$PORTABLE_ROOT/launcher/portable-cli.mjs" stop
STATUS=$?
if [[ $STATUS -ne 0 && -t 0 ]]; then
  echo
  read -k 1 "?Press any key to close."
fi
exit $STATUS
