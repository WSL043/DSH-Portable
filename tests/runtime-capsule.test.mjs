import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRuntimeCapsule } from '../scripts/create-runtime-capsule.mjs'
import { copyCapsuleShell } from '../scripts/package-windows-runtime-capsule.mjs'
import {
  acquireRuntimeLease,
  capsulePaths,
  cleanUnusedRuntimeCaches,
  ensureRuntimeCapsule,
  runtimeCacheStatus,
  runtimePreparationDiagnostic,
} from '../launcher/runtime-capsule.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

const REQUIRED = [
  'package.json',
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@wsl043/dsh-portable-desktop-bridge/cordis.patch.yml',
  'node_modules/@wsl043/dsh-portable-plugin-market/package.json',
  'node_modules/pnpm/bin/pnpm.cjs',
]

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-capsule-test-'))
  const root = path.join(parent, 'portable-a')
  const app = path.join(root, 'app')
  for (const relative of REQUIRED) {
    const filename = path.join(app, ...relative.split('/'))
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, `${relative}\n`, 'utf8')
  }
  return { parent, root, app }
}

test('runtime capsule extracts once, verifies its content, and follows a moved portable source', async () => {
  const { parent, root, app } = await fixture()
  const cache = path.join(parent, 'machine-cache')
  try {
    const capsule = path.join(root, 'runtime', 'DSH-App.dshpack')
    const manifest = path.join(root, 'runtime-capsule.json')
    await createRuntimeCapsule(app, capsule, manifest, { platform: process.platform, arch: process.arch, level: 1 })
    await rm(app, { recursive: true, force: true })

    const first = await ensureRuntimeCapsule(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(first.mode, 'capsule')
    assert.equal(first.reused, false)
    assert.equal(await readFile(path.join(first.runtimeRoot, 'app', 'package.json'), 'utf8'), 'package.json\n')

    const moved = path.join(parent, 'portable-b')
    await rename(root, moved)
    const second = await ensureRuntimeCapsule(moved, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(second.runtimeRoot, first.runtimeRoot)
    assert.equal(second.reused, true)
    assert.equal(capsulePaths(moved, { DSH_PORTABLE_RUNTIME_CACHE: cache }).cacheParent, path.resolve(cache))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('runtime preparation diagnostics distinguish one-time extraction from a reused cache', () => {
  assert.equal(
    runtimePreparationDiagnostic({ mode: 'capsule', reused: false, manifest: { sha256: 'a'.repeat(64), fileCount: 9265, bytes: 22636008, rawBytes: 105077685 } }, 8123),
    'prepared hash=aaaaaaaaaaaa files=9265 packed=22636008 raw=105077685 elapsed=8123ms',
  )
  assert.equal(
    runtimePreparationDiagnostic({ mode: 'capsule', reused: true, manifest: { sha256: 'b'.repeat(64), fileCount: 9265, bytes: 22636008, rawBytes: 105077685 } }, 9),
    'reused hash=bbbbbbbbbbbb files=9265 elapsed=9ms',
  )
  assert.equal(runtimePreparationDiagnostic({ mode: 'expanded', reused: true }, 2), 'expanded-layout elapsed=2ms')
})

test('layout keeps mutable data in the portable root and reads only app files from a capsule cache', () => {
  const layout = layoutForRoot('C:\\Portable', 'win32', 'C:\\Portable', 'C:\\Cache\\runtime')
  assert.equal(layout.appDir, 'C:\\Cache\\runtime\\app')
  assert.equal(layout.nodeExe, 'C:\\Portable\\runtime\\node\\node.exe')
  assert.equal(layout.dataDir, 'C:\\Portable\\data')
  assert.equal(layout.workspace, 'C:\\Portable\\workspace')
  assert.equal(layout.capsuleMode, true)
  assert.equal(layout.runtimeCapsule, 'C:\\Portable\\runtime-capsule.json')
})

test('expanded packages remain backward compatible when no capsule manifest exists', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-expanded-test-'))
  try {
    const result = await ensureRuntimeCapsule(parent)
    assert.deepEqual(result, { mode: 'expanded', runtimeRoot: path.resolve(parent), reused: true })
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('compact runtimes reject expanded component payloads', async () => {
  const source = await readFile(new URL('../launcher/update-core.mjs', import.meta.url), 'utf8')
  assert.match(source, /layout\.capsuleMode !== \(update\.component\.kind === 'dsh-runtime-capsule'\)/)
})

test('a crashed capsule preparer cannot leave a permanent lock', async () => {
  const { parent, root, app } = await fixture()
  const cache = path.join(parent, 'machine-cache')
  try {
    const capsule = path.join(root, 'runtime', 'DSH-App.dshpack')
    const manifestFile = path.join(root, 'runtime-capsule.json')
    const manifest = await createRuntimeCapsule(app, capsule, manifestFile, { platform: process.platform, arch: process.arch, level: 1 })
    await rm(app, { recursive: true, force: true })
    await mkdir(cache, { recursive: true })
    const lock = path.join(cache, `${manifest.sha256}.lock`)
    await writeFile(lock, `${JSON.stringify({ schemaVersion: 1, pid: 2147483647, token: 'crashed', startedAt: '2000-01-01T00:00:00.000Z' })}\n`)

    const result = await ensureRuntimeCapsule(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache }, waitMs: 50 })
    assert.equal(result.reused, false)
    await assert.rejects(stat(lock), { code: 'ENOENT' })
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('a live capsule preparer lock is never reclaimed', async () => {
  const { parent, root, app } = await fixture()
  const cache = path.join(parent, 'machine-cache')
  try {
    const capsule = path.join(root, 'runtime', 'DSH-App.dshpack')
    const manifestFile = path.join(root, 'runtime-capsule.json')
    const manifest = await createRuntimeCapsule(app, capsule, manifestFile, { platform: process.platform, arch: process.arch, level: 1 })
    await rm(app, { recursive: true, force: true })
    await mkdir(cache, { recursive: true })
    const lock = path.join(cache, `${manifest.sha256}.lock`)
    await writeFile(lock, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'live', startedAt: '2000-01-01T00:00:00.000Z' })}\n`)

    await assert.rejects(
      ensureRuntimeCapsule(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache }, waitMs: 50 }),
      /still preparing this runtime capsule/,
    )
    assert.equal(JSON.parse(await readFile(lock, 'utf8')).token, 'live')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('capsule packaging never carries smoke data or user workspaces into a release', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-capsule-shell-'))
  const source = path.join(parent, 'source')
  const target = path.join(parent, 'target')
  try {
    await mkdir(path.join(source, 'app'), { recursive: true })
    await writeFile(path.join(source, 'app', 'package.json'), '{"name":"fixture"}\n')
    await mkdir(path.join(source, 'licenses'), { recursive: true })
    await writeFile(path.join(source, 'licenses', 'COMPONENTS.json'), '{"portableVersion":"0.5.0"}\n')
    await mkdir(path.join(source, 'data', 'dsh-home'), { recursive: true })
    await mkdir(path.join(source, 'workspace'), { recursive: true })
    await mkdir(path.join(source, 'launcher'), { recursive: true })
    await writeFile(path.join(source, 'data', 'dsh-home', 'private.json'), 'user data')
    await writeFile(path.join(source, 'data', 'README.txt'), 'data guide')
    await writeFile(path.join(source, 'workspace', 'work.txt'), 'workspace data')
    await writeFile(path.join(source, 'workspace', 'README.txt'), 'workspace guide')
    await writeFile(path.join(source, 'launcher', 'portable-cli.mjs'), 'launcher')

    await copyCapsuleShell(source, target)

    assert.equal(await readFile(path.join(target, 'launcher', 'portable-cli.mjs'), 'utf8'), 'launcher')
    await assert.rejects(readFile(path.join(target, 'data', 'dsh-home', 'private.json')), { code: 'ENOENT' })
    await assert.rejects(readFile(path.join(target, 'workspace', 'work.txt')), { code: 'ENOENT' })
    assert.equal((await stat(path.join(target, 'data'))).isDirectory(), true)
    assert.equal((await stat(path.join(target, 'workspace'))).isDirectory(), true)
    assert.equal(await readFile(path.join(target, 'data', 'README.txt'), 'utf8'), 'data guide')
    assert.equal(await readFile(path.join(target, 'workspace', 'README.txt'), 'utf8'), 'workspace guide')
    assert.equal(await readFile(path.join(target, 'app', 'package.json'), 'utf8'), '{"name":"fixture"}\n')
    assert.equal(
      JSON.parse(await readFile(path.join(target, 'licenses', 'COMPONENTS.json'), 'utf8')).runtimeLayout,
      'capsule-v1',
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('cache cleanup removes only unused old runtimes and never an active lease or current runtime', async () => {
  const { parent, root, app } = await fixture()
  const cache = path.join(parent, 'machine-cache')
  try {
    const capsule = path.join(root, 'runtime', 'DSH-App.dshpack')
    const manifestFile = path.join(root, 'runtime-capsule.json')
    await createRuntimeCapsule(app, capsule, manifestFile, { platform: process.platform, arch: process.arch, level: 1 })
    await rm(app, { recursive: true, force: true })
    const current = await ensureRuntimeCapsule(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    const oldHash = 'a'.repeat(64)
    const oldRuntime = path.join(cache, oldHash)
    await mkdir(oldRuntime, { recursive: true })
    await writeFile(path.join(oldRuntime, 'old-runtime.txt'), 'old')
    const release = await acquireRuntimeLease(oldRuntime, { waitMs: 50 })

    const before = await runtimeCacheStatus(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(before.caches.find((entry) => entry.hash === oldHash)?.active, true)
    const retained = await cleanUnusedRuntimeCaches(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.deepEqual(retained.removed, [])
    assert.equal(retained.retained.some((entry) => entry.hash === oldHash && entry.reason === 'active'), true)
    assert.equal(retained.retained.some((entry) => entry.hash === path.basename(current.runtimeRoot) && entry.reason === 'current'), true)

    await release()
    const cleaned = await cleanUnusedRuntimeCaches(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(cleaned.removed.some((entry) => entry.hash === oldHash), true)
    await assert.rejects(stat(oldRuntime), { code: 'ENOENT' })
    assert.equal((await stat(current.runtimeRoot)).isDirectory(), true)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
