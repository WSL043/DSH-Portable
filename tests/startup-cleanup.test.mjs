import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const sourceSelector = process.env.DSH_TEST_CLI_SOURCE
const cli = sourceSelector?.startsWith('git:')
  ? execFileSync('git', ['show', sourceSelector.slice(4)], { encoding: 'utf8' })
  : await readFile(sourceSelector || new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
const startSource = cli.slice(cli.indexOf('async function startAttempt('), cli.indexOf('\nasync function stop()'))

function fixture({ owned = true, details = 'host failed', cleanupError = null, queryError = null } = {}) {
  const calls = []
  const phases = []
  const removed = []
  let writtenState = null
  const context = {
    path,
    layout: {
      logsDir: 'logs', processState: 'state', repairRequest: 'repair-request', workspace: 'workspace',
      nodeExe: 'node', hostBin: 'host', dshBin: 'dsh', desktopBridgePatch: 'patch', root: 'root', environmentId: 'default',
    },
    requireRuntime() {}, ensurePortableDirectories: async () => {}, retirePendingExtensionOperation: async () => {},
    existsSync: () => false, ensureDesktopBridgeFallback: async () => false,
    ensureManagedProfileModuleFallback: async () => ({}), migratePortableRoot: async () => ({}),
    readProcessState: () => null,
    ownedState: state => { if (state?.pid === 123 && queryError) throw queryError; return Boolean(state?.pid === 123 && owned) },
    seedDefaultPlugins: async () => ({ status: 'unchanged' }),
    repairIncompleteProfileDependencies: async () => ({ profiles: [] }),
    reservePort: async () => ({ port: 3080, release() {} }), logSize: () => 0,
    openSync: () => 1, writeSync() {}, closeSync() {}, startupTrace: null,
    process: { platform: 'win32', env: {} }, randomUUID: () => 'fixture',
    randomBytes: () => ({ toString: () => 'fixture' }),
    spawn: () => ({ pid: 123, unref() {} }), buildDshEnv: () => ({}),
    writeJsonAtomic: async (_filename, state) => { writtenState = state },
    waitForHost: async () => null, tailSince: () => details,
    startupLog: (_startedAt, phase) => phases.push(phase),
    rmSync: filename => removed.push(filename),
    stop: async () => { calls.push('stop'); if (cleanupError) throw cleanupError },
    start: async () => { calls.push('retry'); return { status: 'retried' } },
    openBrowser: async () => null,
    PORT_RANGE: { first: 3080, last: 3090 },
    execFileSync: () => { calls.push('kill'); throw new Error('kill failed') },
  }
  return {
    startAttempt: vm.runInNewContext(`(${startSource})`, context),
    calls, phases, removed, get writtenState() { return writtenState },
  }
}

async function rejected(promise) {
  let error
  try { await promise } catch (caught) { error = caught }
  assert.ok(error, 'startup attempt must reject')
  return error
}

test('failed startup cleanup preserves state and both errors without retry', async () => {
  const probe = fixture({ details: 'EADDRINUSE: address already in use', cleanupError: new Error('cleanup failed') })
  const error = await rejected(probe.startAttempt(true, 0, 0))
  assert.match(error.message, /DeepSeek Harness failed to start/)
  assert.match(error.message, /Startup cleanup failed/)
  assert.match(error.message, /cleanup failed/)
  assert.equal(probe.writtenState.pid, 123)
  assert.deepEqual(probe.removed, [])
  assert.deepEqual(probe.calls, ['stop'])
  assert.ok(probe.phases.includes('host-cleanup-failed'))
  assert.equal(probe.phases.includes('host-cleanup-complete'), false)
  assert.equal(probe.calls.includes('retry'), false)
})

test('EADDRINUSE retries only after successful stop cleanup', async () => {
  const probe = fixture({ details: 'EADDRINUSE: address already in use' })
  const result = await probe.startAttempt(true, 0, 0)
  assert.deepEqual(result, { status: 'retried' })
  assert.deepEqual(probe.calls, ['stop', 'retry'])
  assert.deepEqual(probe.removed, [])
  assert.ok(probe.phases.includes('host-cleanup-complete'))
  assert.ok(probe.phases.includes('port-conflict-retry'))
  assert.equal(probe.phases.includes('host-cleanup-failed'), false)
})

test('unavailable process query preserves startup state and records failed cleanup', async () => {
  const probe = fixture({ details: 'EADDRINUSE', queryError: new Error('process query unavailable') })
  const error = await rejected(probe.startAttempt(true, 0, 0))
  assert.match(error.message, /DeepSeek Harness failed to start/)
  assert.match(error.message, /process query unavailable/)
  assert.deepEqual(probe.removed, [])
  assert.deepEqual(probe.calls, [])
  assert.ok(probe.phases.includes('host-cleanup-failed'))
  assert.equal(probe.phases.includes('host-cleanup-complete'), false)
})

test('ordinary startup timeout reports failure after cleanup without retry', async () => {
  const probe = fixture()
  const error = await rejected(probe.startAttempt(true, 0, 0))
  assert.match(error.message, /DeepSeek Harness failed to start/)
  assert.deepEqual(probe.calls, ['stop'])
  assert.deepEqual(probe.removed, [])
  assert.ok(probe.phases.includes('host-cleanup-complete'))
  assert.equal(probe.calls.includes('retry'), false)
})

test('non-owned exited or changed-identity hosts remove state without stop', async () => {
  for (const identity of ['exited', 'changed-identity']) {
    const probe = fixture({ owned: false, details: `${identity} host` })
    const error = await rejected(probe.startAttempt(true, 0, 0))
    assert.match(error.message, /DeepSeek Harness failed to start/)
    assert.deepEqual(probe.calls, [])
    assert.deepEqual(probe.removed, ['state'])
    assert.ok(probe.phases.includes('host-cleanup-complete'), identity)
    assert.equal(probe.phases.includes('host-cleanup-failed'), false, identity)
  }
})
