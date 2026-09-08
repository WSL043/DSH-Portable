import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = path.join(root, 'launcher', 'portable-host.mjs')

test('a failed official import retains a failed startup profile', { skip: process.platform !== 'win32' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-failed-'))
  const entry = path.join(temp, 'failed-entry.mjs')
  await writeFile(entry, 'throw new Error("injected import failure")\n')
  const child = spawn(process.execPath, [host, entry], {
    env: { ...process.env, DSH_PORTABLE_CONTROL_PIPE: `\\\\.\\pipe\\dsh-failed-${randomUUID()}`,
      DSH_PORTABLE_CONTROL_TOKEN: randomUUID(), DSH_PORTABLE_STATE_ROOT: temp,
      DSH_PORTABLE_STARTUP_ID: 'd'.repeat(32), DSH_PORTABLE_STARTUP_STARTED_AT: String(Date.now()) },
    stdio: 'ignore', windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('failed host did not exit')) }, 10000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); resolve(code) })
  })
  assert.notEqual(code, 0)
  const history = path.join(temp, 'data/logs/history', 'd'.repeat(32))
  const health = (await readFile(path.join(history, 'runtime-health.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.ok(health.some(row => row.observation === 'startup-profile' && row.reason === 'startup-failed'))
  assert.match(await readFile(path.join(history, 'startup.jsonl'), 'utf8'), /official-dsh-import-failed/)
})

function request(pipe, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: pipe,
      path: '/shutdown',
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }, (res) => {
      res.resume()
      res.once('end', () => resolve(res.statusCode))
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitForPipe(pipe) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      await request(pipe, 'probe')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error('portable host control pipe did not open')
}

for (const entryMode of ['legacy', 'exported']) test(`portable host starts the ${entryMode} CLI once and authenticates graceful shutdown`, { skip: process.platform !== 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-'))
  const marker = path.join(temp, 'disposed.txt')
  const bootMarker = path.join(temp, 'started.txt')
  const fakeDsh = path.join(temp, 'fake-dsh.mjs')
  const body = [
    "writeFileSync(process.env.DSH_TEST_BOOT, 'started', { flag: 'wx' })",
    "process.on('SIGTERM', () => { writeFileSync(process.env.DSH_TEST_MARKER, 'graceful'); process.exit(0) })",
    'setInterval(() => {}, 1000)',
  ].join('\n')
  await writeFile(fakeDsh, "import { writeFileSync } from 'node:fs'\n" +
    (entryMode === 'exported' ? `export async function runCli() {\n${body}\n}` : body))

  const pipe = `\\\\.\\pipe\\dsh-portable-test-${process.pid}-${randomUUID()}`
  const token = randomUUID()
  const child = spawn(process.execPath, [host, fakeDsh], {
    env: {
      ...process.env,
      DSH_PORTABLE_CONTROL_PIPE: pipe,
      DSH_PORTABLE_CONTROL_TOKEN: token,
      DSH_TEST_MARKER: marker,
      DSH_TEST_BOOT: bootMarker,
      DSH_PORTABLE_STATE_ROOT: temp,
      DSH_PORTABLE_STARTUP_ID: 'b'.repeat(32),
      DSH_PORTABLE_STARTUP_STARTED_AT: String(Date.now()),
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  t.after(() => child.kill())
  await waitForPipe(pipe)
  const traceFile = path.join(temp, 'data', 'logs', 'startup-latest.jsonl')
  const importDeadline = Date.now() + 5000
  while (Date.now() < importDeadline) {
    const source = await readFile(traceFile, 'utf8').catch(() => '')
    if (source.includes('official-dsh-import-complete')) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.match(await readFile(traceFile, 'utf8'), /official-dsh-import-complete/)
  assert.equal(await readFile(bootMarker, 'utf8'), 'started')

  assert.equal(await request(pipe, 'wrong-token'), 401)
  assert.equal(child.exitCode, null)
  assert.equal(await request(pipe, token), 202)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('portable host did not exit')), 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
  assert.equal(await readFile(marker, 'utf8'), 'graceful')
  const events = (await readFile(traceFile, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.ok(events.every(event => event.startupId === 'b'.repeat(32) && event.pid === child.pid))
  assert.ok(events.some(event => event.phase === 'shutdown-accepted'))
  assert.ok(events.some(event => event.phase === 'process-exit' && event.exitCode === 0))
})
