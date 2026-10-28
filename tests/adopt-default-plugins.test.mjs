import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { main, provenanceCommit, rewriteDefaultPluginsModule, selectRelease, supportsCore } from '../scripts/adopt-default-plugins.mjs'

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


test('preview rewriting leaves the stable export unchanged and rejects unknown exports', async () => {
  const source = await readFile(new URL('../launcher/default-plugins.mjs', import.meta.url), 'utf8')
  const lock = JSON.parse(await readFile(new URL('../upstream.preview.lock.json', import.meta.url), 'utf8'))
  const marker = 'export const PREVIEW_DEFAULT_PLUGINS = Object.freeze(['
  const updated = rewriteDefaultPluginsModule(source, Object.values(lock.defaultPlugins), 'PREVIEW_DEFAULT_PLUGINS')
  assert.equal(updated.slice(0, updated.indexOf(marker)), source.slice(0, source.indexOf(marker)))
  assert.equal(rewriteDefaultPluginsModule(updated, Object.values(lock.defaultPlugins), 'PREVIEW_DEFAULT_PLUGINS'), updated)
  assert.throws(() => rewriteDefaultPluginsModule(source, [], 'ANOTHER_EXPORT'), /Unknown default-plugin export/)
})

test('adoption validates all archives and refreshes the selected store before writing any pins', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'dsh-adopt-scope-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const oldFetch = globalThis.fetch, oldOutput = process.env.GITHUB_OUTPUT, oldLog = console.log
  const messages = []
  console.log = line => messages.push(JSON.parse(line))
  t.after(() => { globalThis.fetch = oldFetch; console.log = oldLog; if (oldOutput === undefined) delete process.env.GITHUB_OUTPUT; else process.env.GITHUB_OUTPUT = oldOutput })
  delete process.env.GITHUB_OUTPUT
  const registry = 'https://registry.npmjs.org/'
  const bytes = Buffer.from('new reviewed archive'), unchangedBytes = Buffer.from('unchanged reviewed archive')
  const pin = (name, version, archive) => ({ package: name, repository: 'WSL043/' + name, version, spec: version,
    url: registry + name + '/-/' + name + '-' + version + '.tgz', filename: name + '.tgz', license: 'MIT',
    sha256: createHash('sha256').update(archive).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64') })
  const current = { ...pin('dsh-fixture', '0.9.0-beta.1', Buffer.from('old')), releaseChannel: 'prerelease' }
  const same = { ...pin('dsh-same', '2.0.0', unchangedBytes), releaseChannel: 'stable' }
  const next = pin('dsh-fixture', '1.0.0', bytes)
  const core = '0.2.2-alpha.2'
  const lock = JSON.stringify({ dsh: { version: core }, defaultPlugins: { changed: current, same } })
  const module = 'export const DEFAULT_PLUGINS = Object.freeze([\n{ name: "stable-sentinel" }\n].map(Object.freeze))\n'
    + 'export const PREVIEW_DEFAULT_PLUGINS = Object.freeze([\n{ name: "preview-sentinel" }\n].map(Object.freeze))\n'
  const original = new Map([
    ['upstream.lock.json', lock], ['upstream.preview.lock.json', lock], ['launcher/default-plugins.mjs', module],
    ['scripts/default-plugin-store/pnpm-lock.yaml', 'stable store'], ['scripts/default-plugin-store/pnpm-lock.preview.yaml', 'preview store'],
  ])
  for (const [name, text] of original) { await mkdir(path.dirname(path.join(fixture, name)), { recursive: true }); await writeFile(path.join(fixture, name), text) }
  let badArchive = false, requests = 0
  globalThis.fetch = async url => {
    requests++
    if (url === registry + current.package) return Response.json({ versions: { [next.version]: release(core, { dist: { integrity: next.integrity, tarball: next.url } }) } })
    if (url === registry + same.package) return Response.json({ versions: { [same.version]: release(core) } })
    if (url === next.url) return new Response(bytes)
    if (url === same.url) return new Response(badArchive ? Buffer.from('corrupt unchanged archive') : unchangedBytes)
    if (url === registry + '-/npm/v1/attestations/' + next.package + '@' + next.version) return Response.json(attestation({
      name: next.package, version: next.version, sha512Hex: createHash('sha512').update(bytes).digest('hex'),
      uri: 'git+https://github.com/' + next.repository + '@refs/heads/main', commit: 'c'.repeat(40),
    }))
    throw new Error('Unexpected fixture request: ' + url)
  }
  const args = ['--lock=upstream.preview.lock.json', '--write']
  const assertOriginal = async () => { for (const [name, text] of original) assert.equal(await readFile(path.join(fixture, name), 'utf8'), text, name) }
  const output = path.join(fixture, 'github-output')
  const sentinel = 'unchanged output\n'
  await writeFile(output, sentinel)
  process.env.GITHUB_OUTPUT = output
  for (const [args, error] of [
    [['--write', '--lock', 'unknown.json'], /Unknown adoption write target/],
    [['--write', '--lok=upstream.preview.lock.json'], /Unknown option/],
    [['--lock=upstream.preview.lock.json', '--wirte'], /Unknown option/],
  ]) await assert.rejects(main(args, { root: fixture }), error)
  assert.equal(requests, 0)
  assert.equal(await readFile(output, 'utf8'), sentinel)
  assert.deepEqual(messages, [])
  await assertOriginal()
  badArchive = true
  let refreshed = false
  await assert.rejects(main(args, { root: fixture, refreshStoreLock: async () => { refreshed = true } }), /archive does not match its pin/)
  assert.equal(refreshed, false)
  assert.equal(await readFile(output, 'utf8'), sentinel)
  assert.deepEqual(messages, [])
  await assertOriginal()
  badArchive = false
  await assert.rejects(main(args, { root: fixture, refreshStoreLock: async () => { throw new Error('pnpm refresh failed') } }), /pnpm refresh failed/)
  assert.equal(await readFile(output, 'utf8'), sentinel)
  assert.deepEqual(messages, [])
  await assertOriginal()
  await main(['--lock=upstream.preview.lock.json'], { root: fixture, refreshStoreLock: async () => { throw new Error('dry run must not refresh') } })
  await assertOriginal()
  assert.equal(messages.length, 1)
  assert.equal(messages[0].changed, true)
  assert.ok(messages[0].plugins.some(plugin => plugin.endsWith(' (selected)')))
  assert.match(await readFile(output, 'utf8'), /changed=true/)
  assert.doesNotMatch(await readFile(output, 'utf8'), /\(adopted\)/)
  await writeFile(output, sentinel)
  messages.length = 0
  let expectedStore = path.join(fixture, 'scripts/default-plugin-store/pnpm-lock.preview.yaml')
  const refreshStoreLock = async (_pins, archives, selected) => { assert.equal(selected, expectedStore); assert.deepEqual(archives.get(same.package), unchangedBytes); return 'refreshed store\n' }
  await main(args, { root: fixture, refreshStoreLock })
  assert.ok(messages[0].plugins.some(plugin => plugin.endsWith(' (adopted)')))
  assert.match(await readFile(output, 'utf8'), /changed=true/)
  const adopted = JSON.parse(await readFile(path.join(fixture, 'upstream.preview.lock.json'), 'utf8'))
  assert.equal(adopted.defaultPlugins.changed.version, next.version)
  assert.equal(adopted.defaultPlugins.changed.releaseChannel, 'stable')
  assert.equal(await readFile(expectedStore, 'utf8'), 'refreshed store\n')
  assert.equal(await readFile(path.join(fixture, 'upstream.lock.json'), 'utf8'), lock)
  assert.equal(await readFile(path.join(fixture, 'scripts/default-plugin-store/pnpm-lock.yaml'), 'utf8'), 'stable store')
  const modulePath = path.join(fixture, 'launcher/default-plugins.mjs')
  const previewModule = await import(pathToFileURL(modulePath).href)
  assert.equal(previewModule.DEFAULT_PLUGINS[0].name, 'stable-sentinel')
  assert.equal(previewModule.PREVIEW_DEFAULT_PLUGINS[0].version, next.version)
  const previewText = await readFile(modulePath, 'utf8')
  const previewLock = await readFile(path.join(fixture, 'upstream.preview.lock.json'), 'utf8')
  expectedStore = path.join(fixture, 'scripts/default-plugin-store/pnpm-lock.yaml')
  await main(['--write'], { root: fixture, refreshStoreLock })
  const stableModule = await import(pathToFileURL(modulePath).href + '?stable')
  assert.equal(stableModule.DEFAULT_PLUGINS[0].version, next.version)
  const marker = 'export const PREVIEW_DEFAULT_PLUGINS'
  const stableText = await readFile(modulePath, 'utf8')
  assert.equal(stableText.slice(stableText.indexOf(marker)), previewText.slice(previewText.indexOf(marker)))
  assert.equal(await readFile(path.join(fixture, 'upstream.preview.lock.json'), 'utf8'), previewLock)
  assert.equal(await readFile(path.join(fixture, 'scripts/default-plugin-store/pnpm-lock.preview.yaml'), 'utf8'), 'refreshed store\n')
})
