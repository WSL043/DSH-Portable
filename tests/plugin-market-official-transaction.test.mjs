import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm, open, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOfficialTransactionRuntime } from '../app/vendor/dsh-portable-plugin-market/src/official-transaction.ts'
import { profileRevision } from '../app/vendor/dsh-portable-plugin-market/src/profile-revision.ts'

async function fixture(t, run) {
  const dir = await mkdtemp(join(tmpdir(), 'market-transaction-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'package.json')
  await writeFile(file, '{"name":"fixture","private":true}')
  const profile = { name: 'web', dir, cwd: dir, installAnchor: file }
  const withFileLock = async (file, fn) => {
    const handle = await open(file + '.lock', 'wx')
    try { return await fn() } finally { await handle.close(); await unlink(file + '.lock') }
  }
  const host = { get: key => key === 'profileContext' ? profile : { listPlugins() {}, setPluginEnabled() {} } }
  const runtime = createOfficialTransactionRuntime(host, dir, async () => ({ withFileLock, runProfilePnpm: run }))
  t.after(() => runtime.dispose())
  return { dir, file, profile, runtime, withFileLock }
}

test('one lock protects snapshot, package write, validation and rollback from competing writers', async t => {
  let bed
  bed = await fixture(t, async () => {
    await assert.rejects(bed.withFileLock(bed.file, async () => {}), { code: 'EEXIST' })
    await writeFile(bed.file, '{"changed":true}')
    return { exitCode: 0 }
  })
  const before = await readFile(bed.file, 'utf8')
  await bed.runtime.withMutation(async () => {
    assert.equal(await readFile(bed.file, 'utf8'), before)
    assert.equal((await bed.runtime.runPlugin('web', ['install'])).exitCode, 0)
    // pnpm has finished, but post-install validation and recovery still own the lock.
    await assert.rejects(bed.withFileLock(bed.file, async () => {}), { code: 'EEXIST' })
    await writeFile(bed.file, before)
    await assert.rejects(bed.runtime.withMutation(async () => {}), { code: 'PROFILE_BUSY' })
  })
  await bed.withFileLock(bed.file, async () => { await writeFile(bed.file, 'newer operation') })
  assert.equal(await readFile(bed.file, 'utf8'), 'newer operation')
})

test('context mismatch and commands outside a transaction fail closed; callback failures release lock', async t => {
  let calls = 0
  const bed = await fixture(t, async () => { calls++; return { exitCode: 0 } })
  assert.match((await bed.runtime.runPlugin('web', ['install'])).stderr, /lock is required/)
  await assert.rejects(bed.runtime.withMutation(async () => { throw Error('validation failure') }), /validation failure/)
  await bed.withFileLock(bed.file, async () => {})
  bed.profile.dir = join(bed.dir, 'different')
  await assert.rejects(bed.runtime.withMutation(async () => {}), /does not match/)
  assert.equal(calls, 0)
})

test('an inherited async context cannot launch a command after its lock was released', async t => {
  let calls = 0, release, delayed
  const gate = new Promise(resolve => { release = resolve })
  const bed = await fixture(t, async () => { calls++; return { exitCode: 0 } })
  await bed.runtime.withMutation(async () => { delayed = gate.then(() => bed.runtime.runPlugin('web', ['install'])) })
  release()
  assert.match((await delayed).stderr, /lock is required/)
  assert.equal(calls, 0)
})

test('cancellation keeps the profile locked until the operation has settled', async t => {
  let started, finish
  const ready = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { finish = resolve })
  const bed = await fixture(t, async (_context, _args, options) => {
    started(options.signal)
    await gate
    assert.equal(options.signal.aborted, true)
    throw Error('cancelled')
  })
  const work = bed.runtime.withMutation(() => bed.runtime.runPlugin('web', ['install']))
  const signal = await ready
  bed.runtime.cancelActive()
  assert.equal(signal.aborted, true)
  await assert.rejects(bed.withFileLock(bed.file, async () => {}), { code: 'EEXIST' })
  finish()
  assert.equal((await work).cancelled, true)
  await bed.withFileLock(bed.file, async () => {})
})

test('rollback revision detects external manifest, lockfile and configuration changes', async t => {
  const bed = await fixture(t, async () => ({ exitCode: 0 }))
  const before = profileRevision(bed.dir)
  await writeFile(join(bed.dir, 'pnpm-lock.yaml'), 'new lock')
  assert.notEqual(profileRevision(bed.dir), before)
  await unlink(join(bed.dir, 'pnpm-lock.yaml'))
  assert.equal(profileRevision(bed.dir), before)
  await writeFile(join(bed.dir, 'cordis.patch.yml'), 'new config')
  assert.notEqual(profileRevision(bed.dir), before)
})

test('filesystem permission errors are not mislabeled as another running operation', async t => {
  const bed = await fixture(t, async () => ({ exitCode: 0 }))
  const failure = Object.assign(Error('access denied'), { code: 'EACCES' })
  const runtime = createOfficialTransactionRuntime({ get: key => key === 'profileContext' ? bed.profile : { listPlugins() {}, setPluginEnabled() {} } }, bed.dir,
    async () => ({ withFileLock: async () => { throw failure }, runProfilePnpm: async () => ({ exitCode: 0 }) }))
  t.after(() => runtime.dispose())
  await assert.rejects(runtime.withMutation(async () => {}), error => error === failure)
})

test('package runner diagnostics remain visible when process creation fails', async t => {
  const bed = await fixture(t, async () => ({ exitCode: 127, output: 'pnpm executable missing' }))
  const result = await bed.runtime.withMutation(() => bed.runtime.runPlugin('web', ['install']))
  assert.equal(result.exitCode, 127)
  assert.match(result.stderr, /pnpm executable missing/)
})
