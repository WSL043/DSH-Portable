import assert from 'node:assert/strict'
import test from 'node:test'

import { indexGitTarget, indexSourceOf, latestCatalogTarball } from '../app/vendor/dsh-portable-plugin-market/src/index-sources.ts'
import { externalUpdateSource } from '../app/vendor/dsh-portable-plugin-market/src/sources.ts'

const SHA = 'c'.repeat(40)

test('the specs the official market writes for index entries are recognised exactly', () => {
  assert.deepEqual(indexSourceOf(`git+https://github.com/o/r.git#${SHA}`), { kind: 'git', repo: 'o/r', commit: SHA, path: null })
  assert.deepEqual(indexSourceOf(`git+https://github.com/o/mono#${SHA}&path:/packages/p`), { kind: 'git', repo: 'o/mono', commit: SHA, path: 'packages/p' })
  assert.deepEqual(indexSourceOf('https://github.com/o/r/releases/download/v1.2.0/o-r-1.2.0.tgz'), { kind: 'tarball', url: 'https://github.com/o/r/releases/download/v1.2.0/o-r-1.2.0.tgz', repo: 'o/r' })
  for (const other of [
    'github:o/r', '^1.2.3', 'dsh-plugin', `git+https://gitlab.com/o/r.git#${SHA}`, 'git+https://github.com/o/r.git#main',
    `git+https://github.com/o/r.git#${SHA}&path:/../x`, 'https://example.com/r/releases/download/v1/x.tgz', 'http://github.com/o/r/releases/download/v1/x.tgz',
  ]) assert.equal(indexSourceOf(other), null, other)
})

test('these sources can be updated, while unknown external sources still cannot', () => {
  assert.equal(externalUpdateSource(`git+https://github.com/o/r.git#${SHA}`), false)
  assert.equal(externalUpdateSource('https://github.com/o/r/releases/download/v1.2.0/o-r-1.2.0.tgz'), false)
  assert.equal(externalUpdateSource(`git+https://gitlab.com/o/r.git#${SHA}`), true)
  assert.equal(externalUpdateSource('https://example.com/plugin.tgz'), true)
})

test('the next commit keeps the repository and sub-directory', () => {
  const source = indexSourceOf(`git+https://github.com/o/mono.git#${SHA}&path:/packages/p`)
  assert.equal(indexGitTarget(source, 'd'.repeat(40)), `git+https://github.com/o/mono.git#${'d'.repeat(40)}&path:/packages/p`)
  assert.equal(indexGitTarget(indexSourceOf(`git+https://github.com/o/r.git#${SHA}`), 'e'.repeat(40)), `git+https://github.com/o/r.git#${'e'.repeat(40)}`)
})

test('the newest tarball is the catalog one from the same repository and file family', () => {
  const installed = indexSourceOf('https://github.com/o/r/releases/download/v1.0.0/o-r-plugin-1.0.0.tgz')
  const entries = [
    { tarball: 'https://github.com/o/r/releases/download/v1.1.0/o-r-plugin-1.1.0.tgz' },
    { tarball: 'https://github.com/o/r/releases/download/v9.0.0/o-r-other-9.0.0.tgz' },
    { tarball: 'https://github.com/x/y/releases/download/v5.0.0/o-r-plugin-5.0.0.tgz' },
    { tarball: null },
  ]
  assert.equal(latestCatalogTarball(installed, entries), 'https://github.com/o/r/releases/download/v1.1.0/o-r-plugin-1.1.0.tgz')
  assert.equal(latestCatalogTarball(installed, [{ tarball: 'https://github.com/x/y/releases/download/v1/z-1.tgz' }]), null, 'a different repository is never a candidate')
  const ambiguous = [
    { tarball: 'https://github.com/o/r/releases/download/v1.1.0/o-r-one-1.1.0.tgz' },
    { tarball: 'https://github.com/o/r/releases/download/v1.1.0/o-r-two-1.1.0.tgz' },
  ]
  assert.equal(latestCatalogTarball(installed, ambiguous), null, 'two unrelated archives of one repository are not guessed between')
})
