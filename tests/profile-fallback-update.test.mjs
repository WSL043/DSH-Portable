import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { applyStagedAppUpdate } from '../launcher/update-core.mjs'

const licenseFiles = [
  'COMPONENTS.json',
  'DeepSeek-Harness-LICENSE.txt',
  'DeepSeek-Harness-THIRD_PARTY_NOTICES.md',
  'dsh-market-LICENSE.txt',
  'pnpm-LICENSE.txt',
]

async function exists(filename) {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

test('component updates rebuild only the managed profile module fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-profile-fallback-update-'))
  const layout = layoutForRoot(root)
  const stagedRoot = path.join(layout.updateDir, 'fixture', 'staged')
  const dshRelative = path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const profileSettings = path.join(layout.dshHome, 'profiles', 'web', 'settings.json')
  const userPlugin = path.join(layout.dshHome, 'profiles', 'web', 'node_modules', 'example-user-plugin', 'package.json')
  const managedFallback = path.join(layout.dshHome, 'profiles', 'node_modules')
  const staleFallback = path.join(managedFallback, '@deepseek-ai', 'dsh-client-ui-plan', 'stale.txt')
  const workspaceFile = path.join(layout.workspace, 'project.txt')

  try {
    await mkdir(path.dirname(path.join(layout.appDir, dshRelative)), { recursive: true })
    await writeFile(path.join(layout.appDir, dshRelative), 'old app\n')
    await mkdir(path.dirname(path.join(stagedRoot, 'app', dshRelative)), { recursive: true })
    await writeFile(path.join(stagedRoot, 'app', dshRelative), 'new app\n')

    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await mkdir(path.join(stagedRoot, 'licenses'), { recursive: true })
    const oldComponents = {
      portableVersion: '0.2.4',
      dshVersion: '0.1.0-rc.6',
      dshCommit: 'a'.repeat(40),
    }
    const newComponents = {
      portableVersion: '0.2.5',
      dshVersion: '0.1.0-rc.7',
      dshCommit: 'b'.repeat(40),
    }
    for (const name of licenseFiles) {
      await writeFile(
        path.join(root, 'licenses', name),
        name === 'COMPONENTS.json' ? `${JSON.stringify(oldComponents)}\n` : `old ${name}\n`,
      )
      await writeFile(
        path.join(stagedRoot, 'licenses', name),
        name === 'COMPONENTS.json' ? `${JSON.stringify(newComponents)}\n` : `new ${name}\n`,
      )
    }
    await writeFile(path.join(stagedRoot, 'component.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'dsh-app',
      portableVersion: newComponents.portableVersion,
      dshVersion: newComponents.dshVersion,
      dshCommit: newComponents.dshCommit,
    })}\n`)

    await mkdir(path.dirname(profileSettings), { recursive: true })
    await mkdir(path.dirname(userPlugin), { recursive: true })
    await mkdir(path.dirname(staleFallback), { recursive: true })
    await mkdir(path.dirname(workspaceFile), { recursive: true })
    await writeFile(profileSettings, '{"theme":"dark"}\n')
    await writeFile(userPlugin, '{"name":"example-user-plugin"}\n')
    await writeFile(staleFallback, 'stale generated link target\n')
    await writeFile(workspaceFile, 'keep workspace\n')

    let fallbackWasResetBeforeHealthCheck = false
    const result = await applyStagedAppUpdate({
      layout,
      stagedRoot,
      healthCheck: async () => {
        fallbackWasResetBeforeHealthCheck = !await exists(managedFallback)
        assert.equal(await readFile(profileSettings, 'utf8'), '{"theme":"dark"}\n')
        assert.equal(await readFile(userPlugin, 'utf8'), '{"name":"example-user-plugin"}\n')
        assert.equal(await readFile(workspaceFile, 'utf8'), 'keep workspace\n')
        return true
      },
    })

    assert.equal(result.status, 'updated')
    assert.equal(fallbackWasResetBeforeHealthCheck, true)
    assert.equal(await exists(managedFallback), false)
    assert.equal(await readFile(path.join(layout.appDir, dshRelative), 'utf8'), 'new app\n')
    assert.equal(await readFile(profileSettings, 'utf8'), '{"theme":"dark"}\n')
    assert.equal(await readFile(userPlugin, 'utf8'), '{"name":"example-user-plugin"}\n')
    assert.equal(await readFile(workspaceFile, 'utf8'), 'keep workspace\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
