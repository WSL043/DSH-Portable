import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = process.env.DSH_TEST_CLI_REF
  ? execFileSync('git', ['show', `${process.env.DSH_TEST_CLI_REF}:launcher/portable-cli.mjs`], { encoding: 'utf8' })
  : await readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
const main = source.slice(source.indexOf('async function main() {'), source.indexOf('\nmain().catch('))

function fixture(command, snapshot) {
  const calls = []
  const context = {
    process: { platform: 'darwin', argv: ['node', 'cli', command], env: {} },
    root: '/portable', baseStateRoot: '/portable',
    parseCli: () => ({ command, json: true, waitForLockMs: 0 }),
    environmentStateRoot: () => '/portable', layoutForRoot: () => ({ root: '/portable' }),
    activeOptions: null, startupProgressJson: false, layout: null,
    status: async () => { calls.push('read-status'); return snapshot },
    print: (result, json) => { calls.push({ result, json }) },
    acquireLaunchLock: async () => { calls.push('lock'); throw new Error('Another portable launcher is already starting or stopping DSH.') },
    ensurePortableDirectories: async () => { throw new Error('Status must not create or mutate directories') },
  }
  return { run: vm.runInNewContext(`(${main})`, context), calls }
}

for (const status of ['stopped', 'starting', 'running']) {
  test(`status returns the ${status} snapshot while a launcher holds the mutation lock`, async () => {
    const snapshot = { status, environment: 'default' }
    const probe = fixture('status', snapshot)
    await probe.run()
    assert.deepEqual(probe.calls, ['read-status', { result: snapshot, json: true }])
  })
}

test('start still requires the exclusive launch lock', async () => {
  const probe = fixture('start', { status: 'stopped' })
  await assert.rejects(probe.run(), /Another portable launcher/)
  assert.deepEqual(probe.calls, ['lock'])
})
