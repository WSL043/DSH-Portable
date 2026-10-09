#!/usr/bin/env bash
# Publish a tested stable Portable release and qualify the newest official cores on it.
#
#   scripts/ship-stable.sh <version> [--no-qualify]
#
# Run it from a clean checkout of main after the release commit (version bump + release-notes/v<version>.json)
# is pushed. It waits for the main CI run of HEAD, dispatches "Publish tested release" with that run, waits
# for the GitHub Release, then starts "Sync verified DSH core" in the Updates repository so the newest cores
# qualify for the new shell. GitHub's workflow-dispatch API sometimes answers HTTP 500 for a while, so every
# dispatch is retried once a minute. Requires an authenticated gh CLI with access to both repositories.
set -euo pipefail

VERSION="${1:?usage: scripts/ship-stable.sh <version> [--no-qualify]}"
QUALIFY=1
[ "${2:-}" = "--no-qualify" ] && QUALIFY=0
TAG="v${VERSION}"
REPOSITORY="WSL043/DSH-Portable"
UPDATES="WSL043/DSH-Portable-Updates"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "stable versions only (x.y.z), got $VERSION" >&2; exit 2; }
[ "$(node -p "require('./package.json').version")" = "$VERSION" ] || { echo "package.json is not at $VERSION" >&2; exit 2; }
[ -f "release-notes/${TAG}.json" ] || { echo "release-notes/${TAG}.json is missing" >&2; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 2; }
git fetch -q origin main
HEAD_SHA="$(git rev-parse HEAD)"
[ "$HEAD_SHA" = "$(git rev-parse origin/main)" ] || { echo "HEAD is not origin/main; push the release commit first" >&2; exit 2; }
gh release view "$TAG" -R "$REPOSITORY" >/dev/null 2>&1 && { echo "$TAG is already published" >&2; exit 2; }

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
echo "waiting for CI run $RUN (${HEAD_SHA:0:7})"
gh run watch "$RUN" -R "$REPOSITORY" --interval 60 >/dev/null 2>&1 || true
CONCLUSION="$(gh run view "$RUN" -R "$REPOSITORY" --json conclusion -q .conclusion)"
if [ "$CONCLUSION" != success ]; then
  echo "CI $CONCLUSION; failed jobs:" >&2
  gh run view "$RUN" -R "$REPOSITORY" --json jobs -q '.jobs[] | select(.conclusion == "failure") | .name' >&2
  exit 1
fi

echo "publishing $TAG"
dispatch gh workflow run publish.yml -R "$REPOSITORY" --ref main -f run_id="$RUN" -f tag="$TAG" \
  || { echo "could not dispatch the publish workflow" >&2; exit 1; }
sleep 20
PUBLISH="$(gh run list -R "$REPOSITORY" -w publish.yml --limit 1 --json databaseId -q '.[0].databaseId')"
gh run watch "$PUBLISH" -R "$REPOSITORY" --exit-status --interval 30 >/dev/null 2>&1 \
  || { echo "publish run $PUBLISH failed" >&2; exit 1; }
gh release view "$TAG" -R "$REPOSITORY" --json tagName,isLatest,isPrerelease -q '"published " + .tagName + " latest=" + (.isLatest|tostring)'

[ "$QUALIFY" = 1 ] || exit 0
echo "qualifying the newest official cores on $TAG"
dispatch gh workflow run "Sync verified DSH core" -R "$UPDATES" \
  || { echo "could not dispatch the core qualification" >&2; exit 1; }
sleep 20
CORE="$(gh run list -R "$UPDATES" -w "Sync verified DSH core" --limit 1 --json databaseId -q '.[0].databaseId')"
gh run watch "$CORE" -R "$UPDATES" --interval 60 >/dev/null 2>&1 || true
gh run view "$CORE" -R "$UPDATES" --json jobs -q '.jobs[] | [.name, .conclusion] | @tsv'
gh release download update-channel-core -R "$UPDATES" -p qualification-state.json -O - 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const x of JSON.parse(s).slice(0,4))console.log(x.version,x.status,x.sourceSha.slice(0,7),x.attemptedAt.slice(0,16))})"
