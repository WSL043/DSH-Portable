import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const [rootArgument] = process.argv.slice(2)
if (!rootArgument) throw new Error('usage: node smoke-plugin-marketplace.mjs <finished-product-root>')

const root = path.resolve(rootArgument)
const cli = path.join(root, 'launcher', 'portable-cli.mjs')
const marketManifest = JSON.parse(await readFile(
  path.join(root, 'app', 'node_modules', '@wsl043', 'dsh-portable-plugin-market', 'package.json'),
  'utf8',
))
const { DEFAULT_PLUGINS } = await import(pathToFileURL(path.join(root, 'launcher', 'default-plugins.mjs')).href)
const defaultSessionDelete = DEFAULT_PLUGINS.find(plugin => plugin.name === 'dsh-native-session-delete')
assert.ok(defaultSessionDelete?.version, 'the finished product does not declare its bundled session-delete version')
const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-plugin-smoke-'))
const environment = {
  ...process.env,
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
  DSH_PORTABLE_STATE_ROOT: stateRoot,
}
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

function canonicalPluginIdentity(plugin) {
  const value = String(plugin.url ?? '').trim().toLowerCase()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
  return value
}

try {
  const host = await runCli('start', '--no-browser')
  assert.ok(['started', 'already-running'].includes(host.status), `unexpected start status: ${host.status}`)
  running = true

  const status = await getJson(host.url, '/dsh-market/status')
  assert.equal(status.version, marketManifest.version)
  assert.equal(status.restart, false, 'the Portable shell owns restart and update lifecycle')
  assert.equal(status.pnpm === true || status.pnpm?.available === true, true, 'the market must see Portable bundled pnpm')

  const installed = await getJson(host.url, '/dsh-market/installed')
  assert.equal(installed.profile, 'web')
  assert.equal(typeof installed.installed, 'object')
  assert.match(JSON.stringify(installed.installed), /dsh-native-session-delete/, 'default plugin is absent from the normal Installed list')

  const profileRoot = path.join(stateRoot, 'data', 'dsh-home', 'profiles', 'web')
  const profileManifest = JSON.parse(await readFile(path.join(profileRoot, 'package.json'), 'utf8'))
  assert.deepEqual(
    Object.keys(profileManifest.dependencies ?? {}).filter(name => name === 'dsh-native-session-delete'),
    ['dsh-native-session-delete'],
    'the fresh profile must contain exactly one default session-delete package',
  )
  assert.equal(
    String(profileManifest.dependencies['dsh-native-session-delete']).replaceAll('\\', '/'),
    defaultSessionDelete.version,
    'the offline seed must enter the normal npm plugin lifecycle after installation',
  )
  const updates = await getJson(host.url, '/dsh-market/updates?force=1', 3)
  const defaultUpdate = updates.updates?.['dsh-native-session-delete']
  assert.equal(defaultUpdate?.kind, 'npm', 'the default plugin is outside the market update lifecycle')
  assert.equal(defaultUpdate?.version, defaultSessionDelete.version, 'the market did not resolve the installed default version')
  assert.equal(defaultUpdate?.updateAvailable, false, 'the market must not offer the installed default version as an update')

  const node = process.platform === 'win32'
    ? path.join(root, 'runtime', 'node', 'node.exe')
    : path.join(root, 'runtime', 'node', 'bin', 'node')
  const dsh = path.join(root, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const dumped = await runFile(node, [dsh, '--profile', 'web', '--dump-config'], {
    cwd: path.join(root, 'workspace'),
    env: {
      ...environment,
      DSH_HOME: path.join(stateRoot, 'data', 'dsh-home'),
      DSH_PORTABLE: '1',
      pnpm_config_store_dir: path.join(stateRoot, 'data', 'pnpm-store'),
    },
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.match(dumped.stdout, /id:\s*ui-workspace\s+[\s\S]{0,160}?disabled:\s*true/, 'official ui-workspace row is not disabled')
  assert.match(dumped.stdout, /id:\s*ui-workspace-session-delete\s+[\s\S]{0,160}?name:\s*dsh-native-session-delete/, 'native delete row is not active')

  const pluginPatch = await readFile(path.join(profileRoot, 'node_modules', 'dsh-native-session-delete', 'cordis.patch.yml'), 'utf8')
  assert.match(pluginPatch, /id:\s*ui-workspace-session-delete/)
  assert.match(pluginPatch, /id:\s*ui-workspace[\s\S]+disabled:\s*true/)

  const catalog = await getJson(host.url, '/dsh-market/registry', 3)
  const plugins = catalog.registry?.plugins
  assert.ok(Array.isArray(plugins) && plugins.length >= 1_000, 'the normalized live catalog is unexpectedly small')
  assert.ok(plugins.some(plugin => Array.isArray(plugin.screenshots) && plugin.screenshots.length > 0), 'registry exposes real plugin images')
  assert.ok(plugins.every(plugin => typeof plugin.name === 'string' && typeof plugin.url === 'string' && typeof plugin.page === 'string'))
  const identities = plugins.map(canonicalPluginIdentity)
  assert.equal(new Set(identities).size, identities.length, 'the normalized catalog contains duplicate repositories')

  process.stdout.write(`[plugin-marketplace-smoke] ${catalog.registry.plugins.length} live plugins; default native session delete installed once through the official web profile\n`)
} finally {
  if (running) await stop().catch(() => {})
  await rm(stateRoot, { recursive: true, force: true })
}
