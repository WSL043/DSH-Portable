import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
if (process.platform !== 'win32' || !process.argv[2]) throw new Error('usage: node smoke-windows-runtime-health.mjs <isolated Windows product>')
const root = path.resolve(process.argv[2])
const executable = path.join(root, 'DeepSeek-Herness.exe')
const logDirectory = path.join(root, 'data', 'logs')
async function cli(...args) {
  const { stdout } = await execute(path.join(root, 'runtime', 'node', 'node.exe'), [
    path.join(root, 'launcher', 'runtime-entry.mjs'), 'portable-cli.mjs', ...args, '--json',
  ], { windowsHide: true, timeout: 90000 })
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1))
}
async function entries(name) {
  try { return (await readFile(path.join(logDirectory, name), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return []; throw error }
}
assert.equal((await cli('status')).status, 'stopped')
const desktop = spawn(executable, ['--desktop'], {
  cwd: root, windowsHide: true, stdio: 'ignore',
  env: { ...process.env, DSH_PORTABLE_TEST_HIDDEN: '1', DSH_PORTABLE_TEST_UI_STALL: '1' },
})
let desktopExit
desktop.once('exit', code => { desktopExit = code })
try {
  const deadline = Date.now() + 120000
  let native = []
  while (Date.now() < deadline) {
    native = (await entries('desktop-health.jsonl')).filter(entry => entry.pid === desktop.pid)
    if (native.some(entry => entry.observation === 'ui-heartbeat-recovered')) break
    assert.equal(desktopExit, undefined, 'desktop exited before recording stall recovery')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(native.some(entry => entry.observation === 'ui-heartbeat-delayed' && entry.uiHeartbeatAgeMs >= 5000))
  assert.ok(native.some(entry => entry.observation === 'ui-heartbeat-recovered'))
  const running = await cli('status')
  assert.equal(running.status, 'running')
  const backend = (await entries('runtime-health.jsonl')).filter(entry => entry.pid === running.pid)
  assert.ok(backend.length > 0)
  assert.ok(backend.every(entry => entry.startupId === native[0].startupId))
  assert.ok(backend.every(entry => entry.mainHeartbeatAgeMs < 5000), 'native UI injection must not freeze the DSH event loop')
  const output = path.join(root, 'data', 'health-evidence.json')
  await cli('support-report', '--output', output)
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.match(report.logs['desktop-health.jsonl'], /ui-heartbeat-delayed/)
  assert.match(report.logs['desktop-health.jsonl'], /ui-heartbeat-recovered/)
  assert.match(report.logs['runtime-health.jsonl'], /mainHeartbeatAgeMs/)
  await execute(executable, ['stop', '--no-browser', '--json'], { windowsHide: true, timeout: 60000 })
  const exitDeadline = Date.now() + 15000
  while (desktopExit === undefined && Date.now() < exitDeadline) await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(desktopExit, 0)
  assert.equal((await cli('status')).status, 'stopped')
  assert.throws(() => process.kill(running.pid, 0), { code: 'ESRCH' })
  console.log(JSON.stringify({ status: 'passed', nativeStallCaptured: true, recoveryCaptured: true, backendResponsive: true, reportCorrelated: true, cleanExit: true }))
} finally {
  await execute(executable, ['stop', '--no-browser', '--json'], { windowsHide: true, timeout: 60000 }).catch(() => {})
}
