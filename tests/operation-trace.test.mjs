import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { appendOperationTrace, beginOperationTrace } from '../launcher/operation-trace.mjs'

test('operation trace rotates complete phase history and rejects credential fields', async (t) => {
  const logs = await mkdtemp(path.join(os.tmpdir(), 'dsh-operation-trace-'))
  t.after(() => rm(logs, { recursive: true, force: true }))
  const first = beginOperationTrace(logs, 'data-import')
  assert.equal(appendOperationTrace(first, 'begin', { files: 3, token: 'private' }), true)
  const second = beginOperationTrace(logs, 'data-import')
  assert.equal(appendOperationTrace(second, 'complete', { profiles: 1 }), true)
  const previous = await readFile(path.join(logs, 'data-import-previous.jsonl'), 'utf8')
  const latest = await readFile(path.join(logs, 'data-import-latest.jsonl'), 'utf8')
  assert.match(previous, /"phase":"begin"/)
  assert.doesNotMatch(previous, /private|token/)
  assert.match(latest, /"phase":"complete"/)
})
