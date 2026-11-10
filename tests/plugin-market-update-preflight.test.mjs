import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readResolvedPackageVersion } from '../app/vendor/dsh-portable-plugin-market/src/check.ts'
import { assessPublishedManifest, assessUpdateRequirements, preflightNpmUpdate } from '../app/vendor/dsh-portable-plugin-market/src/update-preflight.ts'

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

test('a DSH-injected client peer is required even when npm marks it optional', () => {
  const manifest = {
    name: 'dsh-chat-manager', version: '1.5.2-beta.5',
    dsh: { client: { inject: ['@deepseek-ai/dsh-client-locale'] } },
    peerDependencies: { '@deepseek-ai/dsh-client-locale': '0.1.7-rc.2' },
    peerDependenciesMeta: { '@deepseek-ai/dsh-client-locale': { optional: true } },
  }
  const failures = assessUpdateRequirements(manifest, '0.1.7-alpha.1', {
    '@deepseek-ai/dsh-client-locale': '0.1.7-alpha.1',
  })
  assert.deepEqual(failures.map(failure => failure.name), ['@deepseek-ai/dsh-client-locale'])
  const host = version => ({ findHost: () => '/isolated/dsh', versionAt: () => version, resolvePeer: () => version })
  assert.equal(assessPublishedManifest(manifest.name, manifest.version, manifest, host('0.1.7-alpha.1')).status, 'incompatible')
  assert.equal(assessPublishedManifest(manifest.name, manifest.version, manifest, host('0.1.7-rc.2')).status, 'checked')
})

test('hoisted host peers are resolved through node_modules ancestors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-market-preflight-'))
  try {
    const app = join(root, 'app')
    const dsh = join(app, 'node_modules', '@deepseek-ai', 'dsh')
    const agent = join(app, 'node_modules', '@deepseek-ai', 'dsh-agent')
    await mkdir(dsh, { recursive: true })
    await mkdir(agent, { recursive: true })
    await writeFile(join(dsh, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' }))
    await writeFile(join(agent, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-agent', version: '0.2.1-rc.5' }))

    const manifest = {
      name: 'dsh-better-sidebar', version: '0.30.1',
      peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.2-rc.1' },
    }
    const result = assessPublishedManifest(manifest.name, manifest.version, manifest, {
      findHost: () => dsh,
      versionAt: () => '0.2.1-rc.5',
      resolvePeer: (host, peer) => readResolvedPackageVersion(join(host, 'package.json'), peer),
    })
    assert.equal(result.status, 'incompatible')
    assert.deepEqual(result.mismatches.map(x => x.name), ['@deepseek-ai/dsh-agent'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('update preflight uses the host prerelease semantics', () => {
  assert.equal(assessUpdateRequirements({ engines: { dsh: '^0.2.1' } }, '0.3.0-rc.1', {}).length, 1)
  assert.deepEqual(assessUpdateRequirements({ engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' } }, '0.2.1-rc.5', {}), [])
  assert.deepEqual(assessUpdateRequirements({ peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.1-rc.1' } }, '0.2.1-rc.5', { '@deepseek-ai/dsh-agent': '0.2.1-rc.5' }), [])
  assert.deepEqual(
    assessUpdateRequirements({ peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.2-rc.1' } }, '0.2.1-rc.5', { '@deepseek-ai/dsh-agent': '0.2.1-rc.5' }).map(x => x.name),
    ['@deepseek-ai/dsh-agent'],
  )
})

test('metadata check requests the exact target and ignores mismatched registry responses', async () => {
  let requested
  let returnedVersion = '2.0.0'
  const adapters = {
    findHost: () => '/selected/capsule/dsh', versionAt: () => '1.0.0', resolvePeer: () => '1.0.0',
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
