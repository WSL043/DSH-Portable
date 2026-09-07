import assert from 'node:assert/strict'
import { mkdtemp, open, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readLogTail } from '../launcher/diagnostic-policy.mjs'
import { buildDshEnv, layoutForRoot } from '../launcher/portable-core.mjs'

test('log tails read bounded bytes from large files and respect launch offsets and truncation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-log-tail-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = path.join(root, 'large.log')
  const file = await open(filename, 'w+')
  try {
    await file.truncate(128 * 1024 * 1024)
    await file.write(Buffer.from('old\nnew\n'), 0, 8, 128 * 1024 * 1024)
    assert.equal(readLogTail(filename, 4), 'new\n')
    assert.equal(readLogTail(filename, 64, 128 * 1024 * 1024 + 4), 'new\n')
    await file.truncate(0)
    assert.equal(readLogTail(filename, 64, 128 * 1024 * 1024), '')
    await file.write(Buffer.from('fresh'), 0, 5, 0)
    assert.equal(readLogTail(filename, 64), 'fresh')
  } finally { await file.close() }
})

test('child environments use the selected capsule runtime even if the inherited root is stale', () => {
  const layout = layoutForRoot(path.resolve('portable'), process.platform, path.resolve('state'), path.resolve('cache'))
  assert.equal(buildDshEnv(layout, { DSH_PORTABLE_RUNTIME_ROOT: 'old-cache' }).DSH_PORTABLE_RUNTIME_ROOT, layout.immutableRoot)
})
