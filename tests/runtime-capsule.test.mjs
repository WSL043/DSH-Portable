import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fsPromises } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { zstdDecompressSync } from 'node:zlib'

import { createRuntimeCapsule } from '../scripts/create-runtime-capsule.mjs'
import { copyCapsuleShell } from '../scripts/package-windows-runtime-capsule.mjs'
import {
  acquireRuntimeLease,
  capsulePaths,
  cleanUnusedRuntimeCaches,
  commitRuntimeDirectory,
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

test('Windows runtime directory commit retries transient rename failures with bounded delays', async () => {
  const calls = []
  const sleeps = []
  let attempt = 0
  const result = await commitRuntimeDirectory('temporary', 'target', {
    platform: 'win32',
    renameImpl: async (temporary, target) => {
      calls.push([temporary, target])
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('rename denied'), { code: 'EPERM' })
      if (attempt === 2) throw Object.assign(new Error('rename busy'), { code: 'EBUSY' })
      return 'committed'
    },
    sleepImpl: async milliseconds => { sleeps.push(milliseconds) },
  })
  assert.equal(result, 'committed')
  assert.equal(calls.length, 3)
  assert.deepEqual(sleeps, [100, 250])
  assert.deepEqual(calls, [['temporary', 'target'], ['temporary', 'target'], ['temporary', 'target']])
})

test('Windows runtime directory commit makes exactly five attempts before rethrowing the original error', async () => {
  const failure = Object.assign(new Error('still locked'), { code: 'EACCES' })
  let calls = 0
  const sleeps = []
  await assert.rejects(
    commitRuntimeDirectory('temporary', 'target', {
      platform: 'win32',
      renameImpl: async () => {
        calls += 1
        throw failure
      },
      sleepImpl: async milliseconds => { sleeps.push(milliseconds) },
    }),
    error => error === failure,
  )
  assert.equal(calls, 5)
  assert.deepEqual(sleeps, [100, 250, 500, 1000])
})

test('runtime directory commit does not retry on non-Windows or for non-transient errors', async () => {
  for (const [platform, code] of [['linux', 'EPERM'], ['win32', 'ENOENT']]) {
    const failure = Object.assign(new Error(code), { code })
    let calls = 0
    const sleeps = []
    await assert.rejects(
      commitRuntimeDirectory('temporary', 'target', {
        platform,
        renameImpl: async () => {
          calls += 1
          throw failure
        },
        sleepImpl: async milliseconds => { sleeps.push(milliseconds) },
      }),
      error => error === failure,
    )
    assert.equal(calls, 1)
    assert.deepEqual(sleeps, [])
  }
})

test('default capsule compression preserves every payload byte and failed output removes its spool', async () => {
  const { parent, root, app } = await fixture()
  try {
    const before = path.join(root, 'before.dshpack')
    const after = path.join(root, 'after.dshpack')
    await createRuntimeCapsule(app, before, path.join(root, 'before.json'), { level: 10 })
    await createRuntimeCapsule(app, after, path.join(root, 'after.json'))
    assert.deepEqual(zstdDecompressSync(await readFile(before)), zstdDecompressSync(await readFile(after)))
    await createRuntimeCapsule(app, after, path.join(root, 'after.json'), { level: 22 })
    assert.deepEqual(zstdDecompressSync(await readFile(before)), zstdDecompressSync(await readFile(after)))
    const blocked = path.join(root, 'blocked.dshpack')
    await mkdir(blocked)
    await assert.rejects(createRuntimeCapsule(app, blocked, path.join(root, 'blocked.json')))
    await assert.rejects(stat(`${blocked}.${process.pid}.raw`), { code: 'ENOENT' })
    await assert.rejects(stat(path.join(root, 'blocked.json')), { code: 'ENOENT' })
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('runtime capsule extracts once, verifies its content, and follows a moved portable source', async () => {
  const { parent, root, app } = await fixture()
  const cache = path.join(parent, 'machine-cache')
  try {
    const capsule = path.join(root, 'runtime', 'DSH-App.dshpack')
    const manifest = path.join(root, 'runtime-capsule.json')
    await createRuntimeCapsule(app, capsule, manifest, { platform: process.platform, arch: process.arch, level: 1 })
    await rm(app, { recursive: true, force: true })

    const phases = []
    const first = await ensureRuntimeCapsule(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache }, onProgress: phase => phases.push(phase) })
    assert.ok(phases.indexOf('capsule-verified') < phases.indexOf('extract-files-progress'))
    assert.equal(phases.at(-1), 'cache-committed')
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

test('cache cleanup removes only unused old runtimes and never an active lease or current runtime', async t => {
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
    const deadPid = Number(execFileSync(process.execPath, ['-p', 'process.pid'], { encoding: 'utf8', windowsHide: true }).trim())
    const staleLease = path.join(cache, `${oldHash}.lease.${deadPid}.exited.json`)
    await writeFile(staleLease, JSON.stringify({ pid: deadPid, token: 'exited' }))
    const interruptedLease = path.join(cache, `${oldHash}.lease.${deadPid}.12345678-1234-1234-1234-123456789abc.json`)
    await writeFile(interruptedLease, '')
    const release = await acquireRuntimeLease(oldRuntime, { waitMs: 50 })

    const before = await runtimeCacheStatus(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(before.caches.find((entry) => entry.hash === oldHash)?.active, true)
    assert.equal(JSON.parse(await readFile(staleLease, 'utf8')).pid, deadPid, 'status must not remove stale leases')
    assert.equal(await readFile(interruptedLease, 'utf8'), '', 'status must not remove an interrupted lease')
    const actualStat = fsPromises.stat
    const mockedStat = t.mock.method(fsPromises, 'stat', async (filename, ...args) => {
      if (filename === path.join(oldRuntime, 'old-runtime.txt')) throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' })
      return actualStat(filename, ...args)
    })
    syncBuiltinESMExports()
    try {
      const partial = await runtimeCacheStatus(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
      assert.equal(partial.complete, false)
      assert.deepEqual(partial.errors, [{ directory: oldHash, code: 'EACCES' }])
      assert.equal(partial.caches.some(entry => entry.current), true, 'other caches still contribute to a partial report')
    } finally { mockedStat.mock.restore(); syncBuiltinESMExports() }
    const retained = await cleanUnusedRuntimeCaches(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.deepEqual(retained.removed, [])
    assert.equal(retained.retained.some((entry) => entry.hash === oldHash && entry.reason === 'active'), true)
    assert.equal(retained.retained.some((entry) => entry.hash === path.basename(current.runtimeRoot) && entry.reason === 'current'), true)
    await assert.rejects(stat(staleLease), { code: 'ENOENT' }, 'only cleanup reclaims exited leases')
    await assert.rejects(stat(interruptedLease), { code: 'ENOENT' }, 'cleanup can recover a killed lease writer from its owned filename')

    await release()
    const malformedLease = path.join(cache, `${oldHash}.lease.unknown.json`)
    await writeFile(malformedLease, '{')
    const uncertain = await runtimeCacheStatus(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(uncertain.caches.find(entry => entry.hash === oldHash)?.uncertainLease, true)
    assert.equal((await cleanUnusedRuntimeCaches(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })).removed.length, 0)
    assert.equal(await readFile(malformedLease, 'utf8'), '{', 'an unreadable lease does not prove its owner exited')
    await rm(malformedLease)
    const preparationLock = path.join(cache, `${oldHash}.lock`)
    await writeFile(preparationLock, JSON.stringify({ pid: process.pid, token: 'test-preparer' }))
    const preparing = await cleanUnusedRuntimeCaches(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(preparing.retained.some(entry => entry.hash === oldHash && entry.reason === 'preparing'), true)
    assert.equal(await readFile(path.join(oldRuntime, 'old-runtime.txt'), 'utf8'), 'old')
    await rm(preparationLock)
    const cleaned = await cleanUnusedRuntimeCaches(root, { env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache } })
    assert.equal(cleaned.removed.some((entry) => entry.hash === oldHash), true)
    await assert.rejects(stat(oldRuntime), { code: 'ENOENT' })
    assert.equal((await stat(current.runtimeRoot)).isDirectory(), true)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('cache cleanup reclaims abandoned extraction directories but preserves recent, live, unknown and linked entries', async () => {
  const { parent, root, app } = await fixture()
  const cache = path.join(parent, 'machine-cache')
  const env = { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache }
  try {
    await createRuntimeCapsule(app, path.join(root, 'runtime', 'DSH-App.dshpack'), path.join(root, 'runtime-capsule.json'), {
      platform: process.platform, arch: process.arch, level: 1,
    })
    const current = await ensureRuntimeCapsule(root, { env })
    const hash = path.basename(current.runtimeRoot)
    const deadPid = Number(execFileSync(process.execPath, ['-p', 'process.pid'], { encoding: 'utf8', windowsHide: true }).trim())
    const old = Date.now() - 2 * 86400000
    const abandoned = `.${hash}.${deadPid}.${old}`
    const preserved = [
      `.${hash}.${deadPid}.${Date.now()}`,
      `.${hash}.${process.pid}.${old}`,
      '.unrecognized-user-folder',
    ]
    for (const name of [abandoned, ...preserved]) {
      await mkdir(path.join(cache, name))
      await writeFile(path.join(cache, name, 'sentinel'), name)
    }
    const outside = path.join(parent, 'user-data')
    await mkdir(outside)
    await writeFile(path.join(outside, 'keep'), 'user data')
    const linked = path.join(cache, `.${'b'.repeat(64)}.${deadPid}.${old}`)
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')

    const status = await runtimeCacheStatus(root, { env })
    assert.equal(status.complete, true)
    assert.deepEqual(status.errors, [])
    assert.equal(status.caches.filter(entry => entry.incomplete).length, 3)
    assert.equal(status.caches.find(entry => entry.directory === abandoned)?.bytes, Buffer.byteLength(abandoned))
    assert.equal(status.bytes, status.caches.reduce((total, entry) => total + entry.bytes, 0))

    const result = await cleanUnusedRuntimeCaches(root, { env })
    assert.deepEqual(result.removed.map(entry => entry.directory), [abandoned])
    assert.equal(result.removed[0].incomplete, true)
    await assert.rejects(stat(path.join(cache, abandoned)), { code: 'ENOENT' })
    for (const name of preserved) assert.equal(await readFile(path.join(cache, name, 'sentinel'), 'utf8'), name)
    assert.equal(await readFile(path.join(linked, 'keep'), 'utf8'), 'user data')
    assert.equal((await stat(current.runtimeRoot)).isDirectory(), true)
    assert.deepEqual((await cleanUnusedRuntimeCaches(root, { env })).removed, [])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
