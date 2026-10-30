import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeDataTarget } from '../launcher/data-paths.mjs'

const root = process.argv[2] && path.resolve(process.argv[2])
const output = process.argv[3] && path.resolve(process.argv[3])
assert.equal(process.platform, 'win32')
assert.ok(root && output && process.argv.includes('--disposable'), 'requires a disposable product and evidence directory')
await mkdir(output, { recursive: true })
const env = { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: path.join(root, 'acceptance-runtime-cache'),
  // The recovery check compares the profile before and after; the official market is covered by its own tests.
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1', DSH_PORTABLE_OFFICIAL_MARKET: '0' }
for (const name of ['DSH_PORTABLE_STATE_ROOT', 'DSH_PORTABLE_RUNTIME_ROOT', 'DSH_PORTABLE_ENVIRONMENT']) delete env[name]
if (process.argv.includes('--source-overlay')) env.DSH_PORTABLE_STARTUP_SOURCE_CACHE = '0'
const evidence = { passed: false, sourceOverlay: process.argv.includes('--source-overlay'), cases: [] }
const execute = (exe, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  const timer = setTimeout(() => { child.kill(); reject(new Error('Recovery acceptance timed out')) }, 90000)
  child.stdout.on('data', value => { stdout += value.toString('utf8') })
  child.stderr.on('data', value => { stderr += value.toString('utf8') })
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error) })
  child.stdin.end(input)
})
const cli = async command => {
  const result = await execute(path.join(root, 'runtime/node/node.exe'),
    [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', command, '--no-browser', '--json'])
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
}
const recovery = async (name, input, pattern, expected = 0, args = []) => {
  const result = await execute(path.join(root, 'DSH-Recovery.exe'), args, input)
  await writeFile(path.join(output, `${name}.txt`), result.stdout + result.stderr)
  assert.equal(result.code, expected, result.stderr)
  assert.match(result.stdout, pattern)
  evidence.cases.push(name)
}
// Renames are confined to this explicitly disposable tree and always restored.
const absent = async (relative, check) => {
  const target = path.resolve(root, relative)
  assert.ok(target.startsWith(root + path.sep))
  const saved = `${target}.recovery-acceptance`
  assert.equal(await lstat(saved).catch(error => { if (error.code === 'ENOENT') return null; throw error }), null)
  await rename(target, saved)
  try { await check() } finally { await rename(saved, target) }
}
assert.equal((await cli('status')).status, 'stopped')
let started = false
try {
  await recovery('check', '', /OK\s+runtime\/node\/node.exe/, 0, ['--check'])
  await absent('runtime/node/node.exe', () => recovery('missing-node', '', /MISSING\s+runtime\/node\/node.exe/, 1, ['--check']))
  await absent('launcher/runtime-entry.mjs', () => recovery('missing-entry', '', /MISSING\s+launcher\/runtime-entry.mjs/, 1, ['--check']))
  const normalCache = env.DSH_PORTABLE_RUNTIME_CACHE
  env.DSH_PORTABLE_RUNTIME_CACHE = path.join(root, 'acceptance-missing-capsule-cache')
  try {
    await absent('runtime/DSH-App.dshpack', () => recovery('missing-capsule-guidance', '3\n0\n', /Runtime preparation failed[\s\S]*full offline package[\s\S]*Exit code: 1/))
  } finally { env.DSH_PORTABLE_RUNTIME_CACHE = normalCache }
  // Prepare this fixture's own cache/resolvers through the actual shipped entry.
  await cli('repair')
  await recovery('no-op-repair', '3\n0\n', /no generated components need repair/)
  const resolver = path.join(root, 'data/dsh-home/profiles/node_modules/@deepseek-ai/dsh')
  assert.ok((await lstat(resolver)).isSymbolicLink())
  const original = await realpath(resolver)
  assert.ok(original.startsWith(path.join(root, 'acceptance-runtime-cache') + path.sep), 'never mutate a shared runtime')
  await unlink(resolver)
  try {
    await recovery('missing-resolver', '2\n0\n', /Checks failed/)
    await recovery('repaired-resolver', '3\n0\n', /Generated components repaired/)
    assert.equal(await realpath(resolver), original)
  } finally {
    if (!await lstat(resolver).catch(error => { if (error.code === 'ENOENT') return null; throw error })) await cli('repair')
  }
  const profile = path.join(root, 'data/dsh-home/profiles/web/package.json')
  const runtime = path.join(root, 'data/runtime')
  const journal = path.join(runtime, 'startup-profile-recovery.json')
  const profileBefore = await readFile(profile)
  const manifestBefore = JSON.parse(profileBefore)
  assert.equal(await lstat(journal).catch(error => { if (error.code === 'ENOENT') return null; throw error }), null)
  const runtimeFilesBefore = new Set(await readdir(runtime))
  const missingBundle = 'dsh-recovery-missing-fixture'
  const installedName = 'dsh-recovery-installed-fixture'
  assert.ok(!manifestBefore.dsh.profile.bundles.includes(installedName))
  manifestBefore.dsh.profile.bundles.push(installedName)
  const communityIndex = manifestBefore.dsh.profile.bundles.length
  const officialIndex = manifestBefore.dsh.profile.bundles.indexOf('@deepseek-ai/dsh-web-app') + 1
  const throwingName = 'dsh-recovery-throw-fixture'
  const modules = path.join(path.dirname(profile), 'node_modules')
  const installedDirectory = path.join(modules, installedName)
  const throwingDirectory = path.join(modules, throwingName)
  let createdModules = false, createdInstalledFixture = false, createdThrowingFixture = false, profileFixtureWritten = false
  assert.ok(officialIndex > 0, 'requires the installed official web profile bundle')
  const readProfile = async () => JSON.parse(await readFile(profile, 'utf8'))
  try {
    // Empty official profiles need no node_modules. Seed our own installed bundle,
    // never depend on community defaults or replace an existing modules tree.
    const canonicalRoot = await realpath(root)
    const relativeProfile = path.relative(canonicalRoot, await realpath(path.dirname(profile)))
    assert.ok(relativeProfile && relativeProfile !== '..' && !relativeProfile.startsWith('..' + path.sep) && !path.isAbsolute(relativeProfile), 'never mutate an external profile tree')
    const existingModules = await lstat(modules).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (!existingModules) { await mkdir(modules); createdModules = true }
    const modulesInfo = await lstat(modules)
    assert.ok(modulesInfo.isDirectory() && !modulesInfo.isSymbolicLink(), 'fixture modules must be a real directory')
    const relativeModules = path.relative(canonicalRoot, await realpath(modules))
    assert.ok(relativeModules && relativeModules !== '..' && !relativeModules.startsWith('..' + path.sep) && !path.isAbsolute(relativeModules), 'never mutate an external modules tree')
    for (const directory of [installedDirectory, throwingDirectory]) {
      assert.equal(await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error }), null, 'fixture package must not already exist')
    }
    await mkdir(installedDirectory); createdInstalledFixture = true
    await writeFile(path.join(installedDirectory, 'package.json'), JSON.stringify({ name: installedName, version: '1.0.0',
      type: 'module', exports: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    await writeFile(path.join(installedDirectory, 'index.js'), 'export default function recoveryFixture() {}\n')
    await writeFile(path.join(installedDirectory, 'cordis.patch.yml'), '[]\n')
    profileFixtureWritten = true
    await writeFile(profile, JSON.stringify(manifestBefore, null, 2))
    const missing = structuredClone(manifestBefore)
    assert.ok(!missing.dsh.profile.bundles.includes(missingBundle))
    missing.dsh.profile.bundles.push(missingBundle)
    await writeFile(profile, JSON.stringify(missing, null, 2))
    await recovery('missing-plugin-diagnosis', '5\n0\n', /dsh-recovery-missing-fixture[^\r\n]*missing/)
    await recovery('pause-missing-community', `6\n${missing.dsh.profile.bundles.length}\n0\n`, /"status":"paused"/)
    assert.deepEqual(await readProfile(), manifestBefore)
    await recovery('refuse-restore-unavailable', '7\n1\n0\n', /RECOVERY_BUNDLE_UNAVAILABLE[\s\S]*Exit code: 1/)
    assert.deepEqual(await readProfile(), manifestBefore)
    assert.equal(JSON.parse(await readFile(journal, 'utf8')).pauses[0].name, missingBundle)
    await unlink(journal)
    await recovery('protect-installed-official', `6\n${officialIndex}\n0\n`, /RECOVERY_BUNDLE_PROTECTED[\s\S]*Exit code: 1/)
    assert.deepEqual(await readProfile(), manifestBefore)
    await recovery('pause-installed-community', `6\n${communityIndex}\n0\n`, /"status":"paused"/)
    assert.deepEqual((await readProfile()).dependencies, manifestBefore.dependencies)
    assert.ok(!(await readProfile()).dsh.profile.bundles.includes(installedName))
    await recovery('restore-installed-community', '7\n1\n0\n', /"status":"restored"/)
    assert.deepEqual(await readProfile(), manifestBefore)
    assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')).pauses, [])
    await mkdir(throwingDirectory); createdThrowingFixture = true
    await writeFile(path.join(throwingDirectory, 'package.json'), JSON.stringify({ name: throwingName, version: '1.0.0',
      type: 'module', exports: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    await writeFile(path.join(throwingDirectory, 'index.js'), 'import {writeFileSync} from "node:fs"; writeFileSync(new URL("./executed", import.meta.url), "executed"); throw new Error("DSH_RECOVERY_THROW_FIXTURE");\n')
    await writeFile(path.join(throwingDirectory, 'cordis.patch.yml'), `- insert:\n    - id: recovery-throw-fixture\n      name: ${throwingName}\n`)
    const throwingProfile = structuredClone(manifestBefore)
    throwingProfile.dsh.profile.bundles.push(throwingName)
    await writeFile(profile, JSON.stringify(throwingProfile, null, 2))
    started = true
    await execute(path.join(root, 'runtime/node/node.exe'), [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', 'start', '--no-browser', '--json'])
    await cli('stop')
    started = false
    const errorLog = path.join(root, 'data/logs/dsh.stderr.log')
    assert.equal(await readFile(path.join(throwingDirectory, 'executed'), 'utf8'), 'executed', 'the fixture must actually execute in the official runtime')
    assert.match(await readFile(errorLog, 'utf8'), /recovery-throw-fixture \(dsh-recovery-throw-fixture\): failed to import/)
    evidence.cases.push('throwing-plugin-executed')
    await recovery('pause-throwing-community', `6\n${throwingProfile.dsh.profile.bundles.length}\n0\n`, /"status":"paused"/)
    assert.deepEqual(await readProfile(), manifestBefore)
    await unlink(path.join(throwingDirectory, 'executed'))
    const previousErrors = await readFile(errorLog, 'utf8')
    started = true
    await cli('start')
    await cli('stop')
    started = false
    const newErrors = await readFile(errorLog, 'utf8')
    assert.doesNotMatch(newErrors.startsWith(previousErrors) ? newErrors.slice(previousErrors.length) : newErrors, /recovery-throw-fixture/)
    assert.equal(await lstat(path.join(throwingDirectory, 'executed')).catch(error => { if (error.code === 'ENOENT') return null; throw error }), null)
    evidence.cases.push('paused-throwing-plugin-startup')
    await writeFile(profile, '{ malformed fixture')
    await recovery('malformed-profile-diagnosis', '2\n0\n', /Checks failed/)
    assert.equal(await readFile(profile, 'utf8'), '{ malformed fixture')
  } finally {
    if (started) { await cli('stop'); started = false }
    if (profileFixtureWritten) await writeFile(profile, profileBefore)
    if (createdInstalledFixture || createdThrowingFixture || createdModules) {
      const retired = path.dirname(await safeDataTarget(root, `acceptance/recovery-fixture-retired/${process.pid}-${Date.now()}/receipt.json`))
      const retire = async (directory, name) => {
        const destination = path.join(retired, name)
        assert.equal(await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error }), null)
        await rename(directory, destination)
        evidence.fixtureRetired ??= []
        evidence.fixtureRetired.push(path.relative(root, destination))
      }
      if (createdThrowingFixture) await retire(throwingDirectory, throwingName)
      if (createdInstalledFixture) await retire(installedDirectory, installedName)
      if (createdModules) {
        const entries = await readdir(modules)
        if (entries.length) evidence.fixtureModulesRetained = { path: path.relative(root, modules), reason: 'unknown-content', entries: entries.slice(0, 32) }
        assert.equal(entries.length, 0, 'new fixture modules contain unknown entries; leave them intact')
        await retire(modules, 'empty-node_modules')
      }
      await writeFile(path.join(retired, 'receipt.json'), JSON.stringify(evidence.fixtureRetired, null, 2))
    }
    await unlink(journal).catch(error => { if (error.code !== 'ENOENT') throw error })
    for (const name of await readdir(runtime)) {
      if (runtimeFilesBefore.has(name) || !/^startup-profile-backup-[a-f0-9-]+\.json$/.test(name)) continue
      const target = path.resolve(runtime, name)
      assert.ok(target.startsWith(runtime + path.sep) && (await lstat(target)).isFile())
      await unlink(target)
    }
    assert.deepEqual(await readFile(profile), profileBefore)
  }
  const sentinel = path.join(root, 'workspace/recovery-acceptance-sentinel.txt')
  await mkdir(path.dirname(sentinel), { recursive: true })
  assert.equal(await lstat(sentinel).catch(error => { if (error.code === 'ENOENT') return null; throw error }), null)
  await writeFile(sentinel, 'workspace must survive repair')
  try {
    started = true
    await cli('start')
    await recovery('running-deferral', '3\n0\n', /Repair not performed[\s\S]*Exit code: 2/)
    assert.equal(await readFile(sentinel, 'utf8'), 'workspace must survive repair')
  } finally { await unlink(sentinel) }
  evidence.passed = true
} finally {
  try {
    if (started) await cli('stop')
    assert.equal((await cli('status')).status, 'stopped')
  } catch (error) { evidence.passed = false; throw error }
  finally { await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2)) }
}
console.log(JSON.stringify(evidence))
