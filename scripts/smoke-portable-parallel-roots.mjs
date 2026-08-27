import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const roots = process.argv.slice(2).map(value => path.resolve(value))
if (roots.length !== 2 || roots[0] === roots[1]) {
  throw new Error('usage: node smoke-portable-parallel-roots.mjs <first-root> <second-root>')
}

const exists = filename => access(filename).then(() => true, () => false)
const nodeFor = root => process.platform === 'win32'
  ? path.join(root, 'runtime', 'node', 'node.exe')
  : path.join(root, 'runtime', 'node', 'bin', 'node')

async function invoke(root, ...args) {
  const capsule = await exists(path.join(root, 'runtime-capsule.json'))
  const entry = capsule
    ? [path.join(root, 'launcher', 'runtime-entry.mjs'), 'portable-cli.mjs']
    : [path.join(root, 'launcher', 'portable-cli.mjs')]
  return execFileAsync(nodeFor(root), [...entry, ...args], {
    cwd: root,
    env: { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' },
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  })
}

function parseResult(result) {
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!line) throw new Error('portable CLI returned no JSON result')
  return JSON.parse(line)
}

async function command(root, ...args) {
  return parseResult(await invoke(root, ...args))
}

for (const root of roots) {
  for (const filename of [nodeFor(root), path.join(root, 'launcher', 'portable-cli.mjs')]) {
    assert.equal(await exists(filename), true, `parallel-root package file is missing: ${filename}`)
  }
}

await Promise.all(roots.map(root => invoke(root, 'stop', '--no-browser', '--json').catch(() => null)))

try {
  const [first, second] = await Promise.all([
    command(roots[0], 'start', '--no-browser', '--json'),
    command(roots[1], 'start', '--no-browser', '--json'),
  ])
  assert.equal(first.status, 'started')
  assert.equal(second.status, 'started')
  assert.notEqual(first.pid, second.pid, 'parallel Portable roots shared a DSH process')
  assert.notEqual(first.port, second.port, 'parallel Portable roots shared a loopback port')

  const [firstRunning, secondRunning] = await Promise.all([
    command(roots[0], 'status', '--no-browser', '--json'),
    command(roots[1], 'status', '--no-browser', '--json'),
  ])
  assert.equal(firstRunning.status, 'running')
  assert.equal(secondRunning.status, 'running')

  const firstStopped = await command(roots[0], 'stop', '--no-browser', '--json')
  const secondStillRunning = await command(roots[1], 'status', '--no-browser', '--json')
  assert.equal(firstStopped.status, 'stopped')
  assert.equal(secondStillRunning.status, 'running')
  assert.equal(secondStillRunning.pid, second.pid)
  assert.equal(secondStillRunning.port, second.port)

  const response = await fetch(secondStillRunning.url, { redirect: 'manual' })
  assert.ok(response.status >= 200 && response.status < 500, `second Portable root returned HTTP ${response.status}`)
  assert.ok((await response.text()).length > 0, 'second Portable root became empty after stopping the first root')

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    roots: roots.length,
    isolatedProcesses: true,
    isolatedPorts: true,
    independentStop: true,
  })}\n`)
} finally {
  await Promise.all(roots.map(root => invoke(root, 'stop', '--no-browser', '--json').catch(() => null)))
}
