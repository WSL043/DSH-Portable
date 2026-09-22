import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, utimes, access, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { maintainPluginLogs } from '../launcher/plugin-log-maintenance.mjs'
import { inspectStorage } from '../launcher/storage-report.mjs'
const now = Date.now()
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-plugin-logs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'data/dsh-home')
  const profile = path.join(home, 'profiles/web')
  const logs = path.join(profile, '.plugin-manager/logs')
  await mkdir(logs, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), '{}')
  const add = async (name, age, text = 'log') => {
    const dir = path.join(logs, name)
    await mkdir(dir)
    const file = path.join(dir, 'pnpm.log')
    await writeFile(file, text)
    await utimes(file, new Date(now - age), new Date(now - age))
    return file
  }
  return { root, home, profile, logs, add }
}
const day = 86400000

test('bounded log retention keeps newest, recent, unknown content and all user data', async t => {
  const f = await fixture(t)
  const newest = await f.add('operation-AAAAAA', 100)
  const recent = await f.add('operation-BBBBBB', day / 2)
  const old = await f.add('operation-CCCCCC', day * 30)
  const unknown = await f.add('operation-DDDDDD', day * 30)
  await writeFile(path.join(path.dirname(unknown), 'keep.json'), 'recovery')
  await mkdir(path.join(f.home, 'sessions'))
  await writeFile(path.join(f.home, 'sessions/private'), 'user')
  const lock = async (filename, fn, options) => {
    assert.equal(filename, path.join(f.profile, 'package.json'))
    assert.equal(options.waitMs, 0)
    return fn()
  }
  const result = await maintainPluginLogs(f.home, lock, { now, maxRuns: 1, maxBytes: 1 })
  assert.equal(result.removed, 1)
  await assert.rejects(access(old), { code: 'ENOENT' })
  for (const file of [newest, recent, unknown]) await access(file)
  assert.equal(await readFile(path.join(f.home, 'sessions/private'), 'utf8'), 'user')
  assert.equal((await maintainPluginLogs(f.home, lock, { now, maxRuns: 1, maxBytes: 1 })).removed, 0)
  const report = await inspectStorage(f.root)
  assert.equal(report.categories.find(c => c.id === 'logs').bytes, 17)
})

test('contended or unavailable official lock leaves all logs intact', async t => {
  const f = await fixture(t)
  const old = await f.add('operation-AAAAAA', day * 30)
  await f.add('operation-BBBBBB', 100)
  for (const lock of [undefined, async () => { throw new Error('busy') }]) {
    assert.equal((await maintainPluginLogs(f.home, lock, { now })).deferred, 1)
    await access(old)
  }
})

test('links and unexpected trees survive; work budget stops rather than partially ranking history', async t => {
  const f = await fixture(t)
  const external = path.join(f.root, 'external')
  await mkdir(external)
  await writeFile(path.join(external, 'pnpm.log'), 'external')
  await symlink(external, path.join(f.logs, 'operation-AAAAAA'), process.platform === 'win32' ? 'junction' : 'dir')
  const old = await f.add('operation-BBBBBB', day * 30)
  await f.add('operation-CCCCCC', 100)
  const lock = async (_file, fn) => fn()
  assert.equal((await maintainPluginLogs(f.home, lock, { now, budgetMs: 0 })).limited, true)
  await access(old)
  const result = await maintainPluginLogs(f.home, lock, { now })
  assert.equal(result.removed, 1)
  assert.equal(await readFile(path.join(external, 'pnpm.log'), 'utf8'), 'external')
})
