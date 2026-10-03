import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// The standalone market build runs `pnpm install --frozen-lockfile`. A
// package.json specifier change without a regenerated lockfile would only fail
// that build later, so compare the two here where every push sees it.
const root = new URL('../app/vendor/dsh-portable-plugin-market/', import.meta.url)

function lockfileRootSpecifiers(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line === '  .:')
  assert.ok(start >= 0, 'lockfile has a root importer')
  const specifiers = new Map()
  let name = null
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break
    const entry = /^ {6}(?:'([^']+)'|([^\s:'][^:]*)):$/.exec(line)
    if (entry) { name = entry[1] ?? entry[2]; continue }
    const specifier = /^ {8}specifier: (.*)$/.exec(line)
    if (specifier && name) specifiers.set(name, specifier[1].replace(/^'(.*)'$/, '$1'))
  }
  return specifiers
}

test('the vendored market lockfile matches its package.json specifiers', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const locked = lockfileRootSpecifiers(await readFile(new URL('pnpm-lock.yaml', root), 'utf8'))
  const declared = { ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.devDependencies }
  assert.ok(locked.size > 0, 'lockfile lists root specifiers')
  for (const [name, specifier] of Object.entries(declared)) {
    assert.equal(locked.get(name), specifier, `${name}: run pnpm install --lockfile-only in app/vendor/dsh-portable-plugin-market`)
  }
})
