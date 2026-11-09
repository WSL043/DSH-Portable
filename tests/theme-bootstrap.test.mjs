import { readLauncherSource } from './helpers/launcher-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { patchThemeBootstrap } from '../scripts/patch-theme-bootstrap.mjs'

const client = 'const DEFAULT_PREFERENCE = "system"; class Theme { constructor(host) { this.host = host;\n\t\t\t\tthis.preference = DEFAULT_PREFERENCE; } reset() { this.preference = DEFAULT_PREFERENCE; } } new Theme().preference;'

test('the client inherits the official boot preference before asynchronous settings arrive', () => {
  for (const selected of ['dark', 'light', 'system']) {
    const document = { documentElement: { dataset: { dsThemeSource: selected } } }
    assert.equal(vm.runInNewContext(patchThemeBootstrap(client), { document }), selected)
  }
  assert.equal(vm.runInNewContext(patchThemeBootstrap(client)), 'system')
  const document = { documentElement: { dataset: { dsThemeSource: 'invalid' } } }
  assert.equal(vm.runInNewContext(patchThemeBootstrap(client), { document }), 'system')
})

test('theme bootstrap patch is idempotent and rejects a changed client seam', () => {
  const patched = patchThemeBootstrap(client)
  assert.equal(patchThemeBootstrap(patched), patched)
  assert.throws(() => patchThemeBootstrap(''), /seam changed/)
})

test('every product builder preserves the boot preference and native preference changes update chrome', async () => {
  for (const file of ['build-windows.ps1', 'build-macos.sh', 'build-linux.sh']) {
    assert.match(await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'), /patch-theme-bootstrap\.mjs/)
  }
  assert.match(await readLauncherSource(), /if \(chromeChanged \|\| preferenceChanged\) ApplyDesktopChrome\(\)/)
})
