import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { evaluateUpstream } from '../scripts/upstream-state.mjs'

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

test('same-version integrity drift fails closed instead of silently replacing the lock', () => {
  assert.throws(() => evaluateUpstream({
    lock,
    registry: registry({ integrity: 'sha512-replaced' }),
    commit: { sha: 'b'.repeat(40) },
  }), /integrity changed for the pinned DSH version/i)
})
