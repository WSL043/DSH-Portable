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

export function evaluateUpstream({ lock, registry, commit, requestedTag = 'next' }) {
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
  const sourceChanged = commit.sha !== lock.dsh.reviewedCommit
  return {
    changed: packageChanged,
    packageChanged,
    sourceChanged,
    selectedTag,
    version,
    integrity,
    commit: commit.sha,
  }
}
