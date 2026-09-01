import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  changedPluginProfiles,
  discoverIncompleteProfiles,
  rehydrateImportedProfiles,
  repairIncompleteProfileDependencies,
} from '../launcher/data-import-preflight.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

test('data import identifies only safe changed plugin profiles', () => {
  assert.deepEqual(changedPluginProfiles([
    { category: 'plugins', path: 'data/dsh-home/profiles/web/package.json' },
    { category: 'plugins', path: 'data/dsh-home/profiles/web/cordis.yml' },
    { category: 'plugins', path: 'data/dsh-home/profiles/agent-2/package.json' },
    { category: 'sessions', path: 'data/dsh-home/profiles/ignored/package.json' },
    { category: 'plugins', path: 'data/dsh-home/profiles/../unsafe/package.json' },
  ]), ['agent-2', 'web'])
})

test('data import restores exact profile dependencies before composing the imported profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-data-import-preflight-'))
  const layout = layoutForRoot(root, process.platform)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  await writeFile(path.join(profileRoot, 'package.json'), '{"dependencies":{"plugin-a":"1.2.3"}}\n')
  const prepared = []
  const calls = []

  const result = await rehydrateImportedProfiles({
    layout,
    changed: [{ category: 'plugins', path: 'data/dsh-home/profiles/web/package.json' }],
    transaction: { prepareGeneratedPath: async target => prepared.push(target) },
    run: async (command, args, options) => calls.push({ command, args, options }),
  })

  assert.deepEqual(result, { status: 'passed', profiles: ['web'] })
  assert.deepEqual(prepared, [path.join(profileRoot, 'node_modules'), path.join(profileRoot, 'pnpm-lock.yaml')])
  assert.deepEqual(calls.map(call => call.args.slice(1)), [
    ['plugin', '--profile', 'web', 'install', '--force'],
    ['--profile', 'web', '--dump-config'],
  ])
  assert.ok(calls.every(call => call.options.windowsHide === true))
})

test('data import rejects an unresolvable profile before it can be accepted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-data-import-preflight-'))
  const layout = layoutForRoot(root, process.platform)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  await writeFile(path.join(profileRoot, 'package.json'), '{"dependencies":{"missing-plugin":"9.9.9"}}\n')
  let calls = 0

  await assert.rejects(rehydrateImportedProfiles({
    layout,
    changed: [{ category: 'plugins', path: 'data/dsh-home/profiles/web/package.json' }],
    transaction: { prepareGeneratedPath: async () => {} },
    run: async () => {
      calls += 1
      throw Object.assign(new Error('package not found'), { stderr: 'ERR_PNPM_FETCH_404' })
    },
  }), error => error.code === 'DSH_DATA_IMPORT_PROFILE_FAILED' && /rolled back/.test(error.message))
  assert.equal(calls, 1)
})

test('startup repairs only profiles whose declared plugin dependency is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-data-import-recovery-'))
  const layout = layoutForRoot(root, process.platform)
  const web = path.join(layout.dshHome, 'profiles', 'web')
  const ready = path.join(layout.dshHome, 'profiles', 'ready')
  await mkdir(path.join(ready, 'node_modules', 'plugin-b'), { recursive: true })
  await mkdir(web, { recursive: true })
  await writeFile(path.join(web, 'package.json'), '{"dependencies":{"plugin-a":"1.0.0"}}\n')
  await writeFile(path.join(ready, 'package.json'), '{"dependencies":{"plugin-b":"1.0.0"}}\n')
  await writeFile(path.join(ready, 'node_modules', 'plugin-b', 'package.json'), '{"version":"1.0.0"}\n')
  assert.deepEqual(await discoverIncompleteProfiles(layout), ['web'])

  let repaired
  const result = await repairIncompleteProfileDependencies({
    layout,
    rehydrate: async ({ changed, transaction }) => {
      repaired = changed
      const modules = path.join(web, 'node_modules')
      await transaction.prepareGeneratedPath(modules)
      await mkdir(path.join(modules, 'plugin-a'), { recursive: true })
      await writeFile(path.join(modules, 'plugin-a', 'package.json'), '{"version":"1.0.0"}\n')
      return { status: 'passed', profiles: ['web'] }
    },
  })
  assert.deepEqual(result, { status: 'repaired', profiles: ['web'] })
  assert.deepEqual(repaired, [{ category: 'plugins', path: 'data/dsh-home/profiles/web/package.json' }])
  assert.deepEqual(await discoverIncompleteProfiles(layout), [])
})

test('failed startup profile repair restores the previous generated dependency state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-data-import-recovery-'))
  const layout = layoutForRoot(root, process.platform)
  const web = path.join(layout.dshHome, 'profiles', 'web')
  const modules = path.join(web, 'node_modules')
  await mkdir(path.join(modules, 'unrelated'), { recursive: true })
  await writeFile(path.join(web, 'package.json'), '{"dependencies":{"plugin-a":"1.0.0"}}\n')
  await writeFile(path.join(modules, 'unrelated', 'keep.txt'), 'keep')

  await assert.rejects(repairIncompleteProfileDependencies({
    layout,
    rehydrate: async ({ transaction }) => {
      await transaction.prepareGeneratedPath(modules)
      await mkdir(modules, { recursive: true })
      throw new Error('network unavailable')
    },
  }), /network unavailable/)
  assert.equal(await readFile(path.join(modules, 'unrelated', 'keep.txt'), 'utf8'), 'keep')
})
