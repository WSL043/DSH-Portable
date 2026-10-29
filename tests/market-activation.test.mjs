import test from 'node:test'
import assert from 'node:assert/strict'
import { awaitHotActivation, resolveProfileEntry } from '../app/vendor/dsh-portable-plugin-market/src/hot.ts'
import { verifyActivation } from '../app/vendor/dsh-portable-plugin-market/src/verify.ts'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

test('hot entry resolution follows each installed profile and preserves unresolvable specifiers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'market-profile-entry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['first', 'second']) {
    const profile = join(root, name)
    const packageDir = join(profile, 'node_modules', 'sample-plugin')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'sample-plugin', main: 'host.cjs' }))
    await writeFile(join(packageDir, 'host.cjs'), 'module.exports = {}')
    assert.equal(await realpath(fileURLToPath(resolveProfileEntry(profile, 'sample-plugin'))), await realpath(join(packageDir, 'host.cjs')))
    for (const specifier of ['missing-plugin', './relative.js', 'cordis:builtin', 'file:///fixture.js']) {
      assert.equal(resolveProfileEntry(profile, specifier), specifier)
    }
  }
})

test('failed activation disposes partial host effects and preserves the original failure', async () => {
  const failure = new Error('activation failed after registering a route')
  let live = true
  await assert.rejects(awaitHotActivation({
    async await() { throw failure },
    dispose() { live = false; throw new Error('disposal failed') },
  }), error => error === failure)
  assert.equal(live, false)
})

test('rejected activation does not wait forever for teardown; successful mounts stay active', async () => {
  let disposals = 0
  await assert.rejects(awaitHotActivation({ async await() { throw new Error('failed') },
    dispose() { disposals++; return new Promise(() => {}) },
  }), /failed/)
  await awaitHotActivation({ async await() {}, dispose() { disposals++ } })
  assert.equal(disposals, 1)
})

test('a disabled plugin still running in the loader is reported as pending disable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'market-pending-disable-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageDir = join(root, 'node_modules', 'sample-plugin')
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }))
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'sample-plugin', version: '1.0.0', dsh: {} }))
  const pending = verifyActivation('web', 'sample-plugin', new Set(['sample-plugin']), root, true)
  assert.equal(pending.state, 'pending-disable')
  assert.equal(pending.hot, true)
  const stopped = verifyActivation('web', 'sample-plugin', new Set(), root, true)
  assert.equal(stopped.state, 'disabled')
  assert.equal(stopped.hot, false)
})

test('official browser capability packages without bundle metadata are dependencies until observed live', async t => {
  const root = await mkdtemp(join(tmpdir(), 'market-official-components-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = JSON.stringify({ dsh: { profile: { bundles: [] } } })
  await writeFile(join(root, 'package.json'), profile)
  // Manifest shapes verified against the two original rc.2 npm archives.
  for (const name of ['@deepseek-ai/dsh-browser-use', '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp']) {
    const packageDir = join(root, 'node_modules', name)
    await mkdir(join(packageDir, 'lib'), { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name, version: '0.2.1-rc.2', main: 'lib/index.js',
      exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } } }))
    await writeFile(join(packageDir, 'lib/index.js'), 'throw new Error("capability fixture must not execute")')
    const waiting = verifyActivation('web', name, new Set(), root)
    assert.equal(waiting.state, 'inert')
    assert.equal(waiting.bundle, false)
    assert.equal(waiting.hot, false)
    assert.ok(waiting.reasons.join(' ').includes('依赖/能力组件，无独立插件入口'))
    assert.match(waiting.reasons.join(' '), /由需要它的插件或会话加载/)
    assert.doesNotMatch(waiting.reasons.join(' '), /重启|restart/i)
    assert.equal(verifyActivation('web', name, new Set([name]), root).state, 'live', 'observed loading still outranks missing bundle metadata')
  }
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), profile, 'classification never mounts a component')
})

test('the official Codex bundle outside the selected profile is not mislabeled as a plain dependency', async t => {
  const root = await mkdtemp(join(tmpdir(), 'market-unselected-official-bundle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const name = '@deepseek-ai/dsh-subagent-codex'
  const packageDir = join(root, 'node_modules', name)
  await mkdir(join(packageDir, 'lib'), { recursive: true })
  const profile = JSON.stringify({ dsh: { profile: { bundles: [] } } })
  await writeFile(join(root, 'package.json'), profile)
  // The published alpha.2 npm archive declares this bundle and ships both files.
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name, version: '0.2.2-alpha.2', main: 'lib/index.js',
    exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' }, './cordis.patch.yml': './cordis.patch.yml' },
    dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(packageDir, 'lib/index.js'), 'throw new Error("bundle fixture must not execute")')
  await writeFile(join(packageDir, 'cordis.patch.yml'), '- insert:\n    - id: subagent-codex\n      name: "@deepseek-ai/dsh-subagent-codex"\n    - id: tool-subagent-codex\n      name: "@deepseek-ai/dsh-tool-subagent"\n      config:\n        provider: codex\n        toolName: subagent_codex\n        maxDepth: provider-managed\n')
  const waiting = verifyActivation('web', name, new Set(), root)
  assert.equal(waiting.state, 'inert')
  assert.equal(waiting.bundle, false)
  assert.equal(waiting.hot, false)
  assert.match(waiting.reasons.join(' '), /已声明插件 bundle，但未在当前 Profile 启用、未加入加载层/)
  assert.doesNotMatch(waiting.reasons.join(' '), /未声明|plain dependency/)
  assert.equal(verifyActivation('web', name, new Set(['#subagent-codex']), root).state, 'live', 'a live row inserted by its own bundle remains authoritative')
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), profile, 'classification never enables the bundle')
})
