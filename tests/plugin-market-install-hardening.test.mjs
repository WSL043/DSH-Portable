import assert from 'node:assert/strict'
import test from 'node:test'

import { withHoistRecovery } from '../app/vendor/dsh-portable-plugin-market/src/install.ts'
import { pnpmNeverStarted } from '../app/vendor/dsh-portable-plugin-market/src/dsh-cli.ts'
import { downloadWebdav } from '../app/vendor/dsh-portable-plugin-market/src/backup.ts'

const failed = (overrides = {}) => ({
  exitCode: 1,
  timedOut: false,
  cancelled: false,
  stdout: '',
  stderr: '',
  ...overrides,
})

const validBackup = JSON.stringify({
  format: 'dsh-profile-backup',
  version: 0.2,
  profile: 'web',
  createdAt: '2026-09-06T00:00:00.000Z',
  files: [{ path: 'package.json', json: { dependencies: {} } }],
})

const response = (status, location, body = '') => ({
  status,
  body: Buffer.from(body),
  ...(location === undefined ? {} : { location }),
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

test('download follows a same-origin redirect while preserving auth and resolving relative Location', async () => {
  const calls = []
  const queued = [
    response(301, '/moved/backup.json'),
    response(200, undefined, validBackup),
  ]
  const request = async (url, username, password, method) => {
    calls.push({ url, username, password, method })
    return queued.shift()
  }

  assert.deepEqual(
    await downloadWebdav('https://93.184.216.34/backup.json', 'user', 'secret', request),
    JSON.parse(validBackup),
  )
  assert.deepEqual(calls, [
    { url: 'https://93.184.216.34/backup.json', username: 'user', password: 'secret', method: 'GET' },
    { url: 'https://93.184.216.34/moved/backup.json', username: 'user', password: 'secret', method: 'GET' },
  ])
})

test('download drops auth on a cross-origin redirect', async () => {
  const calls = []
  const queued = [
    response(302, 'https://93.184.216.35/signed/backup.json?sig=abc'),
    response(200, undefined, validBackup),
  ]
  const request = async (url, username, password, method) => {
    calls.push({ url, username, password, method })
    return queued.shift()
  }

  await downloadWebdav('https://93.184.216.34/backup.json', 'user', 'secret', request)
  assert.equal(calls[0].username, 'user')
  assert.equal(calls[0].password, 'secret')
  assert.equal(calls[1].username, '')
  assert.equal(calls[1].password, '')
  assert.equal(calls[1].url, 'https://93.184.216.35/signed/backup.json?sig=abc')
})

test('download never reattaches auth after crossing origins across multiple hops', async () => {
  const calls = []
  const queued = [
    response(302, 'https://93.184.216.35/cdn/start'),
    response(307, '/cdn/final'),
    response(302, 'https://93.184.216.34/back'),
    response(200, undefined, validBackup),
  ]
  await downloadWebdav('https://93.184.216.34/backup.json', 'user', 'secret', async (url, username, password) => {
    calls.push({ url, username, password })
    return queued.shift()
  })
  assert.equal(calls[0].password, 'secret')
  assert.equal(calls.length, 4)
  for (const call of calls.slice(1)) {
    assert.equal(call.username, '')
    assert.equal(call.password, '')
  }
})

test('download re-runs the SSRF gate for a redirect to a private target', async () => {
  let calls = 0
  const request = async () => {
    calls += 1
    return response(302, 'https://127.0.0.1/private-backup.json')
  }

  await assert.rejects(
    downloadWebdav('https://93.184.216.34/backup.json', 'user', 'secret', request),
    /invalid WebDAV URL/,
  )
  assert.equal(calls, 1)
})

test('download stops after a bounded redirect loop', async () => {
  let calls = 0
  const request = async (url) => {
    calls += 1
    return response(302, url)
  }

  await assert.rejects(
    downloadWebdav('https://93.184.216.34/backup.json', 'user', 'secret', request),
    /HTTP 302/,
  )
  assert.equal(calls, 6)
})
