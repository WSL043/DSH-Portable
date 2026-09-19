import assert from 'node:assert/strict'
import test from 'node:test'

import { withHoistRecovery } from '../app/vendor/dsh-portable-plugin-market/src/install.ts'
import { pnpmNeverStarted } from '../app/vendor/dsh-portable-plugin-market/src/dsh-cli.ts'

const failed = (overrides = {}) => ({
  exitCode: 1,
  timedOut: false,
  cancelled: false,
  stdout: '',
  stderr: '',
  ...overrides,
})

test('withHoistRecovery uses exit 9009 and replaces unusable pnpm output', async () => {
  const calls = []
  const run = async (_profile, args) => {
    calls.push(args)
    if (args[0] === 'store') return failed({ exitCode: 1 })
    return failed({
      exitCode: 9009,
      stdout: 'launcher wrapper output',
      stderr: 'launcher failed before pnpm started',
    })
  }

  const result = await withHoistRecovery(run, 'web', ['add', 'demo'])

  assert.equal(result.exitCode, 9009)
  assert.equal(result.stdout, '')
  assert.equal(result.pnpmNeverStarted, true)
  assert.equal(pnpmNeverStarted(result), true)
  assert.match(result.stderr, /Portable.*pnpm.*9009/s)
  assert.match(result.stderr, /检查并修复/)
  assert.deepEqual(calls, [['add', 'demo']])
})

test('withHoistRecovery preserves the structured fact for raw spawn EACCES without cleanup', async () => {
  let calls = 0
  const result = await withHoistRecovery(async () => {
    calls += 1
    return failed({
      exitCode: 1,
      stderr: 'Error: spawnSync pnpm EACCES\n  syscall: spawnSync pnpm',
    })
  }, 'web', ['add', 'demo'])

  assert.equal(calls, 1)
  assert.equal(result.pnpmNeverStarted, true)
  assert.equal(pnpmNeverStarted(result), true)
})

test('a retry launcher failure is not reported as an untouched operation', async () => {
  const calls = []
  const run = async (_profile, args) => {
    calls.push(args)
    if (args[0] === 'store') return failed({ stderr: 'store lookup unavailable' })
    if (calls.length === 1) return failed({ stderr: 'ERR_PNPM_FETCH_503 GET https://registry.npmjs.org/demo' })
    return failed({ stderr: 'Error: spawnSync pnpm EACCES\n  syscall: spawnSync pnpm' })
  }

  const result = await withHoistRecovery(run, 'web', ['add', 'demo'])

  assert.equal(result.pnpmNeverStarted, false)
  assert.equal(pnpmNeverStarted(result), false)
  assert.match(result.stderr, /EACCES/)
  assert.doesNotMatch(result.stderr, /nothing was changed|没有任何改动/)
  assert.deepEqual(calls, [['add', 'demo'], ['add', 'demo'], ['store', 'path']])
})

test('ordinary pnpm failures still run store cleanup and remain started', async () => {
  const calls = []
  const run = async (_profile, args) => {
    calls.push(args)
    if (args[0] === 'store') return failed({ stdout: '' })
    return failed({ stderr: 'ordinary failure' })
  }

  const result = await withHoistRecovery(run, 'web', ['add', 'demo'])

  assert.equal(pnpmNeverStarted(result), false)
  assert.deepEqual(calls, [['add', 'demo'], ['store', 'path']])
})

