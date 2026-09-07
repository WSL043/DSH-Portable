import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

function runFixture(fixture, logDirectory) {
  return new Promise((resolve) => {
    execFile(process.execPath, [fixture, logDirectory], {
      timeout: 35000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      resolve({
        code: error ? (error.code ?? -1) : 0,
        signal: error?.signal ?? null,
        stdout,
        stderr,
      })
    })
  })
}

test('runtime health records async waits, blocked main thread, and recovery', async (t) => {
  const logDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-health-'))
  t.after(() => rm(logDirectory, { recursive: true, force: true }))

  const runtimeHealthUrl = new URL('../launcher/runtime-health.mjs', import.meta.url).href
  const fixture = path.join(logDirectory, 'runtime-health-fixture.mjs')
  await writeFile(fixture, `
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { startRuntimeHealth } from ${JSON.stringify(runtimeHealthUrl)}

const setPhase = startRuntimeHealth(process.argv[2], 'a'.repeat(32))
setPhase('async-wait')
await delay(8000)
setPhase('blocking-work')
const deadline = performance.now() + 8000
while (performance.now() < deadline) {}
setPhase('recovered')
await delay(4000)
`, 'utf8')

  const result = await runFixture(fixture, logDirectory)
  assert.equal(result.code, 0, `fixture failed (signal: ${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)

  const events = (await readFile(path.join(logDirectory, 'runtime-health.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
  assert.ok(events.length > 0, 'runtime health log must contain samples')

  assert.ok(
    events.some(event => event.phase === 'async-wait' && event.observation === 'sample' && event.mainHeartbeatAgeMs < 5000),
    'async-wait must have a timely sample',
  )
  assert.ok(
    events.some(event => event.phase === 'blocking-work' && event.observation === 'main-heartbeat-delayed' && event.mainHeartbeatAgeMs >= 5000),
    'blocking-work must record a delayed main heartbeat',
  )
  assert.ok(events.some(event => event.observation === 'main-heartbeat-recovered'), 'recovery must be recorded')

  assert.ok(events.every(event => event.startupId === 'a'.repeat(32)), 'all events must use the fixture startup ID')
  const pids = new Set(events.map(event => event.pid))
  assert.equal(pids.size, 1, 'all events must use one process ID')
  assert.ok(events.every(event => Number.isInteger(event.pid) && event.pid > 0), 'process ID must be a positive integer')
  assert.ok(events.every(event => Number.isFinite(event.cpuPercent)), 'cpuPercent must be finite')
  assert.ok(events.every(event => Number.isFinite(event.rssBytes) && event.rssBytes > 0), 'rssBytes must be a positive finite number')
})
