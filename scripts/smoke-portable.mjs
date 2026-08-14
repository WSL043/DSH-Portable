import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { renameWithRetry } from './smoke-helpers.mjs'

const originalRoot = path.resolve(process.argv[2] ?? '')
if (!originalRoot) throw new Error('usage: node smoke-portable.mjs <extracted-DSH-Portable-root>')

const exists = (name) => access(name).then(() => true, () => false)
const nodeFor = (root) => process.platform === 'win32'
  ? path.join(root, 'runtime', 'node', 'node.exe')
  : path.join(root, 'runtime', 'node', 'bin', 'node')
const cliFor = (root) => path.join(root, 'launcher', 'portable-cli.mjs')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function cli(root, ...args) {
  const result = await run(nodeFor(root), [cliFor(root), ...args], { cwd: root })
  assert.equal(result.code, 0, result.stderr || result.stdout)
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  return line ? JSON.parse(line) : null
}

async function assertWebReady(url) {
  const response = await fetch(url, { redirect: 'manual' })
  assert.ok(response.status >= 200 && response.status < 500, `unexpected DSH HTTP status ${response.status}`)
  const text = await response.text()
  assert.ok(text.length > 0, 'DSH Web returned an empty document')
}

for (const filename of [nodeFor(originalRoot), cliFor(originalRoot), path.join(originalRoot, 'README.txt')]) {
  assert.equal(await exists(filename), true, `missing package file: ${filename}`)
}
assert.doesNotMatch(await readFile(path.join(originalRoot, 'README.txt'), 'utf8'), /build script|development history|community\.1/i)

if (process.platform === 'win32') {
  for (const name of ['DeepSeek-Herness.exe', 'Stop DeepSeek-Herness.exe']) {
    assert.equal(await exists(path.join(originalRoot, name)), true, `missing Windows entry: ${name}`)
  }
  const launched = await run(path.join(originalRoot, 'DeepSeek-Herness.exe'), ['--no-browser', '--json'], { cwd: originalRoot })
  assert.equal(launched.code, 0, launched.stderr || launched.stdout)
} else if (process.platform === 'darwin') {
  const app = path.join(originalRoot, 'DSH-Portable.app')
  const executable = path.join(app, 'Contents', 'MacOS', 'DSH-Portable')
  assert.equal(await exists(path.join(app, 'Contents', 'Resources', 'DSH-Portable.icns')), true)
  const launched = await run(executable, [], {
    cwd: originalRoot,
    env: { ...process.env, DSH_PORTABLE_NO_BROWSER: '1' },
  })
  assert.equal(launched.code, 0, launched.stderr || launched.stdout)
} else {
  throw new Error(`unsupported smoke-test platform: ${process.platform}`)
}

const running = await cli(originalRoot, 'status', '--json')
assert.equal(running.status, 'running')
await assertWebReady(running.url)

if (process.platform === 'win32') {
  const stopped = await run(path.join(originalRoot, 'Stop DeepSeek-Herness.exe'), [], { cwd: originalRoot })
  assert.equal(stopped.code, 0, stopped.stderr || stopped.stdout)
} else {
  const stopped = await run(path.join(originalRoot, 'Stop DSH-Portable.command'), [], { cwd: originalRoot })
  assert.equal(stopped.code, 0, stopped.stderr || stopped.stdout)
}
assert.equal((await cli(originalRoot, 'status', '--json')).status, 'stopped')

const movedRoot = `${originalRoot} moved ü`
await renameWithRetry(originalRoot, movedRoot)
const moved = await cli(movedRoot, 'start', '--no-browser', '--json')
assert.equal(moved.status, 'started')
assert.equal(moved.migration?.moved, true)
await assertWebReady(moved.url)
assert.equal((await cli(movedRoot, 'stop', '--json')).status, 'stopped')

console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, movedRoot, status: 'passed' }))
