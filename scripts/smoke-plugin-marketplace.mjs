import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const [rootArgument] = process.argv.slice(2)
if (!rootArgument) throw new Error('usage: node smoke-plugin-marketplace.mjs <finished-product-root>')

const root = path.resolve(rootArgument)
const cli = path.join(root, 'launcher', 'portable-cli.mjs')
const environment = { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' }
let running = false

function lastJsonLine(output) {
  for (const line of String(output ?? '').trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line) } catch { /* keep looking */ }
  }
  throw new Error(`Portable CLI did not return JSON: ${output}`)
}

async function runCli(...args) {
  const { stdout, stderr } = await runFile(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: environment,
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (stderr?.trim()) process.stderr.write(stderr)
  return lastJsonLine(stdout)
}

async function getJson(base, pathname, attempts = 1) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(new URL(pathname, base), { signal: AbortSignal.timeout(40_000) })
    const body = await response.json().catch(() => ({}))
    if (response.ok) return body
    last = new Error(`${pathname} returned HTTP ${response.status}: ${JSON.stringify(body)}`)
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1_000 * attempt))
  }
  throw last
}

async function stop() {
  const result = await runCli('stop')
  assert.ok(['stopped', 'not-running'].includes(result.status), `unexpected stop status: ${result.status}`)
  running = false
}

try {
  const host = await runCli('start', '--no-browser')
  assert.ok(['started', 'already-running'].includes(host.status), `unexpected start status: ${host.status}`)
  running = true

  const status = await getJson(host.url, '/dsh-market/status')
  assert.equal(status.version, '1.15.0')
  assert.equal(status.restart, false, 'the Portable shell owns restart and update lifecycle')
  assert.equal(status.pnpm === true || status.pnpm?.available === true, true, 'the market must see Portable bundled pnpm')

  const installed = await getJson(host.url, '/dsh-market/installed')
  assert.equal(installed.profile, 'web')
  assert.equal(typeof installed.installed, 'object')

  const catalog = await getJson(host.url, '/dsh-market/registry', 3)
  assert.ok(Array.isArray(catalog.registry?.plugins) && catalog.registry.plugins.length > 0)
  assert.ok(catalog.registry.plugins.some(plugin => Array.isArray(plugin.screenshots) && plugin.screenshots.length > 0), 'registry exposes real plugin images')
  assert.ok(catalog.registry.plugins.every(plugin => typeof plugin.name === 'string' && typeof plugin.url === 'string'))

  process.stdout.write(`[plugin-marketplace-smoke] ${catalog.registry.plugins.length} live plugins; visual entries present; locale is provided by DSH client runtime\n`)
} finally {
  if (running) await stop().catch(() => {})
}
