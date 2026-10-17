import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MARKER, patchMarketClient, patchMarketIndex, patchOfficialMarket } from '../scripts/patch-official-market-tarball.mjs'

const INDEX_SOURCE = [
  'function source(value, path) {',
  '\tswitch (object.type) {',
  '\t\tcase "npm": return { type: "npm" };',
  '\t\tdefault: return fail(`${path}.type`, "must be \\"npm\\" or \\"git\\"");',
  '\t}',
  '}',
  'function marketInstallTarget(name, version) {',
  '\tconst { source: from } = version;',
  '\tif (from.type === "npm") return { spec: `${name}@${version.version}` };',
  '\treturn { spec: `git+${from.url.endsWith(".git") ? from.url : `${from.url}.git`}#${from.commit}` };',
  '}',
].join('\n')

const CLIENT_SOURCE = [
  'function sourceFacts(name, version) {',
  '\t\t\tconst { source } = version;',
  '\t\t\tif (source.type === "npm") return [{ kind: "package", value: name }];',
  '\t\t\treturn [{ kind: "repository", value: source.url }, { kind: "commit", value: source.commit }];',
  '}',
].join('\n')

test('the index accepts a tarball source, installs exactly its URL and rejects the unsafe shapes', () => {
  const patched = patchMarketIndex(INDEX_SOURCE)
  assert.ok(patched.includes(MARKER))
  assert.ok(patched.includes('case "tarball"'))
  assert.ok(patched.includes('must be \\"npm\\", \\"git\\" or \\"tarball\\"'))
  assert.ok(patched.includes('if (from.type === "tarball") return { spec: from.url };'))
  assert.ok(patched.indexOf('from.type === "tarball"') < patched.indexOf('git+${from.url'), 'the tarball branch comes before the git fallthrough')
  assert.ok(patched.includes('["https:"]'), 'only https tarballs')
  assert.ok(patched.includes('tgz|tar'), 'only .tgz or .tar.gz')
  assert.equal(patchMarketIndex(patched), patched, 'idempotent')
})

test('the client shows a tarball source as its origin instead of a missing commit', () => {
  const patched = patchMarketClient(CLIENT_SOURCE)
  assert.ok(patched.includes('if (source.type === "tarball") return [{ kind: "repository", value: source.url }];'))
  assert.ok(patched.indexOf('"tarball"') < patched.indexOf('source.commit'))
  assert.equal(patchMarketClient(patched), patched)
})

test('a changed upstream seam fails closed instead of patching a guess', () => {
  assert.throws(() => patchMarketIndex(INDEX_SOURCE.replace('default: return fail', 'default: fail')), /index source seam changed/u)
  assert.throws(() => patchMarketIndex(INDEX_SOURCE.replace('return { spec: `git+', 'return { spec: `g+')), /install target seam changed/u)
  assert.throws(() => patchMarketClient(CLIENT_SOURCE.replace('const { source } = version;', 'const source = version.source;')), /source-facts seam changed/u)
})

test('cores without the market are skipped and a half-present market is refused', async t => {
  const app = await mkdtemp(path.join(os.tmpdir(), 'market-tarball-'))
  t.after(() => rm(app, { recursive: true, force: true }))
  assert.deepEqual(await patchOfficialMarket(app), { applied: false, reason: 'core-has-no-plugin-market' })

  const scope = path.join(app, 'node_modules', '@deepseek-ai')
  await mkdir(path.join(scope, 'dsh-plugin-market-index', 'lib'), { recursive: true })
  await writeFile(path.join(scope, 'dsh-plugin-market-index', 'lib', 'index.js'), INDEX_SOURCE)
  await assert.rejects(patchOfficialMarket(app), /only partly present/u)

  await mkdir(path.join(scope, 'dsh-client-ui-plugin-market', 'lib'), { recursive: true })
  await writeFile(path.join(scope, 'dsh-client-ui-plugin-market', 'lib', 'client.js'), CLIENT_SOURCE)
  const result = await patchOfficialMarket(app)
  assert.equal(result.applied, true)
  assert.ok((await readFile(path.join(scope, 'dsh-plugin-market-index', 'lib', 'index.js'), 'utf8')).includes(MARKER))
  assert.ok((await readFile(path.join(scope, 'dsh-client-ui-plugin-market', 'lib', 'client.js'), 'utf8')).includes(MARKER))
})

test('every platform build applies the market tarball adaptation after the loopback one', async () => {
  for (const [file, loopback, market] of [
    ['scripts/build-windows.ps1', 'patch-loopback-connection.mjs', 'patch-official-market-tarball.mjs'],
    ['scripts/build-linux.sh', 'patch-loopback-connection.mjs', 'patch-official-market-tarball.mjs'],
    ['scripts/build-macos.sh', 'patch-loopback-connection.mjs', 'patch-official-market-tarball.mjs'],
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.ok(source.includes(market), `${file} must apply ${market}`)
    assert.ok(source.indexOf(loopback) < source.indexOf(market), `${file} order`)
  }
})
