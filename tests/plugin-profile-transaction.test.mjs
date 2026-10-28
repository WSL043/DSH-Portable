import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, open, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withPluginProfileTransaction } from '../launcher/plugin-profile-transaction.mjs'
import { runCheckedPluginMutation } from '../launcher/plugin-command-check.mjs'
import { loadOfficialProfileBundles } from '../launcher/official-profile-bundles.mjs'

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

test('profile defaults follow the official export owner without masking broken runtimes', async () => {
  const defaults = { PROFILE_TEMPLATES: { web: { bundles: ['official-web'] } }, DEFAULT_PROFILE_BUNDLES: ['official-base'] }
  assert.deepEqual(await loadOfficialProfileBundles(async () => { throw Error('legacy must not import new owner') }, defaults), defaults)
  assert.deepEqual(await loadOfficialProfileBundles(async name => {
    assert.equal(name, '@deepseek-ai/dsh-official-bundles')
    return defaults
  }, {}), defaults)
  await assert.rejects(loadOfficialProfileBundles(async () => { throw Error('broken official owner') }, {}), /broken official owner/)
  await assert.rejects(loadOfficialProfileBundles(async () => ({}), {}), /no official profile bundle defaults/)
})

for (const modern of [false, true]) test(`CLI initializes with ${modern ? 'new bundle owner' : 'legacy boot'} defaults`, async t => {
  const bed = await fixture(t)
  await unlink(bed.file)
  bed.spec.layout.appDir = path.join(bed.root, 'app')
  const defaults = "export const PROFILE_TEMPLATES = { web: { bundles: ['official-web'] } }; export const DEFAULT_PROFILE_BUNDLES = ['official-base'];"
  const packages = {
    'dsh-atomic-write': 'export async function withFileLock(_file, fn) { return fn() }',
    'dsh-plugin-manager': 'export async function runProfilePnpm() { return { exitCode: 0 } }',
    'dsh-app-boot': `import { writeFileSync } from 'node:fs'; import path from 'node:path'; export function initProfile(dir, bundles) { writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ bundles })) }; ${modern ? '' : defaults}`,
    ...(modern ? { 'dsh-official-bundles': defaults } : {}),
  }
  for (const [name, code] of Object.entries(packages)) {
    const dir = path.join(bed.spec.layout.appDir, 'node_modules', '@deepseek-ai', name)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', exports: { '.': './index.js', './operations': './index.js' } }))
    await writeFile(path.join(dir, 'index.js'), code)
  }
  await withPluginProfileTransaction(bed.spec, 'web', async () => {})
  assert.deepEqual(JSON.parse(await readFile(bed.file, 'utf8')), { bundles: ['official-web'] })
  await unlink(bed.file)
  await withPluginProfileTransaction(bed.spec, 'custom', async () => {})
  assert.deepEqual(JSON.parse(await readFile(path.join(bed.root, 'profiles/custom/package.json'), 'utf8')), { bundles: ['official-base'] })
})
