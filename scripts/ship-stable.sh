#!/usr/bin/env bash
# Publish a tested stable Portable release, but only show it to the in-app updater once the newest official
# cores are qualified on it.
#
#   scripts/ship-stable.sh <version>             full flow
#   scripts/ship-stable.sh <version> --resume    shell already published with the feed held: qualify, then flip
#   scripts/ship-stable.sh <version> --skip-gate publish and flip the feed immediately (emergency only)
#
# Why the feed is held: Portable's updater replaces the whole package. A shell that reaches users before
# compatible cores are available silently drops the core they selected
# (issue #163). So the order is: publish the release assets with the feed held (publish_feed=false), run
# "Sync verified DSH core" in the Updates repository for the five-core window (at least two RCs/finals),
# carrying over stable-catalog cores with the same shell contract and excusing never-qualified blocked cores,
# and only then flip the update feed. If any core fails, the feed stays on the previous shell and the script
# exits non-zero; fix the cause, then rerun with --resume.
#
# Run it from a clean checkout of main after the release commit (version bump + release-notes/v<version>.json)
# is pushed. GitHub's workflow-dispatch API sometimes answers HTTP 500 for a while, so every dispatch is retried
# once a minute. Requires an authenticated gh CLI with access to both repositories.
set -euo pipefail

VERSION="${1:?usage: scripts/ship-stable.sh <version> [--resume|--skip-gate]}"
MODE="${2:-full}"
case "$MODE" in full|--resume|--skip-gate) ;; *) echo "unknown option $MODE" >&2; exit 2 ;; esac
TAG="v${VERSION}"
REPOSITORY="WSL043/DSH-Portable"
UPDATES="WSL043/DSH-Portable-Updates"
GATE_TIMEOUT_MINUTES="${GATE_TIMEOUT_MINUTES:-120}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "stable versions only (x.y.z), got $VERSION" >&2; exit 2; }
[ "$(node -p "require('./package.json').version")" = "$VERSION" ] || { echo "package.json is not at $VERSION" >&2; exit 2; }
[ -f "release-notes/${TAG}.json" ] || { echo "release-notes/${TAG}.json is missing" >&2; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 2; }
git fetch -q origin main
HEAD_SHA="$(git rev-parse HEAD)"
PUBLISH_REF=main
if [ "$MODE" = --resume ]; then
  gh release view "$TAG" -R "$REPOSITORY" >/dev/null 2>&1 || { echo "$TAG is not published yet; run without --resume" >&2; exit 2; }
  # Later commits (docs syncs, script fixes) may have landed on main; the gate and the publish run belong to the
  # commit the release was built from.
  git fetch -q origin "refs/tags/$TAG:refs/tags/$TAG" 2>/dev/null || true
  HEAD_SHA="$(git rev-parse "$TAG^{commit}")"
  PUBLISH_REF="$TAG"
else
  [ "$HEAD_SHA" = "$(git rev-parse origin/main)" ] || { echo "HEAD is not origin/main; push the release commit first" >&2; exit 2; }
  gh release view "$TAG" -R "$REPOSITORY" >/dev/null 2>&1 && { echo "$TAG is already published (use --resume if its feed is still held)" >&2; exit 2; }
fi

dispatch() {
  for _ in $(seq 1 60); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 60
  done
  return 1
}

# The newest run for this exact commit; a push-triggered run can take a moment to appear.
RUN=""
for _ in $(seq 1 30); do
  RUN="$(gh run list -R "$REPOSITORY" -w ci.yml --branch main --limit 10 --json databaseId,headSha \
    -q ".[] | select(.headSha == \"$HEAD_SHA\") | .databaseId" | head -1)"
  [ -n "$RUN" ] && break
  sleep 20
done
[ -n "$RUN" ] || { echo "no main CI run found for ${HEAD_SHA:0:7}" >&2; exit 1; }

publish() { # $1 = true|false: whether the in-app update feed is flipped by this run
  # Flipping the feed happens after the tag exists, and main may have moved on (docs syncs): the publish run must
  # belong to the commit CI tested, which is the tag's commit.
  local ref="$PUBLISH_REF"
  if [ "$1" = true ] && [ "$MODE" != --skip-gate ]; then ref="$TAG"; fi
  dispatch gh workflow run publish.yml -R "$REPOSITORY" --ref "$ref" -f run_id="$RUN" -f tag="$TAG" -f publish_feed="$1" \
    || { echo "could not dispatch the publish workflow" >&2; exit 1; }
  sleep 20
  local publish_run
  publish_run="$(gh run list -R "$REPOSITORY" -w publish.yml --limit 1 --json databaseId -q '.[0].databaseId')"
  until [ "$(gh run view "$publish_run" -R "$REPOSITORY" --json status -q .status 2>/dev/null)" = completed ]; do sleep 30; done
  [ "$(gh run view "$publish_run" -R "$REPOSITORY" --json conclusion -q .conclusion)" = success ] \
    || { echo "publish run $publish_run failed" >&2; exit 1; }
}

if [ "$MODE" != --resume ]; then
  echo "waiting for CI run $RUN (${HEAD_SHA:0:7})"
  # Poll the run state itself: `gh run watch` also returns when the connection drops, long before CI is done.
  until [ "$(gh run view "$RUN" -R "$REPOSITORY" --json status -q .status 2>/dev/null)" = completed ]; do sleep 60; done
  CONCLUSION="$(gh run view "$RUN" -R "$REPOSITORY" --json conclusion -q .conclusion)"
  if [ "$CONCLUSION" != success ]; then
    echo "CI $CONCLUSION; failed jobs:" >&2
    gh run view "$RUN" -R "$REPOSITORY" --json jobs -q '.jobs[] | select(.conclusion == "failure") | .name' >&2
    exit 1
  fi
  if [ "$MODE" = --skip-gate ]; then
    echo "publishing $TAG with the feed flipped immediately (gate skipped)"
    publish true
    gh release list -R "$REPOSITORY" --limit 3 | sed 's/^/release: /'
    exit 0
  fi
  echo "publishing $TAG with the update feed held"
  publish false
  gh release list -R "$REPOSITORY" --limit 3 | sed 's/^/release: /'
fi

# Qualification gate: five-core window, same-contract carry-over, never-qualified blocked cores excused.
gate_state() {
  local state
  # A dropped connection must read as "not known yet", never as a failed gate or a node crash.
  state="$(gh release download update-channel-core -R "$UPDATES" -p qualification-state.json -O - 2>/dev/null)" || return 1
  [ -n "$state" ] || return 1
  # Cores the stable catalog already offers for this shell contract carry over without another run.
  local index contract
  index="$(gh release download update-channel-core-stable -R "$UPDATES" -p dsh-core-index-windows-x64.json -O - 2>/dev/null)" || index='{}'
  contract="$(node scripts/shell-contract.mjs number)"
  printf '%s' "$state" \
    | HEAD_SHORT="${HEAD_SHA:0:7}" CATALOG_INDEX="$index" SHELL_CONTRACT="$contract" node --input-type=module -e "
      import { comparePortableVersions, coreWindow } from './launcher/update-core.mjs'
      let s = ''
      for await (const chunk of process.stdin) s += chunk
      const rows = JSON.parse(s)
      const catalog = JSON.parse(process.env.CATALOG_INDEX || '{}')
      const contract = Number(process.env.SHELL_CONTRACT)
      const versions = coreWindow([...new Set(rows.map(row => row.version))].sort((a, b) => comparePortableVersions(b, a)))
      const here = rows.filter(row => row.sourceSha.startsWith(process.env.HEAD_SHORT))
      // A core that was deliberately blocked and has never qualified on any shell was never offered to users, so
      // this release cannot take it away: it is reported but does not hold the release back.
      const everQualified = new Set(rows.filter(row => row.status === 'success').map(row => row.version))
      const lines = versions.map(version => {
        const row = here.find(item => item.version === version)
        const carried = (catalog.versions ?? []).some(entry => entry.version === version && entry.manifest?.requiredShellContract === contract)
        const status = row ? row.status : carried ? 'success' : 'pending'
        return version + ' ' + (status === 'blocked' && !everQualified.has(version) ? 'excused' : status)
      })
      console.log(lines.join('; '))
      const bad = lines.filter(line => /(failed|blocked)\$/.test(line))
      const open = lines.filter(line => !/(success|excused)\$/.test(line))
      process.exit(bad.length ? 3 : open.length === 0 && lines.some(line => line.endsWith('success')) ? 0 : 1)
    "
}

echo "qualifying the newest official cores on $TAG (feed stays on the previous shell until all pass)"
DEADLINE=$(( $(date +%s) + GATE_TIMEOUT_MINUTES * 60 ))
LAST_DISPATCH=0
while true; do
  set +e
  STATE="$(gate_state)"
  CODE=$?
  set -e
  [ -n "$STATE" ] && echo "gate: $STATE"
  if [ "$CODE" = 0 ]; then break; fi
  if [ "$CODE" = 3 ]; then
    echo "GATE FAILED: a core did not qualify on ${HEAD_SHA:0:7}; the update feed was NOT flipped, users stay on the previous shell." >&2
    echo "Fix the cause (usually the Updates repo verifier or a patch anchor), then run: scripts/ship-stable.sh $VERSION --resume" >&2
    exit 3
  fi
  [ "$(date +%s)" -lt "$DEADLINE" ] || { echo "GATE TIMED OUT after ${GATE_TIMEOUT_MINUTES} minutes; the update feed was NOT flipped." >&2; exit 3; }
  # One core is qualified per run and the runs chain through the queue; start another when nothing is running.
  ACTIVE="$(gh run list -R "$UPDATES" -w "Sync verified DSH core" --limit 5 --json status -q '[.[] | select(.status != "completed")] | length')"
  if [ "${ACTIVE:-0}" = 0 ] && [ $(( $(date +%s) - LAST_DISPATCH )) -gt 300 ]; then
    dispatch gh workflow run "Sync verified DSH core" -R "$UPDATES" || echo "could not dispatch the core qualification yet" >&2
    LAST_DISPATCH="$(date +%s)"
  fi
  sleep 60
done

echo "all cores qualified; flipping the update feed"
publish true
gh release list -R "$REPOSITORY" --limit 3 | sed 's/^/release: /'
