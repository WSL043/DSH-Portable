import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { patchThemeBootstrap } from '../scripts/patch-theme-bootstrap.mjs'

const host = "const preference = selected;\n  const systemDark = preference === 'system' && systemDarkMode;\nconst dark = preference === 'dark' || systemDark;"
const client = 'const DEFAULT_PREFERENCE = "system"; class Theme { constructor(host) { this.host = host;\n\t\t\t\tthis.preference = DEFAULT_PREFERENCE; } reset() { this.preference = DEFAULT_PREFERENCE; } } new Theme().preference;'

test('the client inherits the durable boot preference before asynchronous settings arrive', () => {
  for (const selected of ['dark', 'light', 'system']) {
    const attributes = new Map()
    const document = { body: { setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key) } }
    vm.runInNewContext(patchThemeBootstrap(host, 'host'), { document, selected, systemDarkMode: false })
    assert.equal(vm.runInNewContext(patchThemeBootstrap(client, 'client'), { document }), selected)
  }
  assert.equal(vm.runInNewContext(patchThemeBootstrap(client, 'client')), 'system')
  assert.equal(vm.runInNewContext(patchThemeBootstrap(client, 'client'), { document: { body: { getAttribute: () => 'invalid' } } }), 'system')
})

test('theme bootstrap patch is idempotent and rejects changed upstream seams', () => {
  for (const [source, kind] of [[host, 'host'], [client, 'client']]) {
    const patched = patchThemeBootstrap(source, kind)
    assert.equal(patchThemeBootstrap(patched, kind), patched)
    assert.throws(() => patchThemeBootstrap('', kind), /seam changed/)
  }
})

test('every product builder preserves the boot preference and native preference changes update chrome', async () => {
  for (const file of ['build-windows.ps1', 'build-macos.sh', 'build-linux.sh']) {
    assert.match(await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'), /patch-theme-bootstrap\.mjs/)
  }
  assert.match(await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8'), /if \(chromeChanged \|\| preferenceChanged\) ApplyDesktopChrome\(\)/)
})
