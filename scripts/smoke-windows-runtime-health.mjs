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
const output = path.join(root, 'data', 'health-evidence.json')
let evidenceWritten = false
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
let backendProbeCompletedAt = 0
desktop.once('exit', code => { desktopExit = code })
try {
  const deadline = Date.now() + 120000
  let native = []
  while (Date.now() < deadline) {
    native = (await entries('desktop-health.jsonl')).filter(entry => entry.pid === desktop.pid)
    if (!backendProbeCompletedAt && native.some(entry => entry.observation === 'ui-heartbeat-delayed')) {
      const state = JSON.parse(await readFile(path.join(root, 'data', 'runtime', 'process.json'), 'utf8'))
      // The desktop already consumed the one-time login URL. Probe the server's
      // unauthenticated handler without replaying that credential.
      const response = await fetch(new URL(state.url).origin, { signal: AbortSignal.timeout(2000), redirect: 'manual' })
      assert.equal(response.status, 401, 'DSH must answer the unauthenticated request while the native UI is stalled')
      await response.arrayBuffer()
      backendProbeCompletedAt = Date.now()
    }
    if (native.some(entry => entry.observation === 'ui-heartbeat-recovered')) break
    assert.equal(desktopExit, undefined, 'desktop exited before recording stall recovery')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(native.some(entry => entry.observation === 'ui-heartbeat-delayed' && entry.uiHeartbeatAgeMs >= 5000))
  assert.ok(native.some(entry => entry.observation === 'ui-heartbeat-recovered'))
  const launcherLog = await readFile(path.join(logDirectory, 'launcher.log'), 'utf8')
  const ended = launcherLog.split(/\r?\n/).find(line => line.includes('[health-test] ui-stall-end') && line.includes(native[0].startupId))
  assert.ok(backendProbeCompletedAt > 0 && backendProbeCompletedAt <= Date.parse(ended?.split(' ')[0]), 'the HTTP probe must complete before the native stall ends')
  const running = await cli('status')
  assert.equal(running.status, 'running')
  const backend = (await entries('runtime-health.jsonl')).filter(entry => entry.pid === running.pid)
  assert.ok(backend.length > 0)
  assert.ok(backend.every(entry => entry.startupId === native[0].startupId))
  const heartbeats = backend.filter(entry => ['sample', 'main-heartbeat-delayed', 'main-heartbeat-recovered'].includes(entry.observation))
  assert.ok(heartbeats.length > 0, 'the health worker must produce actual heartbeat samples')
  assert.ok(heartbeats.every(entry => Number.isFinite(entry.mainHeartbeatAgeMs) && entry.mainHeartbeatAgeMs >= 0 && entry.mainHeartbeatAgeMs < 5000),
    'native UI injection must not freeze the DSH event loop')
  await cli('support-report', '--output', output)
  evidenceWritten = true
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
  console.log(JSON.stringify({ status: 'passed', nativeStallCaptured: true, recoveryCaptured: true, backendResponsive: true, backendHttpStatus: 401, reportCorrelated: true, cleanExit: true,
    backendHeartbeatSamples: heartbeats.length, maxBackendHeartbeatAgeMs: Math.max(...heartbeats.map(entry => entry.mainHeartbeatAgeMs)) }))
} finally {
  if (!evidenceWritten) await cli('support-report', '--output', output).catch(error => {
    console.error(`Health evidence export failed: ${error.code || error.name}`)
  })
  await execute(executable, ['stop', '--no-browser', '--json'], { windowsHide: true, timeout: 60000 }).catch(() => {})
}
