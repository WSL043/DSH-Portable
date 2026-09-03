function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value ?? ''))
  if (!match) return null
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue)
  const right = parseSemver(rightValue)
  if (!left || !right) return 0
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index]
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : (left.prerelease.length === 0 ? 1 : -1)
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart.localeCompare(rightPart, 'en')
  }
  return 0
}

const OFFICIAL_CANDIDATE_TAGS = ['alpha', 'beta', 'rc', 'next', 'latest']
const EXPLICIT_CANDIDATE_TAGS = new Set(['alpha', 'beta', 'rc'])
const CANDIDATE_TRAINS = new Set(['alpha', 'beta', 'rc'])

function candidateTrain(version) {
  const parsed = parseSemver(version)
  const train = parsed?.prerelease?.[0]
  return CANDIDATE_TRAINS.has(train) ? train : null
}

/**
 * Pick the newest official prerelease exposed through the bounded candidate
 * tag set. `next`/`latest` are included because upstream promotes RC builds
 * through those ordinary npm channels; stable versions on either tag are
 * deliberately ignored here and remain the stable intake's responsibility.
 *
 * Explicit alpha/beta/rc tags remain fail-closed: if upstream points one at a
 * different train or a stable build, that is a publishing inconsistency, not
 * permission to silently reinterpret the tag. Unknown prerelease trains on
 * next/latest (dev/canary/nightly) are ignored so those generic tags cannot
 * silently widen Portable's Beta channel.
 */
export function selectPreviewCandidate(registry) {
  const tags = registry?.['dist-tags'] ?? {}
  let selected = null
  for (const tag of OFFICIAL_CANDIDATE_TAGS) {
    const version = tags[tag]
    if (typeof version !== 'string') continue
    const train = candidateTrain(version)
    if (EXPLICIT_CANDIDATE_TAGS.has(tag) && train !== tag) {
      throw new Error(`official npm ${tag} tag does not point to a ${tag} prerelease: ${version}`)
    }
    if (train === null) continue
    const published = registry?.versions?.[version]
    const integrity = published?.dist?.integrity
    if (!integrity) {
      throw new Error(`official npm candidate tag ${tag} has no verifiable package integrity for ${version}`)
    }
    if (selected === null || compareSemver(version, selected.version) > 0) {
      selected = { tag, version, integrity }
    }
  }
  return selected
}

export function evaluatePreviewUpstream({ lock, registry, packageCommit }) {
  const currentVersion = lock.dsh.version
  const currentIntegrity = registry?.versions?.[currentVersion]?.dist?.integrity
  if (currentIntegrity && currentIntegrity !== lock.dsh.npmIntegrity) {
    throw new Error(`integrity changed for the pinned official candidate ${currentVersion}`)
  }

  const selected = selectPreviewCandidate(registry)
  if (selected === null) {
    return {
      changed: false,
      version: currentVersion,
      integrity: lock.dsh.npmIntegrity,
      commit: lock.dsh.reviewedCommit,
    }
  }

  const comparison = compareSemver(selected.version, currentVersion)
  if (comparison <= 0) {
    return {
      changed: false,
      selectedTag: selected.tag,
      version: currentVersion,
      integrity: lock.dsh.npmIntegrity,
      commit: lock.dsh.reviewedCommit,
    }
  }

  const commit = packageCommit?.sha
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
    throw new Error(`official tag dsh-v${selected.version} does not resolve to a commit`)
  }
  return {
    changed: true,
    selectedTag: selected.tag,
    version: selected.version,
    integrity: selected.integrity,
    commit,
  }
}

export function evaluateUpstream({ lock, registry, commit, packageCommit, requestedTag = 'next' }) {
  const tags = registry?.['dist-tags'] ?? {}
  const selectedTag = requestedTag === 'latest'
    ? 'latest'
    : (!tags.next
        ? 'latest'
        : (!tags.latest || compareSemver(tags.next, tags.latest) >= 0 ? 'next' : 'latest'))
  const version = tags[selectedTag]
  const published = registry?.versions?.[version]
  const integrity = published?.dist?.integrity

  if (!version || !integrity) {
    throw new Error(`official npm tag ${selectedTag} has no verifiable package integrity`)
  }
  if (version === lock.dsh.version && integrity !== lock.dsh.integrity) {
    throw new Error(`integrity changed for the pinned DSH version ${version}`)
  }

  const packageChanged = version !== lock.dsh.version
  const reviewedCommit = packageCommit?.sha ?? commit.sha
  const sourceChanged = commit.sha !== lock.dsh.reviewedCommit
  return {
    changed: packageChanged,
    packageChanged,
    sourceChanged,
    selectedTag,
    version,
    integrity,
    commit: reviewedCommit,
    sourceCommit: commit.sha,
  }
}
