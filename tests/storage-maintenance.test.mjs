import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, utimes, access, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { cleanRetainedStorage } from '../launcher/storage-maintenance.mjs'

test('manual cleanup uses the official writer lock and retains dependency and backup data', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-manual-clean-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtimeRoot = fileURLToPath(new URL('..', import.meta.url))
  const profile = path.join(root, 'data/dsh-home/profiles/web')
  const old = path.join(profile, '.plugin-manager/logs/operation-AAAAAA/pnpm.log')
  const recent = path.join(profile, '.plugin-manager/logs/operation-BBBBBB/pnpm.log')
  const retained = ['data/pnpm-store/blob', 'data/backups/keep', 'data/recovery/keep', 'data/browser/Cookies', 'workspace/keep']
  for (const filename of [old, recent, path.join(profile, 'package.json'), ...retained.map(name => path.join(root, name))]) {
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, filename.endsWith('package.json') ? '{}' : 'sentinel')
  }
  const age = new Date(Date.now() - 30 * 86400000)
  await utimes(old, age, age)
  const requireRuntime = createRequire(path.join(runtimeRoot, 'app/package.json'))
  const { withFileLock } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-atomic-write')).href)
  await withFileLock(path.join(profile, 'package.json'), async () => {
    const result = await cleanRetainedStorage({ root, runtimeRoot })
    assert.equal(result.complete, false)
    assert.equal(result.deferred, 1)
    assert.equal(result.logs, 0)
    await access(old)
  })
  const result = await cleanRetainedStorage({ root, runtimeRoot })
  assert.equal(result.complete, true)
  assert.equal(result.logs, 1)
  await assert.rejects(access(old), { code: 'ENOENT' })
  await access(recent)
  for (const name of retained) assert.equal(await readFile(path.join(root, name), 'utf8'), 'sentinel')
  assert.equal((await cleanRetainedStorage({ root, runtimeRoot })).logs, 0)
})

test('partial cleanup keeps real progress, sanitizes errors and still attempts independent logs', async () => {
  const result = await cleanRetainedStorage({ root: '.' }, {
    cleanRuntime: async () => { throw Object.assign(new Error('private path and credential'), { code: 'EACCES' }) },
    cleanLogs: async () => ({ removed: 2, deferred: 1, limited: true }),
  })
  assert.equal(result.logs, 2)
  assert.equal(result.complete, false)
  assert.equal(result.limited, true)
  assert.deepEqual(result.failures, [{ component: 'runtime', code: 'EACCES' }])
  assert.doesNotMatch(JSON.stringify(result), /private path/)
})
