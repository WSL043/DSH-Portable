import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pruneScript = path.join(root, 'scripts', 'prune-runtime.mjs')
const exists = (filename) => access(filename).then(() => true, () => false)

async function fixtureFile(appDir, relative, contents = relative) {
  const filename = path.join(appDir, 'node_modules', ...relative.split('/'))
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, contents)
  return filename
}

test('runtime pruning removes packaging-only payload while preserving runtime and legal files', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-prune-contract-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const appDir = path.join(temporary, 'app')

  await fixtureFile(appDir, 'node-pty/package.json', '{"name":"node-pty"}')
  await fixtureFile(appDir, 'node-pty/lib/index.js', 'export const runtime = true')
  await fixtureFile(appDir, 'node-pty/LICENSE', 'must remain')
  await fixtureFile(appDir, 'node-pty/README.md')
  await fixtureFile(appDir, 'node-pty/lib/index.js.map')
  await fixtureFile(appDir, 'node-pty/lib/index.d.ts')
  await fixtureFile(appDir, 'node-pty/tests/runtime.test.js')
  await fixtureFile(appDir, 'node-pty/build/Release/conpty/OpenConsole.exe')
  await fixtureFile(appDir, 'node-pty/prebuilds/win32-x64/conpty.node')
  await fixtureFile(appDir, 'node-pty/prebuilds/win32-x64/conpty_console_list.node')
  await fixtureFile(appDir, 'node-pty/prebuilds/win32-x64/conpty.pdb')
  await fixtureFile(appDir, 'node-pty/prebuilds/win32-x64/conpty/conpty.dll')
  await fixtureFile(appDir, 'node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe')
  await fixtureFile(appDir, 'node-pty/prebuilds/darwin-arm64/pty.node')
  await fixtureFile(appDir, '@types/example/package.json', '{"name":"@types/example"}')
  await fixtureFile(appDir, '@types/example/index.d.ts')
  await fixtureFile(appDir, '@types/example/LICENSE', 'types license')
  await fixtureFile(appDir, 'example-package/package.json', '{"name":"example-package"}')
  await fixtureFile(appDir, 'example-package/dist/index.js', 'export default true')
  await fixtureFile(appDir, 'example-package/.github/runtime.js', 'export default true')
  await fixtureFile(appDir, 'example-package/dist/index.js.map')
  await fixtureFile(appDir, 'example-package/dist/index.d.mts')
  await fixtureFile(appDir, 'example-package/docs/runtime.js', 'export default true')
  await fixtureFile(appDir, 'example-package/test/runtime.js', 'export default true')
  await fixtureFile(appDir, 'example-package/tests/runtime.js', 'export default true')
  await fixtureFile(appDir, 'example-package/example/runtime.js', 'export default true')
  await fixtureFile(appDir, '@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json', '{"runtime":true}')
  await fixtureFile(appDir, 'example-package/examples/example.js')
  await fixtureFile(appDir, 'example-package/benchmark/runtime.js', 'export default true')
  await fixtureFile(appDir, 'yaml/dist/doc/directives.js', 'module.exports = true')
  await fixtureFile(appDir, 'example-package/CHANGELOG.md')
  await fixtureFile(appDir, 'example-package/NOTICE.md', 'must remain too')
  await fixtureFile(appDir, '@mistralai/mistralai/package.json', '{"name":"@mistralai/mistralai","main":"./esm/index.js"}')
  await fixtureFile(appDir, '@mistralai/mistralai/esm/index.js', 'export default true')
  await fixtureFile(appDir, '@mistralai/mistralai/src/generated/models/temporaryattributevalue.ts', 'export type SourceOnly = true')
  await fixtureFile(appDir, '@mistralai/mistralai/packages/azure/src/index.ts', 'source only')
  await fixtureFile(appDir, '@mistralai/mistralai/examples/chat.ts', 'example only')
  await fixtureFile(appDir, '@mistralai/mistralai/tests/client.test.ts', 'test only')
  await fixtureFile(appDir, '@mistralai/mistralai/FUNCTIONS.md', 'generated reference only')
  await fixtureFile(appDir, '@mistralai/mistralai/RUNTIMES.md', 'generated reference only')
  await fixtureFile(appDir, '@mistralai/mistralai/jsr.json', '{"exports":"./src/index.ts"}')
  await fixtureFile(appDir, '@mixmark-io/domino/package.json', '{"name":"@mixmark-io/domino","main":"./lib"}')
  await fixtureFile(appDir, '@mixmark-io/domino/lib/index.js', 'module.exports = true')
  await fixtureFile(appDir, '@mixmark-io/domino/test/index.js', 'test only')
  await fixtureFile(appDir, '@mixmark-io/domino/.yarn/plugins/plugin-version.cjs', 'packaging only')
  await fixtureFile(appDir, 'openai/package.json', '{"name":"openai","main":"index.js"}')
  await fixtureFile(appDir, 'openai/index.js', 'export default true')
  await fixtureFile(appDir, 'openai/src/internal.ts', 'export type SourceOnly = true')
  await fixtureFile(appDir, 'runtime-ts/package.json', '{"name":"runtime-ts","main":"src/index.ts"}')
  await fixtureFile(appDir, 'runtime-ts/src/index.ts', 'export default true')
  await fixtureFile(appDir, '@wsl043/dsh-portable-plugin-market/package.json', '{"name":"@wsl043/dsh-portable-plugin-market","main":"lib/index.js"}')
  await fixtureFile(appDir, '@wsl043/dsh-portable-plugin-market/lib/index.js', 'export default true')
  await mkdir(path.join(appDir, 'vendor', 'dsh-portable-plugin-market', 'src'), { recursive: true })
  await writeFile(path.join(appDir, 'vendor', 'dsh-portable-plugin-market', 'src', 'maintenance.ts'), 'source only')

  const result = spawnSync(process.execPath, [pruneScript, appDir, 'win32', 'x64'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

  for (const relative of [
    'node-pty/package.json',
    'node-pty/lib/index.js',
    'node-pty/LICENSE',
    'node-pty/prebuilds/win32-x64/conpty.node',
    'node-pty/prebuilds/win32-x64/conpty_console_list.node',
    'node-pty/prebuilds/win32-x64/conpty/conpty.dll',
    'node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
    'example-package/package.json',
    'example-package/dist/index.js',
    'example-package/.github/runtime.js',
    'example-package/docs/runtime.js',
    'example-package/test/runtime.js',
    'example-package/tests/runtime.js',
    'example-package/example/runtime.js',
    'example-package/examples/example.js',
    'example-package/benchmark/runtime.js',
    'yaml/dist/doc/directives.js',
    '@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json',
    'example-package/NOTICE.md',
    '@mistralai/mistralai/esm/index.js',
    '@mixmark-io/domino/lib/index.js',
    'openai/index.js',
    'runtime-ts/src/index.ts',
    '@wsl043/dsh-portable-plugin-market/lib/index.js',
  ]) {
    assert.equal(await exists(path.join(appDir, 'node_modules', ...relative.split('/'))), true, relative)
  }

  for (const relative of [
    'node-pty/README.md',
    'node-pty/lib/index.js.map',
    'node-pty/lib/index.d.ts',
    'node-pty/tests/runtime.test.js',
    'node-pty/build',
    'node-pty/prebuilds/win32-x64/conpty.pdb',
    'node-pty/prebuilds/darwin-arm64',
    '@types/example',
    'example-package/dist/index.js.map',
    'example-package/dist/index.d.mts',
    'example-package/CHANGELOG.md',
    '@mistralai/mistralai/src',
    '@mistralai/mistralai/packages',
    '@mistralai/mistralai/examples',
    '@mistralai/mistralai/tests',
    '@mistralai/mistralai/FUNCTIONS.md',
    '@mistralai/mistralai/RUNTIMES.md',
    '@mistralai/mistralai/jsr.json',
    '@mixmark-io/domino/test',
    '@mixmark-io/domino/.yarn',
    'openai/src',
    '../vendor',
  ]) {
    assert.equal(await exists(path.join(appDir, 'node_modules', ...relative.split('/'))), false, relative)
  }

  const report = JSON.parse(result.stdout.trim())
  assert.equal(report.target, 'win32-x64')
  assert.ok(report.saved > 0)
  assert.ok(report.removedFiles >= 10)
  assert.ok(report.removedDirectories >= 5)
  assert.equal(await readFile(path.join(appDir, 'node_modules', 'example-package', 'NOTICE.md'), 'utf8'), 'must remain too')
})

test('Linux pruning keeps only the native node-pty runtime products', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-prune-linux-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const appDir = path.join(temporary, 'app')

  await fixtureFile(appDir, 'node-pty/package.json', '{"name":"node-pty"}')
  await fixtureFile(appDir, 'node-pty/lib/index.js', 'module.exports = true')
  await fixtureFile(appDir, 'node-pty/prebuilds/linux-x64/pty.node', 'native')
  await fixtureFile(appDir, 'node-pty/build/Release/obj.target/pty/src/unix/pty.o', 'object')
  await fixtureFile(appDir, 'node-pty/build/Makefile', 'generated')
  await fixtureFile(appDir, 'node-pty/prebuilds/win32-x64/pty.node', 'windows')
  await fixtureFile(appDir, 'node-pty/prebuilds/darwin-arm64/pty.node', 'mac')
  await fixtureFile(appDir, '@koromix/koffi-linux-x64/package.json', '{"name":"@koromix/koffi-linux-x64"}')
  await fixtureFile(appDir, '@koromix/koffi-linux-x64/linux_x64/koffi.node', 'glibc')
  await fixtureFile(appDir, '@koromix/koffi-linux-x64/musl_x64/koffi.node', 'musl')

  const result = spawnSync(process.execPath, [pruneScript, appDir, 'linux', 'x64'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/prebuilds/linux-x64/pty.node')), true)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/build')), false)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/prebuilds/win32-x64')), false)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/prebuilds/darwin-arm64')), false)
  assert.equal(await exists(path.join(appDir, 'node_modules/@koromix/koffi-linux-x64/linux_x64/koffi.node')), true)
  assert.equal(await exists(path.join(appDir, 'node_modules/@koromix/koffi-linux-x64/musl_x64')), false)
  assert.equal(JSON.parse(result.stdout.trim()).target, 'linux-x64')
})

test('macOS pruning preserves the pty module and spawn helper for the selected architecture', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-prune-macos-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const appDir = path.join(temporary, 'app')

  await fixtureFile(appDir, 'node-pty/package.json', '{"name":"node-pty"}')
  await fixtureFile(appDir, 'node-pty/lib/index.js', 'module.exports = true')
  await fixtureFile(appDir, 'node-pty/prebuilds/darwin-arm64/pty.node', 'native')
  await fixtureFile(appDir, 'node-pty/prebuilds/darwin-arm64/spawn-helper', 'helper')
  await fixtureFile(appDir, 'node-pty/prebuilds/darwin-x64/pty.node', 'other')
  await fixtureFile(appDir, 'node-pty/build/Release/pty.node', 'build output')

  const result = spawnSync(process.execPath, [pruneScript, appDir, 'darwin', 'arm64'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node')), true)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper')), true)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/prebuilds/darwin-x64')), false)
  assert.equal(await exists(path.join(appDir, 'node_modules/node-pty/build')), false)
  assert.equal(JSON.parse(result.stdout.trim()).target, 'darwin-arm64')
})
