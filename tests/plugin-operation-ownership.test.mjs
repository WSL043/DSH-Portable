import assert from 'node:assert/strict'
import { mkdtemp, mkdir, open, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createOfficialTransactionRuntime } from '../app/vendor/dsh-portable-plugin-market/src/official-transaction.ts'
import { withPluginProfileTransaction } from '../launcher/plugin-profile-transaction.mjs'

test('official manager, market and CLI serialize one profile and preserve the later success', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-owners-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'profiles', 'web')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'package.json')
  await writeFile(file, 'baseline')
  const withFileLock = async (filename, fn) => {
    assert.equal(filename, file)
    const handle = await open(`${filename}.lock`, 'wx')
    try { return await fn() } finally { await handle.close(); await unlink(`${filename}.lock`) }
  }
  const profile = { name: 'web', dir, cwd: root, installAnchor: file }
  const host = { get: key => key === 'profileContext' ? profile : {
    listPlugins() { return [] }, setPluginEnabled() {},
  } }
  let marketStarted, releaseMarket
  const marketEntered = new Promise(resolve => { marketStarted = resolve })
  const marketGate = new Promise(resolve => { releaseMarket = resolve })
  const market = createOfficialTransactionRuntime(host, dir, async () => ({
    withFileLock,
    async runProfilePnpm() {
      await writeFile(file, 'market partial write')
      marketStarted()
      await marketGate
      return { exitCode: 1 }
    },
  }))
  t.after(() => market.dispose())
  const spec = { args: ['bin.js', 'plugin', '--profile', 'web', 'install'], cwd: root, env: {},
    layout: { dshHome: root, dshBin: path.join(root, 'dsh/lib/bin.js') } }
  const cliApi = { withFileLock, runProfilePnpm: async () => {
    await writeFile(file, 'CLI success')
    return { exitCode: 0 }
  }, initProfile() {}, PROFILE_TEMPLATES: {}, DEFAULT_PROFILE_BUNDLES: [] }
  const cli = () => withPluginProfileTransaction(spec, 'web', async run => run(spec,
    { stdout: { write() {} }, stderr: { write() {} }, mirrorStderr: false }), async () => cliApi)

  const marketWork = market.withMutation(async () => {
    const result = await market.runPlugin('web', ['install'])
    assert.equal(result.exitCode, 1)
    // A failed market operation restores its own prior snapshot before unlock.
    await writeFile(file, 'baseline')
  })
  await marketEntered
  await assert.rejects(cli(), { code: 'EEXIST' })
  await assert.rejects(withFileLock(file, async () => { await writeFile(file, 'official toggle') }), { code: 'EEXIST' })
  releaseMarket()
  await marketWork
  assert.equal((await cli()).status, 0)
  assert.equal(await readFile(file, 'utf8'), 'CLI success')

  let releaseOfficial
  const officialGate = new Promise(resolve => { releaseOfficial = resolve })
  let officialStarted
  const officialEntered = new Promise(resolve => { officialStarted = resolve })
  const officialWork = withFileLock(file, async () => {
    officialStarted()
    await officialGate
    await writeFile(file, 'official toggle success')
  })
  await officialEntered
  await assert.rejects(market.withMutation(async () => {}), { code: 'PROFILE_BUSY' })
  await assert.rejects(cli(), { code: 'EEXIST' })
  releaseOfficial()
  await officialWork
  assert.equal(await readFile(file, 'utf8'), 'official toggle success')
})
