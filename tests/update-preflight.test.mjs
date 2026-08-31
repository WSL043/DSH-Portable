import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { discoverExistingDshProfiles, preflightStagedDshProfiles } from '../launcher/update-preflight.mjs'

test('profile discovery includes only initialized profiles in stable name order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-profiles-'))
  const layout = layoutForRoot(root)
  try {
    for (const profile of ['web', 'headless']) {
      await mkdir(path.join(layout.dshHome, 'profiles', profile), { recursive: true })
      await writeFile(path.join(layout.dshHome, 'profiles', profile, 'package.json'), '{}\n')
    }
    await mkdir(path.join(layout.dshHome, 'profiles', 'empty'), { recursive: true })
    await mkdir(path.join(layout.dshHome, 'profiles', 'node_modules'), { recursive: true })
    await writeFile(path.join(layout.dshHome, 'profiles', 'node_modules', 'package.json'), '{}\n')

    assert.deepEqual(await discoverExistingDshProfiles(layout), ['headless', 'web'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('expanded target runtime composes every existing profile without a visible console', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-preflight-'))
  const layout = layoutForRoot(root)
  const stagedRoot = path.join(root, '.dsh-portable-update', 'operation', 'staged')
  const targetDsh = path.join(stagedRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  try {
    await mkdir(path.dirname(targetDsh), { recursive: true })
    await writeFile(targetDsh, '// fixture\n')
    await mkdir(layout.workspace, { recursive: true })
    await mkdir(path.join(layout.dshHome, 'profiles', 'web'), { recursive: true })
    await writeFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json'), '{}\n')
    const calls = []

    const result = await preflightStagedDshProfiles({
      layout,
      stagedRoot,
      metadata: { kind: 'dsh-app', dshVersion: '0.1.2-alpha.2', portableVersion: '0.6.0-rc.4' },
      run: async (command, args, options) => calls.push({ command, args, options }),
    })

    assert.equal(result.status, 'passed')
    assert.deepEqual(result.profiles, ['web'])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, layout.nodeExe)
    assert.deepEqual(calls[0].args, [targetDsh, '--profile', 'web', '--dump-config'])
    assert.equal(calls[0].options.windowsHide, true)
    assert.equal(calls[0].options.timeout, 30000)
    assert.equal(calls[0].options.env.DSH_HOME, layout.dshHome)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed capsule profile preflight releases its lease and removes the unused target cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-capsule-preflight-'))
  const runtimeRoot = path.join(root, 'runtime-cache', 'b'.repeat(64))
  const layout = layoutForRoot(root, process.platform, root, path.join(root, 'runtime-cache', 'a'.repeat(64)))
  const stagedRoot = path.join(root, '.dsh-portable-update', 'operation', 'staged')
  let released = false
  let cleaned = false
  try {
    await mkdir(path.join(layout.dshHome, 'profiles', 'web'), { recursive: true })
    await writeFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json'), '{}\n')
    await mkdir(path.join(runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await writeFile(path.join(runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '// fixture\n')

    await assert.rejects(preflightStagedDshProfiles({
      layout,
      stagedRoot,
      metadata: { kind: 'dsh-runtime-capsule', dshVersion: '0.1.2-alpha.2', portableVersion: '0.6.0-rc.4' },
      ensureCapsule: async () => ({ mode: 'capsule', runtimeRoot }),
      acquireLease: async () => async () => { released = true },
      cleanCaches: async (portableRoot) => {
        assert.equal(portableRoot, layout.root)
        assert.equal(released, true)
        cleaned = true
      },
      run: async () => { throw new Error('missing settingsNamespace export') },
    }), (error) => error.code === 'DSH_PROFILE_PREFLIGHT_FAILED' && /web/.test(error.message))
    assert.equal(released, true)
    assert.equal(cleaned, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
