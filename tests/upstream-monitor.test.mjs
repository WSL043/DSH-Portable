import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { evaluatePreviewUpstream, evaluateUpstream } from '../scripts/upstream-state.mjs'

test('the upstream refresher supports both standard and bundled Windows Node layouts', async () => {
  const source = await readFile(new URL('../scripts/update-upstream.mjs', import.meta.url), 'utf8')
  assert.match(source, /process\.env\.npm_execpath/)
  assert.match(source, /path\.dirname\(process\.execPath\)[\s\S]*node_modules[\s\S]*npm-cli\.js/)
  assert.match(source, /path\.dirname\(path\.dirname\(process\.execPath\)\)[\s\S]*node_modules[\s\S]*npm-cli\.js/)
  assert.match(source, /npm CLI was not found beside the active Node runtime/)
  assert.match(source, /timeout:\s*30 \* 60 \* 1000/)
  assert.doesNotMatch(source, /'--legacy-peer-deps'/)
  assert.match(source, /dsh-portable-plugin-market[\s\S]*@deepseek-ai\/dsh-settings/)
  assert.match(source, /const verifiedTrain = `\^\$\{version\}`/)
})

const lock = {
  dsh: {
    version: '0.1.0-rc.6',
    integrity: 'sha512-current',
    reviewedCommit: 'a'.repeat(40),
  },
}

function registry({ latest = '0.1.0-rc.6', next = '0.1.0-rc.6', integrity = 'sha512-current' } = {}) {
  const tags = { latest }
  if (next) tags.next = next
  return {
    'dist-tags': tags,
    versions: {
      [latest]: { dist: { integrity: latest === '0.1.0-rc.6' ? integrity : 'sha512-latest' } },
      ...(next ? { [next]: { dist: { integrity: next === '0.1.0-rc.6' ? integrity : 'sha512-next' } } } : {}),
    },
  }
}

test('unpublished master commits are observed without creating an installable candidate', () => {
  const result = evaluateUpstream({
    lock,
    registry: registry(),
    commit: { sha: 'b'.repeat(40) },
  })

  assert.equal(result.changed, false)
  assert.equal(result.packageChanged, false)
  assert.equal(result.sourceChanged, true)
  assert.equal(result.version, '0.1.0-rc.6')
})

test('a published preview is an installable candidate with pinned integrity', () => {
  const result = evaluateUpstream({
    lock,
    registry: registry({ next: '0.1.0-rc.7' }),
    commit: { sha: 'b'.repeat(40) },
    packageCommit: { sha: 'c'.repeat(40) },
  })

  assert.equal(result.changed, true)
  assert.equal(result.packageChanged, true)
  assert.equal(result.selectedTag, 'next')
  assert.equal(result.version, '0.1.0-rc.7')
  assert.equal(result.integrity, 'sha512-next')
  assert.equal(result.commit, 'c'.repeat(40))
  assert.equal(result.sourceCommit, 'b'.repeat(40))
})

test('a published package is pinned to its matching tag even when master moves later', () => {
  const result = evaluateUpstream({
    lock,
    registry: registry({ next: '0.1.0-rc.7' }),
    commit: { sha: 'd'.repeat(40) },
    packageCommit: { sha: 'c'.repeat(40) },
  })

  assert.equal(result.changed, true)
  assert.equal(result.commit, 'c'.repeat(40))
  assert.equal(result.sourceCommit, 'd'.repeat(40))
  assert.equal(result.sourceChanged, true)
})

test('the monitor falls back to latest when the preview tag is absent', () => {
  const result = evaluateUpstream({
    lock,
    registry: registry({ latest: '0.1.0', next: '' }),
    commit: { sha: 'b'.repeat(40) },
  })

  assert.equal(result.selectedTag, 'latest')
  assert.equal(result.version, '0.1.0')
  assert.equal(result.changed, true)
})

test('a newer stable release wins when next still points at an older preview', () => {
  const result = evaluateUpstream({
    lock,
    registry: registry({ latest: '0.1.0', next: '0.1.0-rc.6' }),
    commit: { sha: 'b'.repeat(40) },
  })

  assert.equal(result.selectedTag, 'latest')
  assert.equal(result.version, '0.1.0')
  assert.equal(result.changed, true)
})

test('older npm dist-tags never downgrade an already reviewed core', () => {
  const reviewed = {
    dsh: { version: '0.1.7-alpha.1', integrity: 'sha512-reviewed', reviewedCommit: 'a'.repeat(40) },
  }
  const older = {
    'dist-tags': { latest: '0.1.5-rc.3', next: '0.1.5-rc.3' },
    versions: {
      '0.1.5-rc.3': { dist: { integrity: 'sha512-older' } },
      '0.1.7-alpha.1': { dist: { integrity: 'sha512-reviewed' } },
    },
  }
  const result = evaluateUpstream({ lock: reviewed, registry: older, commit: { sha: 'b'.repeat(40) } })
  assert.equal(result.changed, false)
  assert.equal(result.packageChanged, false)
  assert.equal(result.sourceChanged, true)
  assert.equal(result.version, reviewed.dsh.version)
  assert.equal(result.integrity, reviewed.dsh.integrity)
  assert.equal(result.commit, reviewed.dsh.reviewedCommit)
  older.versions['0.1.7-alpha.1'].dist.integrity = 'sha512-changed'
  assert.throws(() => evaluateUpstream({ lock: reviewed, registry: older, commit: { sha: 'b'.repeat(40) } }),
    /integrity changed for the pinned DSH version/)
})

test('same-version integrity drift fails closed instead of silently replacing the lock', () => {
  assert.throws(() => evaluateUpstream({
    lock,
    registry: registry({ integrity: 'sha512-replaced' }),
    commit: { sha: 'b'.repeat(40) },
  }), /integrity changed for the pinned DSH version/i)
})

const previewLock = {
  dsh: {
    version: '0.1.2-alpha.2',
    npmIntegrity: 'sha512-preview-current',
    reviewedCommit: 'd'.repeat(40),
  },
}

function previewRegistry({
  alpha = '0.1.2-alpha.2',
  next = '0.1.1-rc.2',
  latest = '0.1.1-rc.2',
  beta,
  rc,
  integrity = 'sha512-preview-current',
  integrities = {},
} = {}) {
  const tags = { alpha, next, latest }
  if (beta) tags.beta = beta
  if (rc) tags.rc = rc
  const versions = {}
  for (const version of new Set(Object.values(tags).filter(Boolean))) {
    versions[version] = {
      dist: {
        integrity: integrities[version]
          ?? (version === '0.1.2-alpha.2' ? integrity : `sha512-${version}`),
      },
    }
  }
  return { 'dist-tags': tags, versions }
}

test('a newer official alpha becomes a review-only candidate', () => {
  const result = evaluatePreviewUpstream({
    lock: previewLock,
    registry: previewRegistry({
      alpha: '0.1.2-alpha.3',
      integrities: { '0.1.2-alpha.3': 'sha512-preview-next' },
    }),
    packageCommit: { sha: 'e'.repeat(40) },
  })

  assert.equal(result.changed, true)
  assert.equal(result.selectedTag, 'alpha')
  assert.equal(result.version, '0.1.2-alpha.3')
  assert.equal(result.integrity, 'sha512-preview-next')
  assert.equal(result.commit, 'e'.repeat(40))
})

test('rejected immutable candidate is not reopened, while a newer release remains eligible', () => {
  const rejectedCandidates = [{ version: '0.1.2-rc.1', integrity: 'sha512-0.1.2-rc.1', reason: 'historical migration failure' }]
  const registry = previewRegistry({ alpha: '0.1.2-alpha.5', next: '0.1.2-rc.1' })
  const blocked = evaluatePreviewUpstream({ lock: previewLock, registry, rejectedCandidates })
  assert.equal(blocked.changed, false)
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.rejectedVersion, '0.1.2-rc.1')
  assert.equal(blocked.version, previewLock.dsh.version)
  assert.throws(() => evaluatePreviewUpstream({ lock: previewLock,
    registry: previewRegistry({ alpha: '0.1.2-alpha.5', next: '0.1.2-rc.1', integrities: { '0.1.2-rc.1': 'sha512-changed' } }),
    rejectedCandidates }), /integrity changed for the rejected/)
  const next = evaluatePreviewUpstream({ lock: previewLock,
    registry: previewRegistry({ alpha: '0.1.2-alpha.5', next: '0.1.2-rc.2' }),
    packageCommit: { sha: 'f'.repeat(40) }, rejectedCandidates })
  assert.equal(next.changed, true)
  assert.equal(next.version, '0.1.2-rc.2')
  const laterLock = { dsh: { version: '0.1.2-rc.2', npmIntegrity: 'sha512-0.1.2-rc.2', reviewedCommit: 'f'.repeat(40) } }
  const olderTag = evaluatePreviewUpstream({ lock: laterLock, registry, rejectedCandidates })
  assert.equal(olderTag.changed, false)
  assert.notEqual(olderTag.blocked, true)
})

test('a newer release candidate on next outranks the alpha train', () => {
  const result = evaluatePreviewUpstream({
    lock: previewLock,
    registry: previewRegistry({
      alpha: '0.1.2-alpha.5',
      next: '0.1.2-rc.1',
    }),
    packageCommit: { sha: 'f'.repeat(40) },
  })

  assert.equal(result.changed, true)
  assert.equal(result.selectedTag, 'next')
  assert.equal(result.version, '0.1.2-rc.1')
  assert.equal(result.integrity, 'sha512-0.1.2-rc.1')
  assert.equal(result.commit, 'f'.repeat(40))
})

test('an explicit rc tag is eligible even when next has not moved yet', () => {
  const result = evaluatePreviewUpstream({
    lock: previewLock,
    registry: previewRegistry({
      alpha: '0.1.2-alpha.5',
      rc: '0.1.2-rc.1',
    }),
    packageCommit: { sha: 'f'.repeat(40) },
  })

  assert.equal(result.changed, true)
  assert.equal(result.selectedTag, 'rc')
  assert.equal(result.version, '0.1.2-rc.1')
})

test('a stable latest never replaces the review-only candidate lock', () => {
  const rcLock = {
    dsh: {
      version: '0.1.2-rc.1',
      npmIntegrity: 'sha512-rc-current',
      reviewedCommit: 'f'.repeat(40),
    },
  }
  const result = evaluatePreviewUpstream({
    lock: rcLock,
    registry: previewRegistry({
      alpha: '0.1.2-alpha.5',
      next: '0.1.2',
      latest: '0.1.2',
    }),
    packageCommit: { sha: 'a'.repeat(40) },
  })

  assert.equal(result.changed, false)
  assert.equal(result.version, '0.1.2-rc.1')
  assert.equal(result.commit, 'f'.repeat(40))
})

test('explicit candidate tags fail closed when upstream points them at the wrong train', () => {
  assert.throws(() => evaluatePreviewUpstream({
    lock: previewLock,
    registry: previewRegistry({ alpha: '0.1.2' }),
    packageCommit: { sha: 'e'.repeat(40) },
  }), /alpha tag does not point to an alpha prerelease/i)

  assert.throws(() => evaluatePreviewUpstream({
    lock: previewLock,
    registry: previewRegistry({ rc: '0.1.2-beta.1' }),
    packageCommit: { sha: 'e'.repeat(40) },
  }), /rc tag does not point to a rc prerelease/i)
})

test('the official candidate monitor never downgrades the reviewed lock', () => {
  const result = evaluatePreviewUpstream({
    lock: previewLock,
    registry: previewRegistry({ alpha: '0.1.2-alpha.1' }),
    packageCommit: { sha: 'c'.repeat(40) },
  })

  assert.equal(result.changed, false)
  assert.equal(result.version, '0.1.2-alpha.2')
  assert.equal(result.commit, 'd'.repeat(40))
})

test('same-version official candidate integrity drift fails closed', () => {
  assert.throws(() => evaluatePreviewUpstream({
    lock: previewLock,
    registry: previewRegistry({ integrity: 'sha512-preview-replaced' }),
    packageCommit: { sha: 'd'.repeat(40) },
  }), /integrity changed for the pinned official candidate/i)
})

test('non-candidate prerelease tags are ignored instead of widening the channel', () => {
  const result = evaluatePreviewUpstream({
    lock: previewLock,
    registry: {
      'dist-tags': {
        alpha: '0.1.2-alpha.2',
        next: '0.1.3-dev.9',
        latest: '0.1.1-rc.2',
      },
      versions: {
        '0.1.2-alpha.2': { dist: { integrity: 'sha512-preview-current' } },
        '0.1.3-dev.9': { dist: { integrity: 'sha512-dev' } },
        '0.1.1-rc.2': { dist: { integrity: 'sha512-old-rc' } },
      },
    },
    packageCommit: { sha: 'e'.repeat(40) },
  })

  assert.equal(result.changed, false)
  assert.equal(result.version, '0.1.2-alpha.2')
})
