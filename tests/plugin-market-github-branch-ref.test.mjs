import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sources = await import('../app/vendor/dsh-portable-plugin-market/src/sources.ts')
const updatesModule = await import('../app/vendor/dsh-portable-plugin-market/src/updates.ts')
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const commit = 'c'.repeat(40)

test('GitHub updates keep a selected branch or tag and monorepo subpath', () => {
  assert.equal(
    sources.githubUpdateTarget('github:m/mono#publish&path:/packages/plug'),
    'github:m/mono#publish&path:/packages/plug',
  )
  assert.equal(
    sources.githubUpdateTarget('github:m/mono#v2.1.0&path:/packages/plug'),
    'github:m/mono#v2.1.0&path:/packages/plug',
  )
  assert.equal(
    sources.githubUpdateTarget(`github:m/mono#${commit}&path:/packages/plug`),
    'github:m/mono#path:/packages/plug',
  )
})

test('GitHub update checks follow a selected branch but not an immutable pin', () => {
  assert.equal(sources.githubRefOfTarget('github:m/mono#publish&path:/packages/plug'), 'publish')
  assert.equal(sources.githubRefOfTarget(`github:m/mono#${commit}&path:/packages/plug`), null)
  assert.equal(sources.githubRefOfTarget('github:m/mono#semver:^2.0.0'), null)
  assert.equal(sources.githubRefOfTarget('left-pad@latest'), null)
})

test('git advertisement lookup resolves the exact selected ref', () => {
  const branchCommit = 'a'.repeat(40)
  const otherCommit = 'b'.repeat(40)
  const payload = [
    `${otherCommit} HEAD`,
    `${branchCommit} refs/heads/release.1`,
    `${otherCommit} refs/heads/releaseX1`,
    `${otherCommit} refs/tags/v2.0.0`,
  ].join('\n')
  assert.equal(updatesModule.parseGitRefAdvertisement(payload, 'release.1'), branchCommit)
  assert.equal(updatesModule.parseGitRefAdvertisement(payload, 'v2.0.0'), otherCommit)
  assert.equal(updatesModule.parseGitRefAdvertisement(payload, 'release'), null)
  assert.equal(updatesModule.parseGitRefAdvertisement(payload), otherCommit)
})

test('exact GitHub rollback replaces the branch with the captured commit and keeps subpath', () => {
  assert.equal(
    sources.githubPinnedTarget('github:m/mono#publish&path:/packages/plug', commit),
    `github:m/mono#${commit}&path:/packages/plug`,
  )
})

test('the branch helpers are wired into update detection, update action, and exact rollback', async () => {
  const updates = await read('app/vendor/dsh-portable-plugin-market/src/updates.ts')
  const routes = await read('app/vendor/dsh-portable-plugin-market/src/routes.ts')
  assert.match(updates, /githubRefOfTarget\(spec\)/)
  assert.match(routes, /githubUpdateTarget\(spec\)/)
  assert.match(routes, /githubPinnedTarget\(target, beforeCommit\)/)
  assert.doesNotMatch(routes, /const target = isGit \? spec\.replace\(\/#\.\*\$\/, ''\)/)
})
