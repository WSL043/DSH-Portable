import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { assessUpdateRequirements, preflightNpmUpdate } from '../app/vendor/dsh-portable-plugin-market/src/update-preflight.ts'

test('confirmed target requirements use actual host and peer versions', () => {
  const manifest = { engines: { dsh: '>=2.0.0' }, peerDependencies: { '@deepseek-ai/dsh-settings': '^3.0.0', '@deepseek-ai/dsh-web': '^1.0.0' } }
  const failures = assessUpdateRequirements(manifest, '1.0.0', { '@deepseek-ai/dsh-settings': '2.0.0', '@deepseek-ai/dsh-web': '1.2.0' })
  assert.deepEqual(failures.map(x => x.name), ['dsh', '@deepseek-ai/dsh-settings'])
  assert.deepEqual(assessUpdateRequirements({ engines: { dsh: '^1.0.0' } }, '1.2.0', {}), [])
})

test('unknown and optional requirements do not invent incompatibility', () => {
  assert.deepEqual(assessUpdateRequirements({ engines: { dsh: 'unknown-range' } }, '1.0.0', {}), [])
  assert.deepEqual(assessUpdateRequirements({ engines: { dsh: '>=2.0.0' } }, null, {}), [])
  assert.deepEqual(assessUpdateRequirements({ peerDependencies: { '@deepseek-ai/dsh-settings': '^9.0.0' }, peerDependenciesMeta: { '@deepseek-ai/dsh-settings': { optional: true } } }, '1.0.0', { '@deepseek-ai/dsh-settings': '1.0.0' }), [])
})

test('metadata check requests the exact target and ignores mismatched registry responses', async () => {
  let requested
  let returnedVersion = '2.0.0'
  const adapters = {
    findHost: () => '/selected/capsule/dsh', versionAt: () => '1.0.0',
    fetch: async url => { requested = url; return { ok: true, json: async () => ({ name: '@scope/plugin', version: returnedVersion, engines: { dsh: '>=2.0.0' } }) } },
  }
  assert.equal((await preflightNpmUpdate('@scope/plugin', '2.0.0', adapters)).status, 'incompatible')
  assert.equal(requested, 'https://registry.npmjs.org/%40scope%2Fplugin/2.0.0')
  returnedVersion = '3.0.0'
  assert.equal((await preflightNpmUpdate('@scope/plugin', '2.0.0', adapters)).status, 'unknown')
  assert.equal((await preflightNpmUpdate('@scope/plugin', '2.0.0', { ...adapters, fetch: async () => { throw Error('offline') } })).status, 'unknown')
})

test('update route checks before pnpm can mutate the profile', async () => {
  const source = await readFile(new URL('../app/vendor/dsh-portable-plugin-market/src/routes.ts', import.meta.url), 'utf8')
  const route = source.slice(source.indexOf("path: '/dsh-market/update'"))
  assert.ok(route.indexOf('await preflightNpmUpdate(name, expectedNpmVersion)') < route.indexOf('await runPlugin(config.profile, addArgs)'))
  assert.match(route, /code: 'host-incompatible'/)
})
