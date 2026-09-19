import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(await readFile(new URL('../docs/security-review-2026-09-19-manifest.json', import.meta.url), 'utf8'))
const fixes = JSON.parse(await readFile(new URL('../docs/security-review-2026-09-19-fixes.json', import.meta.url), 'utf8'))
const expand = value => value.split(',').flatMap(part => {
  assert.match(part, /^\d+(?:-\d+)?$/)
  const [first, last = first] = part.split('-').map(Number)
  assert.ok(first > 0 && last >= first && last - first < 1000)
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
})

test('the archived review accounts for all 874 code alerts without duplicate decisions', () => {
  const all = manifest.cases.flatMap(group => expand(group.ids))
  assert.equal(all.length, 874)
  assert.equal(new Set(all).size, 874)
  assert.equal(manifest.cases.filter(group => group.disposition === 'false positive').flatMap(group => expand(group.ids)).length, 845)
  assert.equal(manifest.cases.filter(group => group.disposition === 'open').flatMap(group => expand(group.ids)).length, 29)
  assert.equal(manifest.sourceCommit, fixes.snapshotCommit)
  assert.equal(manifest.repository, fixes.repository)
})

test('every held code alert and the separate dependency alert has a repair and test mapping', async () => {
  const held = manifest.cases.filter(group => group.disposition === 'open').flatMap(group => expand(group.ids)).sort((a, b) => a - b)
  const mapped = fixes.groups.flatMap(group => group.ids).sort((a, b) => a - b)
  assert.deepEqual(mapped, held)
  assert.equal(new Set(mapped).size, 29)
  assert.equal(fixes.dependabot.length, 1)
  assert.equal(fixes.dependabot[0].advisory, 'GHSA-wrw7-89jp-8q8g')
  for (const group of [...fixes.groups, ...fixes.dependabot]) {
    assert.ok(group.files.length > 0 && group.tests.length > 0)
    for (const filename of [...group.files, ...group.tests]) {
      assert.ok(!filename.startsWith('/') && !filename.split('/').includes('..'))
      await access(new URL(`../${filename}`, import.meta.url))
    }
  }
})
