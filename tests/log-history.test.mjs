import assert from 'node:assert/strict'
import { lstat, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { appendHistoryLog, pruneLogHistory } from '../launcher/log-history.mjs'

const line = (value) => `${value}\n`
const runPath = (root, startupId) => path.join(root, 'history', startupId)

test('a third startup leaves the first startup history available', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-log-history-startups-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = 'a'.repeat(32)
  const second = 'b'.repeat(32)
  const third = 'c'.repeat(32)

  assert.equal(appendHistoryLog(root, first, 'startup.jsonl', '{"startup":1}'), true)
  assert.equal(appendHistoryLog(root, second, 'startup.jsonl', '{"startup":2}'), true)
  assert.equal(appendHistoryLog(root, third, 'startup.jsonl', '{"startup":3}'), true)
  assert.equal(await readFile(path.join(runPath(root, first), 'startup.jsonl'), 'utf8'), line('{"startup":1}'))
  assert.deepEqual((await readdir(path.join(root, 'history'))).sort(), [first, second, third].sort())
})

test('a full history file rotates once and keeps the latest line plus previous file', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-log-history-rotate-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const startupId = 'd'.repeat(32)
  const fullLine = 'x'.repeat(16 * 1024 - 1)

  for (let index = 0; index < 8; index += 1) {
    assert.equal(appendHistoryLog(root, startupId, 'runtime-health.jsonl', fullLine), true)
  }
  assert.equal(appendHistoryLog(root, startupId, 'runtime-health.jsonl', 'latest'), true)

  const current = path.join(runPath(root, startupId), 'runtime-health.jsonl')
  const previous = `${current}.previous`
  assert.equal(await readFile(current, 'utf8'), line('latest'))
  assert.equal((await readFile(previous, 'utf8')).split('\n').filter(Boolean).length, 8)
  assert.equal((await stat(current)).size, Buffer.byteLength(line('latest')))
})

test('pruning removes old, excess, and over-capacity runs while preserving current, unknown, and linked runs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-log-history-prune-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const now = Date.now()
  const old = '1'.repeat(32)
  const excess = '2'.repeat(32)
  const overCapacity = '3'.repeat(32)
  const extra = '4'.repeat(32)
  const current = '5'.repeat(32)
  const unknown = '6'.repeat(32)
  const linked = '7'.repeat(32)
  const history = path.join(root, 'history')

  assert.equal(appendHistoryLog(root, old, 'startup.jsonl', 'o'), true)
  assert.equal(appendHistoryLog(root, excess, 'startup.jsonl', 'e'), true)
  assert.equal(appendHistoryLog(root, overCapacity, 'startup.jsonl', 'capacity'), true)
  assert.equal(appendHistoryLog(root, extra, 'startup.jsonl', 'x'), true)
  assert.equal(appendHistoryLog(root, current, 'startup.jsonl', 'c'), true)
  assert.equal(appendHistoryLog(root, unknown, 'startup.jsonl', 'u'), true)
  await writeFile(path.join(runPath(root, unknown), 'keep-me.txt'), 'unknown content')

  const timestamps = new Map([
    [old, now - 30 * 86400000],
    [excess, now - 3 * 86400000],
    [overCapacity, now - 2 * 86400000],
    [extra, now - 86400000],
    [current, now],
    [unknown, now - 30 * 86400000],
  ])
  for (const [startupId, timestamp] of timestamps) {
    await utimes(path.join(runPath(root, startupId), 'startup.jsonl'), timestamp / 1000, timestamp / 1000)
  }
  try {
    await symlink(runPath(root, current), path.join(history, linked), 'junction')
  } catch (error) {
    assert.fail(`the link-preservation scenario could not be created: ${error.message}`)
  }

  const result = pruneLogHistory(root, {
    currentStartupId: current,
    now,
    maxRuns: 4,
    maxAgeMs: 14 * 86400000,
    maxBytes: 6,
  })
  assert.deepEqual(result, { removed: 3, retained: 3, bytes: 6 })
  for (const startupId of [old, excess, overCapacity]) {
    await assert.rejects(stat(runPath(root, startupId)))
  }
  for (const startupId of [extra, current, unknown, linked]) {
    if (startupId === linked) assert.equal((await lstat(runPath(root, startupId))).isSymbolicLink(), true)
    else assert.equal((await stat(runPath(root, startupId))).isDirectory(), true)
  }
  assert.equal(await readFile(path.join(runPath(root, unknown), 'keep-me.txt'), 'utf8'), 'unknown content')
})
