import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { createPackageLocator } from '../launcher/portable-core.mjs'

// The reference answer: probe every search root for <root>/<name>/package.json, exactly what the walk did before it shared
// directory listings.
function probe(anchor, packageName) {
  for (const searchRoot of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = path.join(searchRoot, packageName)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  return null
}

async function manifest(directory) {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), '{}')
}

test('the shared-listing package locator answers exactly like probing every search root', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-locator-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const modules = path.join(root, 'app', 'node_modules')
  await manifest(path.join(modules, 'plain'))
  await manifest(path.join(modules, '@scope', 'scoped'))
  await manifest(path.join(modules, 'host', 'node_modules', 'nested')) // a nested copy only the host can see
  await manifest(path.join(modules, 'host'))
  await manifest(path.join(modules, 'other'))
  await mkdir(path.join(modules, 'no-manifest'), { recursive: true }) // a directory without package.json is not a package
  await mkdir(path.join(modules, '@scope', 'empty'), { recursive: true })
  const anchors = [
    path.join(root, 'app', 'package.json'),
    path.join(modules, 'host', 'package.json'),
    path.join(modules, 'other', 'package.json'),
    path.join(modules, '@scope', 'scoped', 'package.json'),
  ]
  const names = ['plain', '@scope/scoped', '@scope/empty', '@scope/absent', 'nested', 'host', 'other', 'no-manifest', 'absent', '@absent/pkg']
  for (const platform of ['linux', 'win32']) {
    const locate = createPackageLocator(platform)
    for (const anchor of anchors) {
      for (const name of names) assert.equal(locate(anchor, name), probe(anchor, name), `${platform} ${name} from ${anchor}`)
    }
  }
  // The nested copy resolves for its host and nowhere else.
  const locate = createPackageLocator('linux')
  assert.equal(locate(anchors[1], 'nested'), path.join(modules, 'host', 'node_modules', 'nested'))
  assert.equal(locate(anchors[0], 'nested'), null)
})

test('on Windows the locator keeps the filesystem case-insensitive answer', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-locator-case-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const modules = path.join(root, 'node_modules')
  await manifest(path.join(modules, 'MixedCase'))
  const anchor = path.join(root, 'package.json')
  assert.equal(createPackageLocator('win32')(anchor, 'mixedcase')?.toLowerCase(), probe(anchor, 'mixedcase')?.toLowerCase())
  assert.notEqual(createPackageLocator('win32')(anchor, 'mixedcase'), null)
})
