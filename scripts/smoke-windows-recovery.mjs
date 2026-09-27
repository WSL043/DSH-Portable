import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.argv[2] && path.resolve(process.argv[2])
const output = process.argv[3] && path.resolve(process.argv[3])
assert.equal(process.platform, 'win32')
assert.ok(root && output && process.argv.includes('--disposable'), 'requires a disposable product and evidence directory')
await mkdir(output, { recursive: true })
const env = { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: path.join(root, 'acceptance-runtime-cache'),
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' }
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
