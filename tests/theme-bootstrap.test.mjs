import { readLauncherSource } from './helpers/launcher-source.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

test('the CLI accepts a staged app argument from an external core build and leaves the host file intact', async () => {
  const app = await mkdtemp(path.join(tmpdir(), 'dsh-theme-staged-app-'))
  const lib = path.join(app, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib')
  const host = 'document.documentElement.dataset.dsThemeSource = preference'
  try {
    await mkdir(lib, { recursive: true })
    await writeFile(path.join(lib, 'index.js'), host)
    await writeFile(path.join(lib, 'client.js'), client)
    const script = fileURLToPath(new URL('../scripts/patch-theme-bootstrap.mjs', import.meta.url))
    execFileSync(process.execPath, [script, app], { windowsHide: true })
    assert.equal(await readFile(path.join(lib, 'index.js'), 'utf8'), host)
    assert.equal(await readFile(path.join(lib, 'client.js'), 'utf8'), patchThemeBootstrap(client))
  } finally {
    await rm(app, { recursive: true, force: true })
  }
})

test('every product builder preserves the boot preference and native preference changes update chrome', async () => {
  for (const file of ['build-windows.ps1', 'build-macos.sh', 'build-linux.sh']) {
    assert.match(await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'), /patch-theme-bootstrap\.mjs/)
  }
  assert.match(await readLauncherSource(), /if \(chromeChanged \|\| preferenceChanged\) ApplyDesktopChrome\(\)/)
})
