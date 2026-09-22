import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, open, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withPluginProfileTransaction } from '../launcher/plugin-profile-transaction.mjs'
import { runCheckedPluginMutation } from '../launcher/plugin-command-check.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cli-profile-transaction-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'profiles/web')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'package.json')
  await writeFile(file, '{"dependencies":{},"dsh":{"profile":{"bundles":[]}}}')
  const spec = { args: ['bin.js', 'plugin', '--profile', 'web', 'install'], cwd: root, env: {},
    layout: { dshHome: root, dshBin: path.join(root, 'dsh/lib/bin.js'), logsDir: path.join(root, 'logs') } }
  const withFileLock = async (filename, fn) => {
    const handle = await open(filename + '.lock', 'wx')
    try { return await fn() } finally { await handle.close(); await unlink(filename + '.lock') }
  }
  return { root, dir, file, spec, withFileLock }
}
const output = { stdout: { write() {} }, stderr: { write() {} }, mirrorStderr: true }

test('CLI holds the official writer across validation failure and restoration', async t => {
  const bed = await fixture(t)
  const original = await readFile(bed.file, 'utf8')
  let calls = 0
  const api = { withFileLock: bed.withFileLock, runProfilePnpm: async (context, args) => {
    assert.equal(context.dir, bed.dir)
    assert.deepEqual(args, ['install'])
    await assert.rejects(bed.withFileLock(bed.file, async () => {}), { code: 'EEXIST' })
    if (++calls === 1) await writeFile(bed.file, '{"dsh":{"profile":{"bundles":["bad-plugin"]}}}')
    else assert.equal(await readFile(bed.file, 'utf8'), original)
    return { exitCode: 0 }
  } }
  const result = await withPluginProfileTransaction(bed.spec, 'web', run => runCheckedPluginMutation({
    profileRoot: bed.dir, layout: bed.spec.layout,
    run: () => run(bed.spec, output), reinstall: () => run(bed.spec, output),
    preflight: async () => {
      await assert.rejects(bed.withFileLock(bed.file, async () => {}), { code: 'EEXIST' })
      return { ok: false, detail: 'invalid plugin' }
    },
  }), async () => api)
  assert.equal(result.status, 1)
  assert.equal(calls, 2)
  assert.equal(await readFile(bed.file, 'utf8'), original)
  await bed.withFileLock(bed.file, async () => {})
})

test('wrong profile, expired operation and validation exceptions cannot write unlocked', async t => {
  const bed = await fixture(t)
  const api = { withFileLock: bed.withFileLock, runProfilePnpm: async () => { throw Error('unexpected package write') } }
  let saved
  await withPluginProfileTransaction(bed.spec, 'web', async run => {
    saved = run
    await assert.rejects(run({ ...bed.spec, args: ['bin.js', 'plugin', '--profile', 'other', 'install'] }, output), /does not match/)
  }, async () => api)
  await assert.rejects(saved(bed.spec, output), /already ended/)
  await assert.rejects(withPluginProfileTransaction(bed.spec, '../escape', async () => {}, async () => api), /Invalid/)
  await assert.rejects(withPluginProfileTransaction(bed.spec, 'web', async () => { throw Error('failure') }, async () => api), /failure/)
  await bed.withFileLock(bed.file, async () => {})
})
