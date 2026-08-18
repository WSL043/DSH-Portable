#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer only runs on Linux." >&2
  exit 2
fi
if (($# == 0)); then
  echo "Usage: $0 <package> [package ...]" >&2
  exit 2
fi

readonly APT_MAX_ATTEMPTS=2
readonly APT_TIMEOUT_SECONDS=600
readonly APT_KILL_GRACE_SECONDS=15

normalize_github_apt_mirror() {
  [[ "${GITHUB_ACTIONS:-}" == "true" ]] || return 0
  local mirror_file=/etc/apt/apt-mirrors.txt
  [[ -f "$mirror_file" ]] || return 0

  local mirror
  case "$(dpkg --print-architecture)" in
    amd64 | i386)
      mirror=https://archive.ubuntu.com/ubuntu/
      ;;
    arm64 | armhf)
      mirror=https://ports.ubuntu.com/ubuntu-ports/
      ;;
    *)
      return 0
      ;;
  esac
  printf '%s\n' "$mirror" | sudo tee "$mirror_file" >/dev/null
}

run_apt() {
  sudo env DEBIAN_FRONTEND=noninteractive \
    timeout --foreground --signal=TERM --kill-after="${APT_KILL_GRACE_SECONDS}s" "${APT_TIMEOUT_SECONDS}s" \
    apt-get \
      -o Acquire::Retries=2 \
      -o Acquire::http::Timeout=20 \
      -o Acquire::https::Timeout=20 \
      -o DPkg::Lock::Timeout=60 \
      "$@"
}

normalize_github_apt_mirror

for ((attempt = 1; attempt <= APT_MAX_ATTEMPTS; attempt += 1)); do
  echo "Installing Linux dependencies (attempt ${attempt}/${APT_MAX_ATTEMPTS})..."
  if run_apt update && run_apt install -y --no-install-recommends "$@"; then
    exit 0
  fi
  if ((attempt < APT_MAX_ATTEMPTS)); then
    sleep $((attempt * 5))
  fi
done

echo "Linux dependency installation failed after ${APT_MAX_ATTEMPTS} bounded attempts." >&2
exit 1
