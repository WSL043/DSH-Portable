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
