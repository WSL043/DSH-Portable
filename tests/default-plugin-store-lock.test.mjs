import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../app/vendor/dsh-portable-plugin-market/package.json', import.meta.url))
const { load } = require('js-yaml')

for (const [channel, pinFile, lockFile] of [
  ['stable', 'upstream.lock.json', 'pnpm-lock.yaml'],
  ['preview', 'upstream.preview.lock.json', 'pnpm-lock.preview.yaml'],
]) {
  test(`${channel} offline plugin lock matches every reviewed release archive`, async () => {
    const pins = JSON.parse(await readFile(new URL(`../${pinFile}`, import.meta.url), 'utf8')).defaultPlugins
    const lock = load(await readFile(new URL(`../scripts/default-plugin-store/${lockFile}`, import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(lock.importers['.'].dependencies).sort(), Object.values(pins).map(pin => pin.package).sort())
    for (const pin of Object.values(pins)) {
      const archive = `file:.dsh-portable-archives/${pin.filename}`
      const entry = lock.packages[`${pin.package}@${archive}`]
      assert.ok(entry, `${pin.package}: missing locked archive`)
      assert.equal(entry.version, pin.spec, `${pin.package}: stale offline version`)
      assert.equal(entry.resolution.integrity, pin.integrity, `${pin.package}: stale offline integrity`)
      assert.equal(entry.resolution.tarball, archive)
      assert.equal(lock.importers['.'].dependencies[pin.package].specifier, archive)
    }
  })
}
