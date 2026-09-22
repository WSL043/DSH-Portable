import test from 'node:test'
import assert from 'node:assert/strict'
import { runWithReleaseAgeRecovery, installOfficialPnpmRecovery } from '../desktop-bridge/lib/pnpm-service.mjs'

const violation = { exitCode: 1, output: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION existing@1.0.0', signal: null }
for (const command of ['add', 'install', 'remove', 'rm', 'uninstall', 'update', 'up']) {
  test(`official ${command} recovers a lockfile age failure once`, async () => {
    const calls = []
    const result = await runWithReleaseAgeRecovery([command, 'fixture'], async args => {
      calls.push(args)
      return calls.length === 1 ? violation : { exitCode: 0, output: 'ok', signal: null }
    })
    assert.equal(result.exitCode, 0)
    assert.deepEqual(calls, [[command, 'fixture'], [command, '--config.minimumReleaseAge=0', 'fixture']])
  })
}
test('fresh target refusal, cancellation, explicit override and unrelated failures never retry', async () => {
  for (const item of [
    { args: ['add', 'fixture'], output: 'ERR_PNPM_NO_MATURE_MATCHING_VERSION', cancelled: false },
    { args: ['remove', 'fixture'], output: violation.output, cancelled: true },
    { args: ['remove', '--config.minimumReleaseAge=0', 'fixture'], output: violation.output },
    { args: ['view', 'fixture'], output: violation.output },
    { args: ['add', 'fixture'], output: 'ERR_PNPM_FETCH_404' },
  ]) {
    let calls = 0
    await runWithReleaseAgeRecovery(item.args, async () => { calls++; return { exitCode: 1, output: item.output } }, () => !!item.cancelled)
    assert.equal(calls, 1)
  }
})
test('failed retry remains failed and is not looped', async () => {
  let calls = 0
  assert.equal((await runWithReleaseAgeRecovery(['remove', 'fixture'], async () => { calls++; return violation })).exitCode, 1)
  assert.equal(calls, 2)
})

test('host adapter preserves receiver, signal, request identity and restores only its own hook', async () => {
  const signal = new AbortController().signal
  const calls = []
  const manager = { async runPnpm(...args) {
    assert.equal(this, manager); calls.push(args)
    return calls.length === 1 ? violation : { exitCode: 0, output: '' }
  } }
  const original = manager.runPnpm
  const dispose = installOfficialPnpmRecovery(manager)
  assert.equal((await manager.runPnpm(['remove', 'fixture'], signal, 'request-1')).exitCode, 0)
  for (const call of calls) { assert.equal(call[1], signal); assert.equal(call[2], 'request-1') }
  dispose(); assert.equal(manager.runPnpm, original)
  const secondDispose = installOfficialPnpmRecovery(manager)
  const replacement = () => {}; manager.runPnpm = replacement
  secondDispose(); assert.equal(manager.runPnpm, replacement)
  assert.equal(installOfficialPnpmRecovery({}), undefined)
})

test('host cancellation suppresses recovery after the first operation settles', async () => {
  const abort = new AbortController(); let calls = 0
  const manager = { abort, async runPnpm() { calls++; abort.abort(); return violation } }
  const dispose = installOfficialPnpmRecovery(manager)
  await manager.runPnpm(['remove', 'fixture'])
  assert.equal(calls, 1); dispose()
})
