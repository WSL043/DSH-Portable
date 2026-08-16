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

function startNativeHost(command, args = [], options = {}) {
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
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, completion }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForPortableStatus(root, expected, nativeHost, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    if (nativeHost?.child.exitCode !== null) {
      const result = await nativeHost.completion
      assert.fail(result.stderr || result.stdout || `native host exited early with code ${result.code}`)
    }
    const result = await invokeCli(root, 'status', '--json')
    if (result.code !== 0) {
      const details = `${result.stderr}\n${result.stdout}`
      if (details.includes('Another portable launcher is already starting or stopping DSH')) {
        await delay(250)
        continue
      }
      assert.fail(details)
    }
    latest = parseCliJson(result.stdout)
    if (latest?.status === expected) return latest
    await delay(250)
  }
  assert.fail(`portable status did not become ${expected}; latest=${JSON.stringify(latest)}`)
}

async function requestMacAppQuit(nativeHost) {
  const result = await run('/usr/bin/osascript', [
    '-e',
    'tell application id "io.github.wsl043.dsh-portable" to quit',
  ])
  assert.equal(result.code, 0, result.stderr || result.stdout)
  const closed = await Promise.race([
    nativeHost.completion,
    delay(45_000).then(() => null),
  ])
  if (!closed) {
    nativeHost.child.kill('SIGTERM')
    assert.fail('native macOS host did not exit after the quit request')
  }
  assert.equal(closed.code, 0, closed.stderr || closed.stdout)
}

async function requestLinuxAppQuit(nativeHost) {
  nativeHost.child.kill('SIGTERM')
  const closed = await Promise.race([
    nativeHost.completion,
    delay(30_000).then(() => null),
  ])
  if (!closed) {
    nativeHost.child.kill('SIGKILL')
    assert.fail('native Linux host did not exit after SIGTERM')
  }
  assert.ok(closed.code === 0 || closed.signal === 'SIGTERM', closed.stderr || closed.stdout)
}

async function invokeCli(root, ...args) {
  return run(nodeFor(root), [cliFor(root), ...args], { cwd: root })
}

function parseCliJson(stdout) {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  return line ? JSON.parse(line) : null
}

async function cli(root, ...args) {
  const result = await invokeCli(root, ...args)
  assert.equal(result.code, 0, result.stderr || result.stdout)
  return parseCliJson(result.stdout)
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

let nativeHost = null

if (process.platform === 'win32') {
  for (const name of ['DeepSeek-Herness.exe']) {
    assert.equal(await exists(path.join(originalRoot, name)), true, `missing Windows entry: ${name}`)
  }
  const launched = await run(path.join(originalRoot, 'DeepSeek-Herness.exe'), ['--no-browser', '--json'], { cwd: originalRoot })
  assert.equal(launched.code, 0, launched.stderr || launched.stdout)
  } else if (process.platform === 'darwin') {
  const app = path.join(originalRoot, 'DSH-Portable.app')
  const executable = path.join(app, 'Contents', 'MacOS', 'DSH-Portable')
  assert.equal(await exists(executable), true, `missing macOS entry: ${executable}`)
  assert.equal(await exists(path.join(app, 'Contents', 'Resources', 'DSH-Portable.icns')), true)
    nativeHost = startNativeHost('/usr/bin/open', ['-n', '-W', app, '--args', '--skip-update-check'], {
    cwd: originalRoot,
    env: { ...process.env, DSH_PORTABLE_NO_BROWSER: '1', DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' },
    })
  } else if (process.platform === 'linux') {
    const executable = path.join(originalRoot, 'DeepSeek-Herness')
    assert.equal(await exists(executable), true, `missing Linux entry: ${executable}`)
    nativeHost = startNativeHost(executable, [], {
      cwd: originalRoot,
      env: { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' },
    })
  } else {
  throw new Error(`unsupported smoke-test platform: ${process.platform}`)
}

const running = process.platform === 'darwin' || process.platform === 'linux'
  ? await waitForPortableStatus(originalRoot, 'running', nativeHost)
  : await cli(originalRoot, 'status', '--json')
assert.equal(running.status, 'running')
await assertWebReady(running.url)

if (process.platform === 'win32') {
  const stopped = await run(path.join(originalRoot, 'DeepSeek-Herness.exe'), ['stop', '--no-browser', '--json'], { cwd: originalRoot })
  assert.equal(stopped.code, 0, stopped.stderr || stopped.stdout)
} else {
  const stopped = process.platform === 'darwin'
    ? await run(path.join(originalRoot, 'Stop DSH-Portable.command'), [], { cwd: originalRoot })
    : await invokeCli(originalRoot, 'stop', '--json')
  assert.equal(stopped.code, 0, stopped.stderr || stopped.stdout)
}
assert.equal((await cli(originalRoot, 'status', '--json')).status, 'stopped')
if (nativeHost && process.platform === 'darwin') await requestMacAppQuit(nativeHost)
if (nativeHost && process.platform === 'linux') await requestLinuxAppQuit(nativeHost)

const movedRoot = `${originalRoot} moved ü`
await renameWithRetry(originalRoot, movedRoot)
const moved = await cli(movedRoot, 'start', '--no-browser', '--json')
assert.equal(moved.status, 'started')
assert.equal(moved.migration?.moved, true)
await assertWebReady(moved.url)
assert.equal((await cli(movedRoot, 'stop', '--json')).status, 'stopped')

console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, movedRoot, status: 'passed' }))
