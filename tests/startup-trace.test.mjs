import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { appendStartupTrace, beginStartupTrace } from '../launcher/startup-trace.mjs'

test('one startup trace is complete, correlated, and rotates as one bounded unit', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-startup-trace-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = beginStartupTrace(root, {
    startupId: 'a'.repeat(32),
    startedAt: Date.now() - 50,
    component: 'runtime-entry',
    phase: 'process-start',
  })
  assert.ok(first)
  appendStartupTrace(first, 'portable-cli', 'host-wait-begin', { port: 3080 })
  appendStartupTrace(first, 'portable-host', 'official-dsh-import-begin')

  const firstEvents = (await readFile(path.join(root, 'startup-latest.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(firstEvents.map(event => event.phase), ['process-start', 'host-wait-begin', 'official-dsh-import-begin'])
  assert.ok(firstEvents.every(event => event.startupId === 'a'.repeat(32)))
  assert.ok(firstEvents.every(event => Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0))

  const second = beginStartupTrace(root, {
    startupId: 'b'.repeat(32),
    startedAt: Date.now(),
    component: 'runtime-entry',
    phase: 'process-start',
  })
  assert.ok(second)
  const previous = await readFile(path.join(root, 'startup-previous.jsonl'), 'utf8')
  const latest = await readFile(path.join(root, 'startup-latest.jsonl'), 'utf8')
  assert.match(previous, new RegExp('"startupId":"' + 'a'.repeat(32) + '"'))
  assert.match(latest, new RegExp('"startupId":"' + 'b'.repeat(32) + '"'))
  assert.doesNotMatch(latest, new RegExp('"startupId":"' + 'a'.repeat(32) + '"'))
})

test('invalid trace context never prevents startup diagnostics callers from continuing', () => {
  assert.equal(beginStartupTrace('', { startupId: 'invalid' }), null)
  assert.equal(appendStartupTrace(null, 'portable-cli', 'ignored'), false)
})
