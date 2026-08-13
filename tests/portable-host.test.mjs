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

test('portable host authenticates shutdown and invokes the official signal path', { skip: process.platform !== 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-'))
  const marker = path.join(temp, 'disposed.txt')
  const fakeDsh = path.join(temp, 'fake-dsh.mjs')
  await writeFile(fakeDsh, [
    "import { writeFileSync } from 'node:fs'",
    "process.on('SIGTERM', () => { writeFileSync(process.env.DSH_TEST_MARKER, 'graceful'); process.exit(0) })",
    'setInterval(() => {}, 1000)',
  ].join('\n'))

  const pipe = `\\\\.\\pipe\\dsh-portable-test-${process.pid}-${randomUUID()}`
  const token = randomUUID()
  const child = spawn(process.execPath, [host, fakeDsh], {
    env: {
      ...process.env,
      DSH_PORTABLE_CONTROL_PIPE: pipe,
      DSH_PORTABLE_CONTROL_TOKEN: token,
      DSH_TEST_MARKER: marker,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  t.after(() => child.kill())
  await waitForPipe(pipe)

  assert.equal(await request(pipe, 'wrong-token'), 401)
  assert.equal(child.exitCode, null)
  assert.equal(await request(pipe, token), 202)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('portable host did not exit')), 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
  assert.equal(await readFile(marker, 'utf8'), 'graceful')
})
