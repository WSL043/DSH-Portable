import test from 'node:test'
import assert from 'node:assert/strict'
import { awaitHotActivation, resolveProfileEntry } from '../app/vendor/dsh-portable-plugin-market/src/hot.ts'
import { verifyActivation } from '../app/vendor/dsh-portable-plugin-market/src/verify.ts'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
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
