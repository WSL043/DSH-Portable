import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { DEFAULT_PLUGINS, PREVIEW_DEFAULT_PLUGINS, defaultsForProduct, seedDefaultPlugins } from '../launcher/default-plugins.mjs'

const lock = JSON.parse(await readFile(new URL('../upstream.lock.json', import.meta.url), 'utf8'))
const imageVersion = DEFAULT_PLUGINS.find(plugin => plugin.name === 'dsh-image-viewer').version
const chatVersion = DEFAULT_PLUGINS.find(plugin => plugin.name === 'dsh-chat-manager').version

test('product metadata must identify an exact reviewed artifact without duplicate names', () => {
  const plugin = DEFAULT_PLUGINS[0]
  const entry = { package: plugin.name, version: plugin.version, sha256: plugin.sha256, integrity: plugin.integrity }
  const select = entries => defaultsForProduct({ root: '/fixture' }, {
    existsSync: () => true, readFileSync: () => JSON.stringify({ defaultPlugins: entries }),
  })
  assert.deepEqual(select([entry]), [plugin])
  assert.throws(() => select([{ ...entry, version: '99.0.0' }]), /unrecognized/)
  assert.throws(() => select([{ ...entry, sha256: '0'.repeat(64) }]), /unrecognized/)
  assert.throws(() => select([entry, entry]), /duplicate/)
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return layoutForRoot(root, process.platform)
}

async function writeReviewedArchives(layout) {
  await mkdir(path.join(layout.root, 'default-plugins'), { recursive: true })
  for (const plugin of DEFAULT_PLUGINS) {
    await writeFile(path.join(layout.root, 'default-plugins', plugin.filename), plugin.name)
  }
}

test('fresh products declare only the reviewed image viewer and existing chat manager defaults', () => {
  assert.deepEqual(Object.keys(lock.defaultPlugins).sort(), ['chatManager', 'imageViewer'])
  assert.deepEqual(DEFAULT_PLUGINS.map(plugin => plugin.name), ['dsh-image-viewer', 'dsh-chat-manager'])
  assert.equal(lock.defaultPlugins.imageViewer.version, imageVersion)
  assert.equal(lock.defaultPlugins.chatManager.version, chatVersion)
})

test('a fresh product seeds both reviewed archives and promotes their update specs', async (t) => {
  const layout = await fixture(t)
  await writeReviewedArchives(layout)
  const store = path.join(layout.root, 'default-plugins', 'store')
  await mkdir(path.join(store, 'v11', 'projects'), { recursive: true })
  await writeFile(path.join(store, 'dependency'), 'bundled dependency')
  await writeFile(path.join(store, 'v11', 'projects', 'build-only'), 'not portable')
  let invocation

  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync(command, args, options) {
      invocation = { command, args, options }
      writeFileSync(path.join(options.cwd, 'package.json'), '{"dependencies":{}}\n')
      return { status: 0 }
    },
  })

  assert.deepEqual(result, { status: 'seeded', profile: 'web', plugins: ['dsh-image-viewer', 'dsh-chat-manager'] })
  assert.equal(invocation.command, layout.nodeExe)
  assert.equal(invocation.options.env.pnpm_config_offline, 'true')
  assert.equal(invocation.options.timeout, 30000)
  assert.equal(await readFile(path.join(layout.packageManagerStore, 'dependency'), 'utf8'), 'bundled dependency')
  await assert.rejects(readFile(path.join(layout.packageManagerStore, 'v11', 'projects', 'build-only')), { code: 'ENOENT' })
  assert.deepEqual(invocation.args.slice(0, 4), [layout.dshBin, 'plugin', '--profile', 'web'])
  const manifest = JSON.parse(await readFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['dsh-image-viewer'], imageVersion)
  assert.equal(manifest.dependencies['dsh-chat-manager'], chatVersion)
})

test('a product upgrade refreshes installed defaults from reviewed archives without touching user plugins', async (t) => {
  const layout = await fixture(t)
  await writeReviewedArchives(layout)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  const packageJson = `${JSON.stringify({
    dependencies: {
      'dsh-image-viewer': '0.1.0-beta.7',
      'user-selected-plugin': '3.1.4',
    },
  }, null, 2)}\n`
  await mkdir(profileRoot, { recursive: true })
  await writeFile(path.join(profileRoot, 'package.json'), packageJson)
  let invocation

  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync(command, args) { invocation = { command, args }; return { status: 0 } },
  })

  assert.deepEqual(result, { status: 'updated', profile: 'web', plugins: ['dsh-image-viewer'] })
  assert.equal(invocation.command, layout.nodeExe)
  assert.deepEqual(invocation.args.slice(0, 4), [layout.dshBin, 'plugin', '--profile', 'web'])
  assert.equal(invocation.args.filter(value => String(value).startsWith('file:')).length, 1)
  const manifest = JSON.parse(await readFile(path.join(profileRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['dsh-image-viewer'], imageVersion)
  assert.equal(manifest.dependencies['user-selected-plugin'], '3.1.4')
})

test('a failed reviewed-default refresh restores the original profile manifest', async (t) => {
  const layout = await fixture(t)
  await writeReviewedArchives(layout)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  const packageJson = '{"dependencies":{"dsh-image-viewer":"0.1.0-beta.7","user-selected-plugin":"3.1.4"}}\n'
  await mkdir(profileRoot, { recursive: true })
  await writeFile(path.join(profileRoot, 'package.json'), packageJson)

  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync() { return { status: 1, stderr: 'install failed: peer dependency conflict\ntoken=private-test-value' } },
  })

  assert.equal(result.status, 'warning')
  assert.equal(result.profile, 'web')
  assert.match(result.message, /exited with status 1/)
  assert.match(result.message, /peer dependency conflict/)
  assert.doesNotMatch(result.message, /private-test-value/)
  assert.equal(await readFile(path.join(profileRoot, 'package.json'), 'utf8'), packageJson)
})

for (const core of ['0.1.6-alpha.2', '0.1.5-rc.2']) {
  test(`failed offline default refresh preserves data and isolates only the known incompatible core (${core})`, async (t) => {
    const layout = await fixture(t)
    await writeReviewedArchives(layout)
    await mkdir(path.join(layout.root, 'licenses'), { recursive: true })
    await writeFile(path.join(layout.root, 'licenses', 'COMPONENTS.json'), JSON.stringify({
      dshVersion: core,
      defaultPlugins: PREVIEW_DEFAULT_PLUGINS.map(p => ({ package: p.name, version: p.version, sha256: p.sha256, integrity: p.integrity })),
    }))
    const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
    await mkdir(profileRoot, { recursive: true })
    const original = {
      dependencies: { 'dsh-chat-manager': '1.3.5', 'dsh-codex-subscription': '2.1.2' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'dsh-chat-manager', 'dsh-codex-subscription'], patchReload: 'live' } },
    }
    await writeFile(path.join(profileRoot, 'package.json'), JSON.stringify(original))
    const dataFile = path.join(profileRoot, 'session-preservation-proof')
    await writeFile(dataFile, 'unchanged session data')
    const result = await seedDefaultPlugins(layout, {
      verifyArchive: async () => true,
      spawnSync() { return { status: 1, stderr: 'ERR_PNPM_NO_OFFLINE_META: unrelated optional dependency' } },
    })
    const actual = JSON.parse(await readFile(path.join(profileRoot, 'package.json'), 'utf8'))
    assert.deepEqual(actual.dependencies, original.dependencies)
    assert.equal(actual.dsh.profile.patchReload, 'live')
    assert.equal(await readFile(dataFile, 'utf8'), 'unchanged session data')
    assert.equal(result.status, 'warning')
    if (core === '0.1.6-alpha.2') {
      assert.deepEqual(result.disabledPlugins, ['dsh-chat-manager'])
      assert.deepEqual(actual.dsh.profile.bundles, ['@deepseek-ai/dsh-web-app', 'dsh-codex-subscription'])
    } else {
      assert.equal(result.disabledPlugins, undefined)
      assert.deepEqual(actual, original)
    }
  })
}

test('a newer installed default is never downgraded to the packaged review baseline', async (t) => {
  const layout = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  const futureVersion = `${Number(imageVersion.split('.')[0]) + 1}.0.0`
  const packageJson = JSON.stringify({ dependencies: { 'dsh-image-viewer': futureVersion, 'user-selected-plugin': '3.1.4' } })
  await writeFile(path.join(profileRoot, 'package.json'), packageJson)
  let spawned = false

  const result = await seedDefaultPlugins(layout, {
    spawnSync() { spawned = true; return { status: 0 } },
  })

  assert.deepEqual(result, { status: 'skipped', profile: 'web', reason: 'defaults-current' })
  assert.equal(spawned, false)
  assert.equal(await readFile(path.join(profileRoot, 'package.json'), 'utf8'), packageJson)
})

test('an existing profile without a plugin manifest does not block startup or overwrite user files', async (t) => {
  const layout = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  const marker = path.join(profileRoot, 'user-settings.yml')
  await writeFile(marker, 'keep: true\n')
  const result = await seedDefaultPlugins(layout, { spawnSync() { assert.fail('must not install into an existing profile') } })
  assert.equal(result.status, 'skipped')
  assert.equal(await readFile(marker, 'utf8'), 'keep: true\n')
  await assert.rejects(readFile(path.join(profileRoot, 'package.json')), { code: 'ENOENT' })
})

test('removing a default plugin is durable because every existing profile skips seeding', async (t) => {
  const layout = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  const packageJson = JSON.stringify({ dependencies: { 'dsh-image-viewer': imageVersion } })
  await writeFile(path.join(profileRoot, 'package.json'), packageJson)
  let spawned = false
  const result = await seedDefaultPlugins(layout, { spawnSync() { spawned = true; return { status: 0 } } })
  assert.deepEqual(result, { status: 'skipped', profile: 'web', reason: 'defaults-current' })
  assert.equal(spawned, false)
  assert.equal(await readFile(path.join(profileRoot, 'package.json'), 'utf8'), packageJson)
})
