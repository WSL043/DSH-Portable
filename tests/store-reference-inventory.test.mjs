import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { inspectStoreReferences } from '../launcher/store-reference-inventory.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-store-references-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = async (name, content = '{}') => {
    const filename = path.join(root, name)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
    return filename
  }
  return { root, file }
}

test('collects every environment, non-web profile, import rollback and startup repair reference', async t => {
  const { root, file } = await fixture(t)
  const paths = [
    'data/dsh-home/profiles/web/package.json',
    'data/dsh-home/profiles/web/pnpm-lock.yaml',
    'data/dsh-home/profiles/terminal/package.json',
    'data/dsh-home/profiles/web/node_modules/.pnpm/lock.yaml',
    'data/dsh-home/profiles/web/.node_modules.dsh-portable-backup-123-456/.pnpm/lock.yaml',
    'data/dsh-home/profiles/web/node_modules.dsh-portable-recovery-123-456/.pnpm/lock.yaml',
    'data/dsh-home/profiles/web/pnpm-lock.yaml.dsh-portable-recovery-123-456',
    'data/backups/before-import-example/generated/data/dsh-home/profiles/web/node_modules/.pnpm/lock.yaml',
    'data/backups/before-import-example/data/dsh-home/profiles/web/package.json',
    'data/recovery/managed-packages/fallback-example/original/package.json',
    'data/runtime/startup-profile-backup-example.json',
    'environments/work/data/dsh-home/profiles/web/package.json',
  ]
  for (const filename of [...paths]) if (filename.endsWith('/.pnpm/lock.yaml')) paths.push(filename.replace('/.pnpm/lock.yaml', '/.modules.yaml'))
  for (const filename of paths) await file(filename)
  await file('data/dsh-home/profiles/web/.dsh-portable-archives/sha512-example.tgz', 'opaque')
  // Dependencies, resolver junctions, logs, sessions and workspaces are not walked.
  await file('data/dsh-home/profiles/node_modules/package.json', 'invalid')
  await file('data/dsh-home/profiles/web/node_modules/plugin/package.json', 'invalid')
  await file('data/dsh-home/profiles/web/.plugin-manager/logs/package.json', 'invalid')
  await file('workspace/package.json', 'invalid')
  const result = await inspectStoreReferences(root)
  assert.equal(result.complete, true, JSON.stringify(result.blockers))
  assert.deepEqual(result.environments.map(x => x.id), ['default', 'work'])
  const references = result.environments.flatMap(x => x.references).map(x => path.relative(root, x.path).replaceAll('\\', '/'))
  assert.deepEqual(references.sort(), paths.sort())
  assert.equal(result.environments[0].archives.length, 1)
  assert.equal(result.environments[0].profiles.length, 2)
  assert.equal(result.environments[0].installations.length, 4)
  assert.equal(result.environments[1].store, path.join(root, 'environments/work/data/pnpm-store'))
})

test('linked environments are blockers, not silently skipped references', async t => {
  const { root, file } = await fixture(t)
  const external = path.join(root, 'external')
  await file('external/data/dsh-home/profiles/web/package.json')
  await mkdir(path.join(root, 'environments'))
  await symlink(external, path.join(root, 'environments/work'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = await inspectStoreReferences(root)
  assert.equal(result.complete, false)
  assert.ok(result.blockers.some(x => x.code === 'linked-environment'))
  assert.equal(result.environments.length, 1)
})

test('linked data roots are never followed and unknown environment names block GC', async t => {
  const { root, file } = await fixture(t)
  await file('external/dsh-home/profiles/web/package.json')
  await symlink(path.join(root, 'external'), path.join(root, 'data'), process.platform === 'win32' ? 'junction' : 'dir')
  await mkdir(path.join(root, 'environments/Work'), { recursive: true })
  const result = await inspectStoreReferences(root)
  assert.equal(result.complete, false)
  assert.ok(result.blockers.some(x => x.code === 'linked-reference'))
  assert.ok(result.blockers.some(x => x.code === 'ambiguous-environment'))
  assert.equal(result.environments[0].references.length, 0)
})

test('broken manifests, lost installed locks and opaque exports prevent complete discovery', async t => {
  const { root, file } = await fixture(t)
  await file('data/dsh-home/profiles/web/package.json', 'broken')
  await file('data/dsh-home/profiles/web/node_modules/plugin/index.js', '')
  await file('data/backups/export.dshdata', 'encrypted')
  const result = await inspectStoreReferences(root)
  assert.equal(result.complete, false)
  for (const code of ['invalid-manifest', 'missing-installed-lock', 'opaque-export'])
    assert.ok(result.blockers.some(x => x.code === code), code)
})

test('bounded and cancelled scans cannot authorize partial-reference cleanup', async t => {
  const { root, file } = await fixture(t)
  for (let i = 0; i < 20; i++) await file(`data/dsh-home/profiles/p${i}/package.json`)
  const limited = await inspectStoreReferences(root, { maxEntries: 5 })
  assert.equal(limited.complete, false)
  assert.ok(limited.blockers.some(x => x.code === 'scan-limited'))
  const cancelled = await inspectStoreReferences(root, { signal: AbortSignal.abort() })
  assert.equal(cancelled.complete, false)
  assert.ok(cancelled.blockers.some(x => x.code === 'cancelled'))
})

async function emptyHoistedFixture(t) {
  const fixtureData = await fixture(t)
  const { root, file } = fixtureData
  const profile = 'data/dsh-home/profiles/web'
  const modules = path.join(root, profile, 'node_modules')
  const manifest = { name: 'dsh-profile-web', dependencies: {} }
  const lock = { lockfileVersion: '9.0', settings: { autoInstallPeers: false }, importers: { '.': {} } }
  const metadata = { nodeLinker: 'hoisted', packageManager: 'pnpm@11.11.0', hoistedLocations: {}, injectedDeps: {},
    pendingBuilds: [], skipped: [], storeDir: path.join(root, 'data/pnpm-store/v11'), virtualStoreDir: path.join(modules, '.pnpm') }
  await file(profile + '/package.json', JSON.stringify(manifest))
  await file(profile + '/pnpm-lock.yaml', JSON.stringify(lock))
  await file(profile + '/node_modules/.modules.yaml', JSON.stringify(metadata))
  await file(profile + '/node_modules/.package-map.json', JSON.stringify({ packages: { '.': { url: '..', dependencies: { 'dsh-profile-web': '.' } } } }))
  await file(profile + '/node_modules/.pnpm-workspace-state-v1.json', JSON.stringify({ projects: { [path.join(root, profile)]: { name: 'dsh-profile-web' } },
    settings: { nodeLinker: 'hoisted', enableGlobalVirtualStore: false }, pnpmfiles: [] }))
  return { ...fixtureData, profile, modules, manifest, lock, metadata }
}

test('only an independently verified current empty hoisted installation may omit the installed lock', async t => {
  const { root, modules } = await emptyHoistedFixture(t)
  const conservative = await inspectStoreReferences(root)
  assert.equal(conservative.complete, false, 'callers without the locked runtime parser stay fail closed')
  assert.ok(conservative.blockers.some(x => x.code === 'missing-installed-lock'))
  const result = await inspectStoreReferences(root, { parseYaml: JSON.parse })
  assert.equal(result.complete, true, JSON.stringify(result.blockers))
  assert.equal(result.environments[0].installations.length, 1)
  assert.equal(result.environments[0].installations[0].empty, true)
  assert.equal(result.environments[0].installations[0].lock, null)
  assert.equal(result.environments[0].references.filter(x => x.kind === 'empty-installation-state').length, 2)
  await mkdir(path.join(modules, '.pnpm'))
  assert.equal((await inspectStoreReferences(root, { parseYaml: JSON.parse })).complete, true, 'an empty virtual-store directory has no hidden graph')
})

test('nonempty, unknown and recovery hoisted installations still require their own installed lock', async t => {
  const cases = [
    ['nonempty manifest', async f => { f.manifest.dependencies.plugin = '1.0.0'; await f.file(f.profile + '/package.json', JSON.stringify(f.manifest)) }],
    ['nonempty lock graph', async f => { f.lock.snapshots = { 'plugin@1.0.0': {} }; await f.file(f.profile + '/pnpm-lock.yaml', JSON.stringify(f.lock)) }],
    ['unrecognized lock data', async f => { f.lock.catalogs = {}; await f.file(f.profile + '/pnpm-lock.yaml', JSON.stringify(f.lock)) }],
    ['unknown installed entry', async f => { await f.file(f.profile + '/node_modules/plugin/index.js', '') }],
    ['foreign workspace project', async f => { await f.file(f.profile + '/node_modules/.pnpm-workspace-state-v1.json', JSON.stringify({ projects: { '/foreign': {} }, settings: { nodeLinker: 'hoisted', enableGlobalVirtualStore: false }, pnpmfiles: [] })) }],
    ['ambiguous metadata', async f => { f.metadata.nodeLinker = 'isolated'; await f.file(f.profile + '/node_modules/.modules.yaml', JSON.stringify(f.metadata)) }],
    ['lost virtual-store lock', async f => { await f.file(f.profile + '/node_modules/.pnpm/plugin/package.json') }],
    ['backup has no installed lock', async f => { await f.file(f.profile + '/node_modules.dsh-portable-recovery-example/.modules.yaml', JSON.stringify(f.metadata)) }],
    ['unreadable lock syntax', async f => { await f.file(f.profile + '/pnpm-lock.yaml', 'not-json') }],
  ]
  for (const [name, mutate] of cases) await t.test(name, async t => {
    const f = await emptyHoistedFixture(t)
    await mutate(f)
    const result = await inspectStoreReferences(f.root, { parseYaml: JSON.parse })
    assert.equal(result.complete, false)
    assert.ok(result.blockers.some(x => x.code === 'missing-installed-lock'), JSON.stringify(result.blockers))
  })
})
