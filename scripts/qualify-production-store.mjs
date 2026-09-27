// Real pnpm, closed local registry, disposable products, production cleaner.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, readFile, rename, readdir, lstat, rm, symlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { cleanPluginStores } from '../launcher/store-maintenance.mjs'
import { acquireProductMutationLock, layoutForRoot } from '../launcher/portable-core.mjs'

const exec = promisify(execFile)
const mode = process.argv[2] || 'copy'
assert.ok(['copy', 'hardlink'].includes(mode))
const cycles = Number(process.argv[3] || 10)
assert.ok(Number.isSafeInteger(cycles) && cycles > 0 && cycles <= 10)
const repository = process.cwd()
const pnpm = path.resolve('app/node_modules/pnpm/bin/pnpm.cjs')
await mkdir('build', { recursive: true })
const root = await mkdtemp(path.resolve(`build/production-store-${mode}-`))
const product = path.join(root, 'product')
const tarballs = {}
const evidence = { schemaVersion: 1, mode, product, cycles: [], checks: [], passed: false }
for (const version of ['1.0.0', '2.0.0', '3.0.0']) {
  const directory = path.join(root, version, 'package')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'portable-retention-fixture', version, main: 'index.js' }))
  await writeFile(path.join(directory, 'index.js'), `module.exports='${version}'`)
  const tarball = path.join(root, `${version}.tgz`)
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-czf', tarball, '-C', path.dirname(directory), 'package'], { windowsHide: true })
  tarballs[version] = await readFile(tarball)
}
let registry, requests = 0
const server = createServer((request, response) => {
  requests++
  if (request.url.endsWith('.tgz')) return response.end(tarballs[request.url.split('/').pop().slice(0, -4)])
  const versions = Object.fromEntries(Object.keys(tarballs).map(version => [version, { name: 'portable-retention-fixture', version,
    dist: { integrity: 'sha512-' + createHash('sha512').update(tarballs[version]).digest('base64'), tarball: `${registry}/${version}.tgz` } }]))
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ name: 'portable-retention-fixture', versions, 'dist-tags': { latest: '2.0.0' } }))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
registry = `http://127.0.0.1:${server.address().port}`
const manifest = version => JSON.stringify({ name: 'retention-probe', private: true, dependencies: { 'portable-retention-fixture': version } })
const environments = [product, path.join(product, 'environments/work')].map(base => ({
  base, profile: path.join(base, 'data/dsh-home/profiles/web'), store: path.join(base, 'data/pnpm-store'),
}))
async function install(cwd, store, offline, method = mode) {
  await exec(process.execPath, [pnpm, 'install', '--ignore-scripts', '--no-frozen-lockfile', ...(offline ? ['--offline'] : []),
    '--store-dir', store, `--config.cache-dir=${path.join(root, 'metadata')}`, '--registry', registry,
    '--fetch-retries=0', `--package-import-method=${method}`], { cwd, windowsHide: true, timeout: 30000,
    env: { ...process.env, CI: 'true' } })
}
async function content(store) {
  const files = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(filename)
      else files.push({ name: path.relative(store, filename), bytes: (await lstat(filename)).size })
    }
  }
  await walk(path.join(store, 'v11/files'))
  return files.sort((a, b) => a.name.localeCompare(b.name))
}
try {
  for (const environment of environments) {
    await mkdir(environment.profile, { recursive: true })
    for (const version of ['1.0.0', '3.0.0', '2.0.0']) {
      await writeFile(path.join(environment.profile, 'package.json'), manifest(version))
      await install(environment.profile, environment.store, false)
      if (version === '1.0.0') await rename(path.join(environment.profile, 'node_modules'), path.join(environment.profile, '.node_modules.dsh-portable-backup-123-456'))
      if (version === '3.0.0') {
        // pnpm keeps prior virtual-store packages in node_modules. Remove this
        // disposable installation, so v3 is genuinely unreferenced in both modes.
        const obsolete = path.join(environment.profile, 'node_modules')
        assert.ok(!path.relative(product, obsolete).startsWith('..'))
        await rm(obsolete, { recursive: true, force: true })
      }
    }
  }
  await new Promise(resolve => server.close(resolve))
  evidence.registryClosed = true
  evidence.registryRequests = requests
  const before = await Promise.all(environments.map(item => content(item.store)))
  const context = { root: product, runtimeRoot: repository }
  const release = await acquireProductMutationLock(layoutForRoot(product))
  try { await assert.rejects(cleanPluginStores(context), /shared Portable components/) }
  finally { await release() }
  evidence.checks.push('live product writer rejected')
  const require = createRequire(path.join(repository, 'app/package.json'))
  const { withFileLock } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href)
  await withFileLock(path.join(environments[1].profile, 'package.json'), () =>
    assert.rejects(cleanPluginStores(context), /writer lock/), { waitMs: 0 })
  evidence.checks.push('official writer in second environment rejected')
  await writeFile(path.join(environments[1].profile, 'package.json'), manifest('9.9.9'))
  await assert.rejects(cleanPluginStores(context), { code: 'STORE_UNRESOLVED_MANIFEST' })
  assert.deepEqual(await Promise.all(environments.map(item => content(item.store))), before)
  await writeFile(path.join(environments[1].profile, 'package.json'), manifest('2.0.0'))
  evidence.checks.push('unknown recovery graph preserves both stores')
  // A private pnpm proxy fails exactly the cleaner's post-prune verification.
  // The real package manager still performs preparation/prune; no production
  // fault-injection switch is added to the cleaner or to the public route.
  const faultRuntime = path.join(root, 'fault-runtime')
  const modules = path.join(faultRuntime, 'app/node_modules')
  await mkdir(path.join(modules, '@deepseek-ai'), { recursive: true })
  await mkdir(path.join(modules, 'pnpm/bin'), { recursive: true })
  await writeFile(path.join(faultRuntime, 'app/package.json'), '{}')
  for (const name of ['yaml', '@deepseek-ai/dsh-atomic-write'])
    await symlink(path.join(repository, 'app/node_modules', name), path.join(modules, name), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(path.join(modules, 'pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.11.0' }))
  const failureFlag = path.join(faultRuntime, 'fail-verification')
  const registrationFlag = path.join(faultRuntime, 'register-foreign-project')
  const foreign = path.join(root, 'foreign-project')
  await mkdir(foreign)
  await writeFile(registrationFlag, 'register after initial inspection')
  await writeFile(failureFlag, 'owned failure injection')
  await writeFile(path.join(modules, 'pnpm/bin/pnpm.cjs'), `
    const fs = require('node:fs'); const path = require('node:path'); const {spawnSync} = require('node:child_process');
    if (process.argv.includes('--package-import-method=copy') && fs.existsSync(${JSON.stringify(failureFlag)})) process.exit(42);
    const result = spawnSync(process.execPath, [${JSON.stringify(pnpm)}, ...process.argv.slice(2)], {stdio:'inherit', windowsHide:true});
    if (result.status === 0 && process.argv.includes('--package-import-method=hardlink') && fs.existsSync(${JSON.stringify(registrationFlag)})) {
      const store = process.argv[process.argv.indexOf('--store-dir') + 1];
      const registry = path.join(store, 'v11/projects'); fs.mkdirSync(registry, {recursive:true});
      const entry = path.join(registry, '000000000000000000000000000000ff');
      try { fs.symlinkSync(${JSON.stringify(foreign)}, entry, ${JSON.stringify(process.platform === 'win32' ? 'junction' : 'dir')}); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    process.exit(result.status ?? 1);
  `)
  await assert.rejects(cleanPluginStores({ ...context, runtimeRoot: faultRuntime }), { code: 'STORE_SHARED_REGISTRY' })
  assert.deepEqual(await Promise.all(environments.map(item => content(item.store))), before)
  await unlink(registrationFlag)
  for (const environment of environments) await unlink(path.join(environment.store, 'v11/projects/000000000000000000000000000000ff'))
  evidence.checks.push('foreign consumer registered after preparation blocks pruning and preserves both stores')
  await assert.rejects(cleanPluginStores({ ...context, runtimeRoot: faultRuntime }), { code: 'STORE_OFFLINE_VERIFY_FAILED' })
  for (const environment of environments) {
    const pins = (await readdir(path.join(environment.base, 'data'))).filter(name => name.startsWith('.store-maintenance-'))
    assert.ok(pins.length > 0, 'failed verification must retain physical recovery pins')
    assert.equal(JSON.parse(await readFile(path.join(environment.profile, 'package.json'))).dependencies['portable-retention-fixture'], '2.0.0')
    for (const pin of pins) assert.equal(JSON.parse(await readFile(path.join(environment.base, 'data', pin, 'owner.json'))).retained, true)
  }
  await unlink(failureFlag)
  assert.equal((await cleanPluginStores({ ...context, runtimeRoot: faultRuntime })).complete, true)
  evidence.checks.push('post-prune verification failure retains pins; same-process retry succeeds and reclaims them')
  let stableFiles
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const cleaned = await cleanPluginStores(context)
    assert.equal(cleaned.complete, true)
    assert.equal(cleaned.environments, 2)
    for (const [index, environment] of environments.entries()) for (const version of ['2.0.0', '1.0.0']) {
      const verify = path.join(environment.base, `data/recovery/offline-check-${version}`)
      await mkdir(verify, { recursive: true })
      // Delete only this script's exact disposable rebuild directory.
      const modules = path.join(verify, 'node_modules')
      assert.ok(!path.relative(product, modules).startsWith('..'))
      await rm(modules, { recursive: true, force: true })
      await writeFile(path.join(verify, 'package.json'), manifest(version))
      await install(verify, environment.store, true)
      const loaded = await exec(process.execPath, ['-e', 'process.stdout.write(require("portable-retention-fixture"))'], { cwd: verify, windowsHide: true })
      assert.equal(loaded.stdout, version)
    }
    const after = await Promise.all(environments.map(item => content(item.store)))
    if (!stableFiles) {
      assert.ok(after.every((files, index) => files.length < before[index].length), 'unreferenced version must actually be reclaimed')
      stableFiles = after
    } else assert.deepEqual(after, stableFiles, 'same-version cycles must not accumulate contents')
    for (const environment of environments) assert.equal((await readdir(path.join(environment.base, 'data'))).filter(name => name.startsWith('.store-maintenance-')).length, 0)
    evidence.cycles.push({ cycle, ...cleaned, files: after.map(files => files.length) })
    console.log(JSON.stringify({ mode, cycle, passed: true }))
  }
  evidence.passed = true
} catch (error) {
  evidence.error = { code: error.code, message: error.message, stderr: error.stderr }
  throw error
} finally {
  server.close()
  await writeFile(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ output: root, passed: evidence.passed }))
}
