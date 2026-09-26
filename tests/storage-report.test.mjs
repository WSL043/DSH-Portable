import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { inspectStorage } from '../launcher/storage-report.mjs'

test('storage inventory separates retained backups, skips links and reports partial scans', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-storage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const dir of ['data/pnpm-store', 'data/backups', 'data/recovery', 'data/logs', 'workspace']) await mkdir(path.join(root, dir), { recursive: true })
  await writeFile(path.join(root, 'data/pnpm-store/blob'), '12345')
  await writeFile(path.join(root, 'data/backups/saved'), '123')
  await writeFile(path.join(root, 'workspace/private'), 'do not scan or delete')
  await symlink(path.join(root, 'workspace'), path.join(root, 'data/pnpm-store/external'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = await inspectStorage(root)
  assert.equal(result.categories[0].bytes, 5)
  assert.equal(result.categories[0].complete, false)
  assert.equal(result.categories[0].skippedLinks, 1)
  assert.equal(result.categories[0].errors, 0)
  assert.equal(result.categories[0].limited, false)
  assert.equal(result.categories[1].bytes, 3)
  assert.equal(result.categories[1].complete, true)
  const limited = await inspectStorage(root, { maxEntries: 1 })
  assert.equal(limited.complete, false)
  assert.equal(limited.categories[0].limited, true)
  assert.equal(await readFile(path.join(root, 'workspace/private'), 'utf8'), 'do not scan or delete')
  assert.equal(await readFile(path.join(root, 'data/backups/saved'), 'utf8'), '123')
})

test('a large dependency store cannot starve backup and log measurements', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-storage-fair-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const dir of ['pnpm-store', 'backups', 'recovery', 'logs']) await mkdir(path.join(root, 'data', dir), { recursive: true })
  for (let i = 0; i < 30; i++) await writeFile(path.join(root, 'data/pnpm-store', String(i)), 'x')
  await writeFile(path.join(root, 'data/backups/saved'), 'backup')
  await writeFile(path.join(root, 'data/logs/log'), 'log')
  const report = await inspectStorage(root, { maxEntries: 16 })
  assert.equal(report.categories[0].limited, true)
  assert.equal(report.categories[1].complete, true)
  assert.equal(report.categories[1].bytes, 6)
  assert.equal(report.categories[3].complete, true)
  assert.equal(report.categories[3].bytes, 3)
})
