import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Exercise the actual CLI loop with a deterministic slow host and process probes.
const cli = await readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
const waitSource = cli.slice(cli.indexOf('async function waitForHost('), cli.indexOf('\nfunction portAvailable('))

test('a listening authenticated host stays starting until its workspace URL is committed', async () => {
  const state = { pid: 123, port: 3080 }
  let probes = 0
  const statusSource = cli.slice(cli.indexOf('async function status()'), cli.indexOf('\nasync function openExisting()'))
  const status = vm.runInNewContext(`(${statusSource})`, {
    readProcessState: () => state,
    ownedState: () => true,
    layout: { environmentId: 'default', root: 'fixture' },
    httpReady: async () => { probes += 1; return true },
  })
  assert.equal((await status()).status, 'starting')
  assert.equal(probes, 0)
  state.url = 'http://127.0.0.1:3080/?token=fixture'
  const ready = await status()
  assert.equal(ready.status, 'running')
  assert.equal(ready.url, state.url)
  assert.equal(probes, 1)
})

function fixture({ alive = () => true, owned = () => true } = {}) {
  let now = 0
  let identities = 0
  let polls = 0
  const wait = vm.runInNewContext(`(${waitSource})`, {
    Date: { now: () => now },
    setTimeout: (callback, delay) => { now += delay; callback() },
    layout: { platform: 'win32' },
    processExists: () => { polls += 1; return alive(now) },
    ownedState: () => owned(++identities, now),
    officialWorkspaceUrl: () => now >= 5000 ? 'http://127.0.0.1:3080/?token=test' : null,
    tailSince: () => '',
    httpReady: async () => true,
  })
  return { wait, get identities() { return identities }, get polls() { return polls } }
}

test('slow startup polls liveness without launching a process inspector on every tick', async () => {
  const probe = fixture()
  const url = await probe.wait({ pid: 123, port: 3080 }, 6000, { filename: 'fixture', offset: 0 })
  assert.equal(url, 'http://127.0.0.1:3080/?token=test')
  assert.equal(probe.identities, 2, 'verify ownership at entry and immediately before accepting readiness')
  assert.ok(probe.polls >= 50)
})

test('an exited host and a changed final identity never become ready', async () => {
  for (const probe of [fixture({ alive: now => now < 2000 }), fixture({ owned: call => call === 1 })]) {
    assert.equal(await probe.wait({ pid: 123, port: 3080 }, 6000, { filename: 'fixture', offset: 0 }), null)
  }
})

test('identity grace expires and a live but silent host still respects the startup deadline', async () => {
  const mismatch = fixture({ owned: () => false })
  assert.equal(await mismatch.wait({ pid: 123, port: 3080 }, 6000), null)
  assert.ok(mismatch.identities <= 31)
  const silent = fixture()
  const phases = []
  assert.equal(await silent.wait({ pid: 123, port: 3080 }, 1000, null, phase => phases.push(phase)), null)
  assert.equal(phases.at(-1), 'host-wait-timeout')
})

function inspectionTimeout() {
  return new Error('Could not inspect process', { cause: Object.assign(new Error('CIM timeout'), { code: 'ETIMEDOUT' }) })
}

test('startup retries one timed-out identity read and still verifies final ownership', async () => {
  const phases = []
  const probe = fixture({ owned: call => { if (call === 1) throw inspectionTimeout(); return true } })
  const url = await probe.wait({ pid: 123, port: 3080 }, 20000, { filename: 'fixture', offset: 0 }, phase => phases.push(phase))
  assert.match(url, /127\.0\.0\.1/)
  assert.equal(probe.identities, 3)
  assert.equal(phases.filter(phase => phase === 'host-process-query-retry').length, 1)
})

test('repeated timeouts and non-timeout inspection errors remain failures', async () => {
  const repeated = fixture({ owned: () => { throw inspectionTimeout() } })
  await assert.rejects(repeated.wait({ pid: 123, port: 3080 }, 20000), /Could not inspect process/)
  assert.equal(repeated.identities, 2)
  const denied = fixture({ owned: () => { throw new Error('Access denied') } })
  await assert.rejects(denied.wait({ pid: 123, port: 3080 }, 20000), /Access denied/)
  assert.equal(denied.identities, 1)
})

test('an inspection retry neither grants ownership nor extends the startup deadline', async () => {
  const changed = fixture({ owned: call => { if (call === 1) throw inspectionTimeout(); return false } })
  assert.equal(await changed.wait({ pid: 123, port: 3080 }, 20000), null)
  const expired = fixture({ owned: () => { throw inspectionTimeout() } })
  await assert.rejects(expired.wait({ pid: 123, port: 3080 }, 1000), /Could not inspect process/)
  assert.equal(expired.identities, 1)
})
