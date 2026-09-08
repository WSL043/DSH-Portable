import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { startStartupProfile } from '../launcher/runtime-health.mjs'

test('startup profiling captures a recovered synchronous wait and persists its call site in history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-startup-profile-'))
  const id = 'c'.repeat(32)
  const fixture = pathToFileURL(path.join(root, 'slow-module.mjs')).href
  await writeFile(new URL(fixture), 'export const ready = true\n')
  const delayHook = registerHooks({ load(url, context, next) {
    if (url === fixture) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    return next(url, context)
  } })
  const finish = await startStartupProfile(root, id)
  function injectedStartupWait() {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12000)
  }
  try {
    injectedStartupWait()
    await import(fixture)
  } finally {
    await finish('injected-wait-acceptance')
    delayHook.deregister()
  }
  await finish()
  const rows = (await readFile(path.join(root, 'history', id, 'runtime-health.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  const profiles = rows.filter(row => row.observation === 'startup-profile')
  assert.equal(profiles.length, 1)
  assert.ok(profiles[0].sampleCount > 10)
  assert.ok(profiles[0].hotStacks.some(hot => hot.sampledMs >= 500 && hot.stack.some(frame => frame.function === 'injectedStartupWait')),
    JSON.stringify(profiles[0]))
  assert.ok(profiles[0].slowModules.some(item => item.operation === 'load' && item.file === 'slow-module.mjs' && item.durationMs >= 200))
  assert.ok(!JSON.stringify(profiles[0]).includes(os.homedir().replaceAll('\\', '/')))
  assert.ok(Buffer.byteLength(JSON.stringify(profiles[0])) < 16 * 1024)
  console.log(`Startup diagnostic evidence: ${root}`)
})

test('independent health checkpoints survive a permanently blocked startup without a final profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-startup-killed-'))
  const id = 'd'.repeat(32)
  const module = path.join(root, 'blocked.mjs')
  const fixture = path.join(root, 'host.mjs')
  await writeFile(module, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)\n')
  await writeFile(fixture, `
import { startRuntimeHealth, startStartupProfile } from ${JSON.stringify(new URL('../launcher/runtime-health.mjs', import.meta.url).href)}
const health = startRuntimeHealth(${JSON.stringify(root)}, ${JSON.stringify(id)})
await startStartupProfile(${JSON.stringify(root)}, ${JSON.stringify(id)}, p => health(null, p))
health('official-dsh-import')
await import(${JSON.stringify(pathToFileURL(module).href)})
`)
  const child = spawn(process.execPath, [fixture], { windowsHide: true, stdio: 'ignore' })
  const exit = once(child, 'exit')
  let rows = []
  try {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      try {
        rows = (await readFile(path.join(root, 'history', id, 'runtime-health.jsonl'), 'utf8'))
          .trim().split('\n').filter(Boolean).map(JSON.parse)
      } catch {}
      if (rows.some(row => row.observation === 'main-heartbeat-delayed' && row.startupProgress)) break
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    const stalled = rows.find(row => row.observation === 'main-heartbeat-delayed' && row.startupProgress)
    assert.ok(stalled, JSON.stringify(rows))
    assert.equal(stalled.startupProgress.file, 'blocked.mjs')
    assert.ok(Number.isInteger(stalled.startupProgress.moduleCalls))
    assert.ok(!JSON.stringify(stalled.startupProgress).includes(root))
    assert.equal(rows.some(row => row.observation === 'startup-profile'), false)
  } finally {
    child.kill('SIGKILL')
    await exit
  }
  assert.ok((await readFile(path.join(root, 'history', id, 'runtime-health.jsonl'), 'utf8')).includes('startupProgress'))
})
