import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDataArchive, restoreDataArchive } from '../launcher/data-transfer.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

test('a thousand-file migration keeps journal I/O linear and does not emit one log event per file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-import-volume-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = layoutForRoot(path.join(root, 'source'))
  const target = layoutForRoot(path.join(root, 'target'))
  await fs.mkdir(source.workspace, { recursive: true })
  const count = 1000
  for (let offset = 0; offset < count; offset += 32) {
    await Promise.all(Array.from({ length: Math.min(32, count - offset) }, (_, index) =>
      fs.writeFile(path.join(source.workspace, `${offset + index}.txt`), `content ${offset + index}`)))
  }
  const archive = path.join(root, 'volume.dshdata')
  await createDataArchive(source, archive, { categories: ['workspace'] })
  const open = fs.open
  let journalBytes = 0
  const phases = []
  t.mock.method(fs, 'open', async (filename, ...args) => {
    const handle = await open(filename, ...args)
    if (path.dirname(filename) === path.join(target.dataDir, 'runtime')) {
      const write = handle.writeFile.bind(handle)
      handle.writeFile = async bytes => { journalBytes += Buffer.byteLength(bytes); return write(bytes) }
    }
    return handle
  })
  syncBuiltinESMExports()
  const started = performance.now()
  let result
  try { result = await restoreDataArchive(target, archive, { trace: phase => phases.push(phase) }) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(result.imported, count)
  assert.equal(await fs.readFile(path.join(target.workspace, '999.txt'), 'utf8'), 'content 999')
  assert.ok(journalBytes < count * 4096, `journal wrote ${journalBytes} bytes for ${count} small files`)
  assert.ok(phases.filter(phase => phase === 'import-file-written').length <= 2)
  t.diagnostic(JSON.stringify({ files: count, journalBytes, elapsedMs: Math.round(performance.now() - started) }))
})
