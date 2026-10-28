#!/bin/bash
set -euo pipefail

[[ "$#" -eq 3 ]] || { echo "usage: download-pinned-node.sh <archive> <sha256> <url>" >&2; exit 2; }
ARCHIVE="$1"
SHA256="$2"
URL="$3"
[[ "$SHA256" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid pinned Node SHA256" >&2; exit 2; }

if command -v sha256sum >/dev/null 2>&1; then
  HASH_COMMAND=(sha256sum)
else
  HASH_COMMAND=(shasum -a 256)
fi

require_regular_target() {
  if [[ -L "$ARCHIVE" || ( -e "$ARCHIVE" && ! -f "$ARCHIVE" ) ]]; then
    echo "Refusing non-regular Node archive: $ARCHIVE" >&2
    return 1
  fi
}

verify_archive() {
  [[ -f "$1" && ! -L "$1" ]] || return 1
  local digest
  digest="$("${HASH_COMMAND[@]}" < "$1")" || return 1
  [[ "${digest%% *}" == "$SHA256" ]]
}

require_regular_target
if verify_archive "$ARCHIVE"; then
  echo "Using verified pinned Node.js runtime: $ARCHIVE"
  exit 0
fi

# Keep the old cache untouched until a complete replacement passes its pin.
PARTIAL="$(mktemp "$ARCHIVE.part.XXXXXX")"
trap 'rm -f "$PARTIAL"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
echo "Downloading pinned Node.js runtime: $URL"
for attempt in 1 2 3; do
  if curl --fail --location --connect-timeout 20 --max-time 300 \
    --speed-time 60 --speed-limit 16384 --continue-at - --output "$PARTIAL" "$URL"; then
    break
  else
    status="$?"
  fi
  echo "Pinned Node download attempt $attempt failed (curl $status)." >&2
  # A server ignoring Range requires a fresh transfer, never an appended body.
  if [[ "$status" -eq 33 ]]; then : > "$PARTIAL"; fi
  [[ "$attempt" -lt 3 ]] || exit "$status"
  sleep "$attempt"
done
verify_archive "$PARTIAL" || { echo "Pinned Node archive SHA256 mismatch" >&2; exit 1; }
require_regular_target
mv -f "$PARTIAL" "$ARCHIVE"
