import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runImportCommand } from '../launcher/data-import-worker.mjs'

test('dependency worker cannot launch a command before its durable registration succeeds', async () => {
  let pid
  await assert.rejects(runImportCommand(process.execPath, ['-e', 'process.exit(0)'], { timeout: 2000 }, async value => {
    pid = value
    throw Object.assign(new Error('journal cannot be written'), { code: 'ENOSPC' })
  }), { code: 'ENOSPC' })
  assert.ok(Number.isSafeInteger(pid))
})

test('dependency worker returns bounded command output after exiting', async () => {
  const result = await runImportCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000));process.stderr.write("warning")'],
    { timeout: 3000, maxBuffer: 1024 }, async () => {})
  assert.equal(result.stdout, 'x'.repeat(1024))
  assert.equal(result.stderr, 'warning')
})

test('dependency worker retains command failure diagnostics', async () => {
  await assert.rejects(runImportCommand(process.execPath, ['-e', 'process.stderr.write("fixture failure");process.exit(23)'],
    { timeout: 3000 }, async () => {}), error => error.code === 23 && error.stderr === 'fixture failure')
})

test('dependency timeout ends the spawned process tree before releasing the worker', async () => {
  let descendant
  const script = 'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true});console.log(c.pid);setInterval(()=>{},1000)'
  await assert.rejects(runImportCommand(process.execPath, ['-e', script], { timeout: 800 }, async () => {}), error => {
    descendant = Number(error.stdout.trim())
    return error.code === 'ETIMEDOUT'
  })
  assert.ok(Number.isSafeInteger(descendant) && descendant > 0)
  if (process.platform === 'win32') assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' })
  else {
    // A killed orphan may briefly remain as an init-owned zombie, but must no
    // longer be able to execute or modify the profile.
    const state = await promisify(execFile)('ps', ['-o', 'stat=', '-p', String(descendant)], { windowsHide: true })
      .catch(error => { assert.equal(error.code, 1); return { stdout: '' } })
    assert.ok(!state.stdout.trim() || /^Z/.test(state.stdout.trim()), `dependency descendant remains runnable: ${state.stdout}`)
  }
})
