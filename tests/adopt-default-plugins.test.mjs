import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { provenanceCommit, rewriteDefaultPluginsModule, selectRelease, supportsCore } from '../scripts/adopt-default-plugins.mjs'

const release = (peers, extra = {}) => ({
  peerDependencies: { '@deepseek-ai/dsh-client-locale': peers, '@deepseek-ai/dsh-client-ui-slots': peers, react: '^18.2.0' },
  dist: { integrity: 'sha512-x' },
  ...extra,
})

test('a release supports a core only when every DSH peer lists that exact version', () => {
  assert.equal(supportsCore(release('0.2.0-rc.2 || 0.2.0-rc.1'), '0.2.0-rc.1'), true)
  assert.equal(supportsCore(release('0.2.0-rc.2'), '0.2.0-rc.1'), false)
  assert.equal(supportsCore({ peerDependencies: { react: '^18.2.0' } }, '0.2.0-rc.2'), false)
  const mixed = { peerDependencies: { '@deepseek-ai/dsh-client-locale': '0.2.0-rc.3', '@deepseek-ai/dsh-client-ui-slots': '0.2.0-rc.2' } }
  assert.equal(supportsCore(mixed, '0.2.0-rc.3'), false)
})

test('the newest final, non-deprecated compatible release is selected; betas and deprecated releases are skipped', () => {
  const packument = { versions: {
    '1.5.4': release('0.2.0-rc.2 || 0.2.0-rc.1'),
    '1.5.6': release('0.2.0-rc.3 || 0.2.0-rc.2'),
    '1.5.7': release('0.2.0-rc.3', { deprecated: 'broken' }),
    '1.6.0-beta.1': release('0.2.0-rc.3'),
    '1.5.10': release('0.2.0-rc.3 || 0.2.0-rc.2'),
  } }
  assert.equal(selectRelease(packument, '0.2.0-rc.3').version, '1.5.10')
  assert.equal(selectRelease(packument, '0.2.0-rc.1').version, '1.5.4')
  assert.equal(selectRelease(packument, '0.3.0'), null, 'no compatible release yet: the caller keeps the pin and waits')
})

function attestation({ name, version, sha512Hex, uri, commit }) {
  const statement = { subject: [{ name: `pkg:npm/${name}@${version}`, digest: { sha512: sha512Hex } }],
    predicate: { buildDefinition: { resolvedDependencies: [{ uri, digest: { gitCommit: commit } }] } } }
  return { attestations: [{ predicateType: 'https://slsa.dev/provenance/v1',
    bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } }] }
}

test('the reviewed commit comes from SLSA provenance bound to the tarball and the plugin repository', () => {
  const integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`
  const sha512Hex = Buffer.alloc(64, 7).toString('hex')
  const commit = 'a'.repeat(40)
  const pin = { name: 'dsh-chat-manager', version: '1.5.6', integrity, repository: 'WSL043/dsh-chat-manager' }
  const good = attestation({ ...pin, sha512Hex, uri: 'git+https://github.com/WSL043/dsh-chat-manager@refs/heads/main', commit })
  assert.equal(provenanceCommit(good, pin), commit)
  assert.throws(() => provenanceCommit(attestation({ ...pin, sha512Hex: 'b'.repeat(128), uri: 'git+https://github.com/WSL043/dsh-chat-manager@refs/heads/main', commit }), pin), /does not describe the published tarball/)
  assert.throws(() => provenanceCommit(attestation({ ...pin, sha512Hex, uri: 'git+https://github.com/someone/fork@refs/heads/main', commit }), pin), /was not built from/)
  assert.throws(() => provenanceCommit({ attestations: [] }, pin), /no SLSA provenance/)
})

test('rewriting DEFAULT_PLUGINS keeps the reviewed module shape and is idempotent', async () => {
  const source = await readFile(new URL('../launcher/default-plugins.mjs', import.meta.url), 'utf8')
  const lock = JSON.parse(await readFile(new URL('../upstream.lock.json', import.meta.url), 'utf8'))
  const pins = Object.values(lock.defaultPlugins)
  assert.equal(rewriteDefaultPluginsModule(source.replace(/\r\n/g, '\n'), pins), source.replace(/\r\n/g, '\n'))
})

test('a candidate lock rewrites only the preview plugin literal', () => {
  const source = "export const DEFAULT_PLUGINS = Object.freeze([\n  { name: 'stable' },\n].map(Object.freeze))\nexport const PREVIEW_DEFAULT_PLUGINS = Object.freeze([\n  { name: 'old' },\n].map(Object.freeze))\n"
  const pin = { package: 'dsh-image-viewer', version: '0.1.8', spec: '0.1.8', url: 'u', sha256: 's', integrity: 'i', license: 'MIT', reviewedCommit: 'c', filename: 'f' }
  const rewritten = rewriteDefaultPluginsModule(source, [pin], 'PREVIEW_DEFAULT_PLUGINS')
  assert.ok(rewritten.includes("{ name: 'stable' }"))
  assert.ok(!rewritten.includes("{ name: 'old' }"))
  assert.match(rewritten, /PREVIEW_DEFAULT_PLUGINS = Object\.freeze\(\[\n  \{\n    "name": "dsh-image-viewer"/u)
})
