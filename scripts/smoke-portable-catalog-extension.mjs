import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const [rootArgument, retiredExtensionId = 'session-delete'] = process.argv.slice(2)
if (!rootArgument || !retiredExtensionId) {
  throw new Error('usage: node smoke-portable-catalog-extension.mjs <finished-product-root> <retired-extension-id>')
}

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

async function stop() {
  const result = await runCli('stop')
  assert.ok(['stopped', 'not-running'].includes(result.status), `unexpected stop status: ${result.status}`)
  running = false
}

try {
  const host = await runCli('start', '--no-browser')
  assert.ok(['started', 'already-running'].includes(host.status), `unexpected start status: ${host.status}`)
  running = true

  const state = await fetch(new URL('/api/dsh-portable/extensions', host.url))
  assert.notEqual(state.status, 200, 'the retired extension catalog route is disabled')

  const preview = await fetch(new URL(`/api/dsh-portable/extensions/${encodeURIComponent(retiredExtensionId)}`, host.url))
  assert.notEqual(preview.status, 200, 'retired catalog entries are not addressable')

  process.stdout.write('[portable-catalog-extension-smoke] extension catalog route is disabled in the stable finished product\n')
} finally {
  if (running) await stop().catch(() => {})
}
