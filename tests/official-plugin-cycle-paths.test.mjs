import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = path.resolve(import.meta.dirname, '../scripts/smoke-windows-official-plugin-cycle.mjs')
const defaults = [
  { package: 'dsh-image-viewer', version: '0.1.17' },
  { package: 'dsh-chat-manager', version: '1.5.19' },
]

async function packageAt(root, patch = {}) {
  for (const relative of ['licenses', 'data', 'workspace', 'runtime/node', 'launcher']) await mkdir(path.join(root, relative), { recursive: true })
  for (const relative of ['data/README.txt', 'workspace/README.txt', 'runtime/node/node.exe', 'DeepSeek-Herness.exe', 'launcher/runtime-entry.mjs']) {
    await writeFile(path.join(root, relative), 'fixture only')
  }
  await writeFile(path.join(root, 'licenses/COMPONENTS.json'), JSON.stringify({
    product: 'DSH-Portable', platform: 'windows-x64', portableVersion: '0.9.8-alpha.1',
    dshVersion: '0.2.2-alpha.2', defaultPlugins: defaults, ...patch,
  }))
}

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-cycle-admission-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const temporary = path.join(parent, 'allowed-temp')
  const root = path.join(temporary, 'DSH-Portable')
  const driver = path.join(temporary, 'driver')
  await packageAt(root)
  await mkdir(path.join(driver, 'node_modules/playwright'), { recursive: true })
  await writeFile(path.join(driver, 'package.json'), '{}')
  await writeFile(path.join(driver, 'node_modules/playwright/package.json'), '{"main":"index.cjs"}')
  // Even if an admission guard regresses, this negative fixture cannot start a host.
  await writeFile(path.join(driver, 'node_modules/playwright/index.cjs'), 'throw new Error("Driver must not load before fixture admission")')
  return {
    parent, temporary, root,
    evidence: path.join(root, 'acceptance/official-plugin-cycle'),
    invoke: (expected, { productRoot = root, evidence = path.join(root, 'acceptance/official-plugin-cycle'), upgrade = [] } = {}) =>
      assert.rejects(run(process.execPath, [script, productRoot, path.join(driver, 'package.json'), evidence, '--disposable', ...upgrade], {
        windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
        env: { ...process.env, RUNNER_TEMP: temporary, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
      }), error => error.code === 1 && expected.test(error.stderr)),
  }
}

test('plugin-cycle admission rejects a canonical package outside both actual temporary roots', async t => {
  const f = await fixture(t)
  const outside = path.join(f.parent, 'outside-package')
  await packageAt(outside)
  await f.invoke(/below an actual temporary directory/, { productRoot: path.join(f.parent, 'nonexistent-outside-package') })
  await f.invoke(/below an actual temporary directory/, { productRoot: f.temporary })
  await f.invoke(/below an actual temporary directory/, { productRoot: outside, evidence: path.join(outside, 'acceptance/official-plugin-cycle') })
  assert.deepEqual((await readdir(outside)).sort(), ['DeepSeek-Herness.exe', 'data', 'launcher', 'licenses', 'runtime', 'workspace'].sort())
})

test('plugin-cycle admission rejects external or occupied evidence directories without overwriting files', async t => {
  const f = await fixture(t)
  const outside = path.join(f.parent, 'outside-evidence')
  await mkdir(outside)
  await writeFile(path.join(outside, 'keep.txt'), 'keep external')
  await f.invoke(/Evidence directory must be the disposable product/, { evidence: outside })
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep external')
  await mkdir(f.evidence, { recursive: true })
  await writeFile(path.join(f.evidence, 'result.json'), 'keep prior evidence')
  await f.invoke(/Evidence directory must be new or empty/)
  assert.equal(await readFile(path.join(f.evidence, 'result.json'), 'utf8'), 'keep prior evidence')
})

test('plugin-cycle admission refuses copied user state even when it is below TEMP', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, 'data/private-session.json'), 'keep original')
  await f.invoke(/fresh data and workspace/)
  assert.equal(await readFile(path.join(f.root, 'data/private-session.json'), 'utf8'), 'keep original')
})

test('plugin-cycle admission rejects native 1.x and extra, traversing or duplicate plugin metadata', async t => {
  const f = await fixture(t)
  for (const patch of [
    { portableVersion: '1.0.0-alpha.5' },
    { defaultPlugins: [...defaults, { package: '../../outside', version: '1.0.0' }] },
    { defaultPlugins: [defaults[0], defaults[0]] },
  ]) {
    await packageAt(f.root, patch)
    await f.invoke(/owned 0.x Portable host|exactly the two reviewed default plugins/)
  }
})

test('plugin-cycle admission refuses a seed package outside the disposable temporary roots before driver loading', async t => {
  const f = await fixture(t)
  const seed = path.join(f.parent, 'outside-seed')
  await packageAt(seed, { portableVersion: '0.7.7', dshVersion: '0.1.7-alpha.1' })
  await f.invoke(/below an actual temporary directory/, { upgrade: ['--upgrade-defaults', '--concurrent-writers', seed] })
  assert.deepEqual(await readdir(path.join(f.root, 'data')), ['README.txt'])
})

test('plugin-cycle admission rejects runtime and output junctions escaping the package', async t => {
  for (const target of ['runtime/node', 'acceptance']) {
    const f = await fixture(t)
    const outside = path.join(f.temporary, 'outside-' + target.replaceAll('/', '-'))
    await mkdir(outside)
    await writeFile(path.join(outside, 'node.exe'), 'not executable')
    await rm(path.join(f.root, target), { recursive: true, force: true })
    try { await symlink(outside, path.join(f.root, target), process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Directory link capability unavailable'); return }
      throw error
    }
    await f.invoke(/escapes its root|Unsafe restore path/)
    assert.deepEqual(await readdir(outside), ['node.exe'])
  }
})

test('plugin-cycle admission accepts var/private-style TEMP aliases and reaches the fake driver rejection', async t => {
  const f = await fixture(t)
  const privateDirectory = path.join(f.temporary, 'private-var')
  const lexicalAlias = path.join(f.temporary, 'var')
  await mkdir(privateDirectory)
  const canonicalPackage = path.join(privateDirectory, 'DSH-Portable')
  await rename(f.root, canonicalPackage)
  await symlink(privateDirectory, lexicalAlias, process.platform === 'win32' ? 'junction' : 'dir')
  const productRoot = path.join(lexicalAlias, 'DSH-Portable')
  await f.invoke(/Driver must not load before fixture admission/, {
    productRoot, evidence: path.join(productRoot, 'acceptance/official-plugin-cycle'),
  })
  assert.deepEqual(await readdir(path.join(canonicalPackage, 'acceptance/official-plugin-cycle')), [])
  assert.deepEqual(await readdir(path.join(canonicalPackage, 'data')), ['README.txt'])
})

test('plugin-cycle admission still rejects a lexical TEMP alias whose canonical package escapes TEMP', async t => {
  const f = await fixture(t)
  const outside = path.join(f.parent, 'outside-aliased-package')
  await packageAt(outside)
  const productRoot = path.join(f.temporary, 'escaping-package-alias')
  await symlink(outside, productRoot, process.platform === 'win32' ? 'junction' : 'dir')
  await f.invoke(/below an actual temporary directory/, {
    productRoot, evidence: path.join(productRoot, 'acceptance/official-plugin-cycle'),
  })
  assert.deepEqual(await readdir(path.join(outside, 'data')), ['README.txt'])
})
