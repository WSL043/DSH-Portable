import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { acquirePluginLock, processExists } from '../launcher/dsh-cli.mjs'

test('Windows EPERM is disambiguated without deleting a live process lock', () => {
  const pid = 31412
  const kill = () => {
    const error = new Error('access denied')
    error.code = 'EPERM'
    throw error
  }
  assert.equal(processExists(pid, 'win32', {
    kill,
    spawnSync: () => ({ status: 0, stdout: `"node.exe","${pid}","Console","1","20,000 K"\r\n` }),
  }), true)
  assert.equal(processExists(pid, 'win32', {
    kill,
    spawnSync: () => ({ status: 0, stdout: 'INFO: No tasks are running which match the specified criteria.\r\n' }),
  }), false)
  assert.equal(processExists(pid, 'win32', {
    kill,
    spawnSync: () => ({ status: 1, stdout: '', error: new Error('tasklist unavailable') }),
  }), true, 'an unavailable verifier must fail closed')
})

test('a stale Windows plugin lock is reclaimed, released, and can be acquired again', { skip: process.platform !== 'win32' }, async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-lock-stale-'))
  const lock = path.join(stateDir, 'plugin-command.lock')
  const exited = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true })
  await new Promise((resolve, reject) => {
    exited.once('exit', resolve)
    exited.once('error', reject)
  })
  try {
    await writeFile(lock, `${exited.pid}\n`)
    const release = await acquirePluginLock({ stateDir, platform: 'win32' })
    assert.equal((await readFile(lock, 'utf8')).trim(), String(process.pid))
    await release()
    const releaseAgain = await acquirePluginLock({ stateDir, platform: 'win32' })
    await releaseAgain()
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('a real live Windows plugin lock is preserved and rejected', { skip: process.platform !== 'win32' }, async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-lock-live-'))
  const lock = path.join(stateDir, 'plugin-command.lock')
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true })
  try {
    await writeFile(lock, `${child.pid}\n`)
    await assert.rejects(
      acquirePluginLock({ stateDir, platform: 'win32' }),
      /Another DSH plugin command is already running/,
    )
    assert.equal((await readFile(lock, 'utf8')).trim(), String(child.pid))
  } finally {
    child.kill()
    await rm(stateDir, { recursive: true, force: true })
  }
})
