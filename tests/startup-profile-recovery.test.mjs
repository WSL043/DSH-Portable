import assert from 'node:assert/strict'
import { cp, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { layoutForRoot, parseCli } from '../launcher/portable-core.mjs'
import { inspectStartupProfile, pauseStartupProfileBundle, restoreStartupProfileBundle } from '../launcher/startup-profile-recovery.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-startup-recovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  const profile = path.join(layout.dshHome, 'profiles', 'web')
  const manifestFile = path.join(profile, 'package.json')
  const bundles = ['@deepseek-ai/dsh-web-app', 'community-a', 'community-b', '@deepseek-ai/dsh-experimental-agent-team-web-profile']
  await mkdir(profile, { recursive: true })
  await writeFile(manifestFile, JSON.stringify({
    dependencies: { 'community-a': '1.0.0', 'community-b': '2.0.0' },
    dsh: { profile: { bundles } },
  }))
  for (const name of bundles.slice(0, 3)) {
    const dir = name.startsWith('@deepseek-ai/') ? path.join(layout.appDir, 'node_modules', ...name.split('/')) : path.join(profile, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  }
  await mkdir(path.join(layout.dshHome, 'sessions'), { recursive: true })
  await writeFile(path.join(layout.dshHome, 'sessions', 'keep.jsonl'), 'private chat')
  await mkdir(layout.workspace, { recursive: true })
  await writeFile(path.join(layout.workspace, 'keep.txt'), 'workspace')
  return { layout, manifestFile, profile }
}

test('startup recovery identifies missing official bundle and pauses only selected community plugin', async t => {
  const { layout, manifestFile } = await fixture(t)
  const before = await inspectStartupProfile(layout)
  assert.equal(before.status, 'attention')
  assert.deepEqual(before.bundles.map(item => item.status), ['runtime', 'profile', 'profile', 'missing'])
  await assert.rejects(pauseStartupProfileBundle(layout, 1), /installed official bundles are protected/)
  const result = await pauseStartupProfileBundle(layout, 2)
  assert.equal(result.name, 'community-a')
  assert.equal(JSON.parse(await readFile(manifestFile, 'utf8')).dependencies['community-a'], '1.0.0')
  assert.deepEqual(JSON.parse(await readFile(manifestFile, 'utf8')).dsh.profile.bundles,
    ['@deepseek-ai/dsh-web-app', 'community-b', '@deepseek-ai/dsh-experimental-agent-team-web-profile'])
  assert.equal(await readFile(path.join(layout.dshHome, 'sessions', 'keep.jsonl'), 'utf8'), 'private chat')
  assert.equal(await readFile(path.join(layout.workspace, 'keep.txt'), 'utf8'), 'workspace')
  assert.equal((await inspectStartupProfile(layout)).paused[0].name, 'community-a')
  assert.deepEqual(JSON.parse(await readFile(result.backup, 'utf8')).dsh.profile.bundles, before.bundles.map(item => item.name))
  const restored = await restoreStartupProfileBundle(layout, 1)
  assert.equal(restored.name, 'community-a')
  assert.deepEqual(JSON.parse(await readFile(manifestFile, 'utf8')).dsh.profile.bundles, before.bundles.map(item => item.name))
  assert.deepEqual((await inspectStartupProfile(layout)).paused, [])
})

test('an unavailable official bundle can be isolated and only restored after its package is present', async t => {
  const { layout, manifestFile, profile } = await fixture(t)
  const paused = await pauseStartupProfileBundle(layout, 4)
  assert.equal(paused.name, '@deepseek-ai/dsh-experimental-agent-team-web-profile')
  assert.equal((await inspectStartupProfile(layout)).status, 'ok')
  await assert.rejects(restoreStartupProfileBundle(layout, 1), /not installed/)
  const packageRoot = path.join(profile, 'node_modules', '@deepseek-ai', 'dsh-experimental-agent-team-web-profile')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), '{"version":"1.0.0"}')
  assert.equal((await restoreStartupProfileBundle(layout, 1)).status, 'restored')
  assert.equal(JSON.parse(await readFile(manifestFile, 'utf8')).dsh.profile.bundles.at(-1), paused.name)
})

test('the generated parent resolver counts as an installed official bundle', async t => {
  const { layout, profile } = await fixture(t)
  const packageRoot = path.join(path.dirname(profile), 'node_modules', '@deepseek-ai', 'dsh-experimental-agent-team-web-profile')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), '{"version":"0.1.7-alpha.2"}')
  const result = await inspectStartupProfile(layout)
  assert.equal(result.status, 'ok')
  assert.equal(result.bundles[3].status, 'resolver')
  await assert.rejects(pauseStartupProfileBundle(layout, 4), /installed official bundles are protected/)
})

test('recovery refuses stale indices and unsafe profile manifest links', async t => {
  const { layout, manifestFile } = await fixture(t)
  await assert.rejects(pauseStartupProfileBundle(layout, 99), /active bundle/)
  await assert.rejects(restoreStartupProfileBundle(layout, 1), /paused plugin/)
  const outside = path.join(layout.root, 'outside.json')
  await writeFile(outside, await readFile(manifestFile))
  await rm(manifestFile)
  try { await symlink(outside, manifestFile, 'file') } catch (error) {
    if (error?.code === 'EPERM' && process.platform === 'win32') { t.skip('Windows file symlinks require Developer Mode or privilege'); return }
    throw error
  }
  assert.equal((await inspectStartupProfile(layout)).status, 'invalid-profile')
  await assert.rejects(pauseStartupProfileBundle(layout, 2), /Unsafe restore path/)
  assert.equal(JSON.parse(await readFile(outside, 'utf8')).dsh.profile.bundles.includes('community-a'), true)
})

test('a damaged recovery journal is diagnosed read-only and blocks further edits', async t => {
  const { layout } = await fixture(t)
  await mkdir(layout.stateDir, { recursive: true })
  await writeFile(path.join(layout.stateDir, 'startup-profile-recovery.json'), 'not json')
  const result = await inspectStartupProfile(layout)
  assert.equal(result.status, 'attention')
  assert.equal(result.journalError, true)
  await assert.rejects(pauseStartupProfileBundle(layout, 2), /JSON/)
})

test('restore clears an interrupted pause record when the bundle was never removed', async t => {
  const { layout, manifestFile } = await fixture(t)
  await pauseStartupProfileBundle(layout, 2)
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  manifest.dsh.profile.bundles.splice(1, 0, 'community-a')
  await writeFile(manifestFile, JSON.stringify(manifest))
  assert.equal((await restoreStartupProfileBundle(layout, 1)).status, 'already-active')
  assert.deepEqual((await inspectStartupProfile(layout)).paused, [])
  assert.equal(JSON.parse(await readFile(manifestFile, 'utf8')).dsh.profile.bundles.filter(name => name === 'community-a').length, 1)
})

test('recovery commands require explicit bounded plugin index', () => {
  assert.equal(parseCli(['recovery-plugins']).command, 'recovery-plugins')
  assert.deepEqual(parseCli(['recovery-pause-plugin', '--recovery-index', '2']), {
    ...parseCli(['recovery-pause-plugin']), recoveryIndex: 2,
  })
  assert.throws(() => parseCli(['recovery-restore-plugin', '--recovery-index', '0']), /integer from 1/)
})

test('the Windows recovery CLI refuses to change startup bundles while its backend is running', { skip: process.platform !== 'win32' }, async t => {
  const { layout, manifestFile } = await fixture(t)
  await cp(new URL('../launcher/', import.meta.url), path.join(layout.root, 'launcher'), { recursive: true })
  await mkdir(path.dirname(layout.nodeExe), { recursive: true })
  await link(process.execPath, layout.nodeExe)
  await writeFile(layout.hostBin, 'setInterval(() => {}, 1000)')
  await mkdir(path.dirname(layout.dshBin), { recursive: true })
  await writeFile(layout.dshBin, 'fixture')
  const child = spawn(layout.nodeExe, [layout.hostBin, layout.dshBin, '--port', '14198'], { windowsHide: true, stdio: 'ignore' })
  await once(child, 'spawn')
  try {
    await mkdir(path.dirname(layout.processState), { recursive: true })
    await writeFile(layout.processState, JSON.stringify({ pid: child.pid, port: 14198 }))
    const before = await readFile(manifestFile, 'utf8')
    const env = { ...process.env }
    for (const key of ['DSH_PORTABLE_STATE_ROOT', 'DSH_PORTABLE_RUNTIME_ROOT', 'DSH_PORTABLE_ENVIRONMENT']) delete env[key]
    await assert.rejects(promisify(execFile)(process.execPath, [path.join(layout.root, 'launcher', 'portable-cli.mjs'), 'recovery-pause-plugin', '--recovery-index', '2', '--json'], {
      env, windowsHide: true,
    }), /SHARED_COMPONENTS_BUSY/)
    assert.equal(await readFile(manifestFile, 'utf8'), before)
  } finally { const exited = once(child, 'exit'); child.kill(); await exited }
})
