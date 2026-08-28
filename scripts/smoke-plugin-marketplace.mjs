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
const runtimeEntry = path.join(root, 'launcher', 'runtime-entry.mjs')
const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-plugin-smoke-'))
const environment = {
  ...process.env,
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
  DSH_PORTABLE_STATE_ROOT: stateRoot,
  DSH_PORTABLE_RUNTIME_CACHE: path.join(stateRoot, 'runtime-cache'),
}
const capsuleCore = await import(pathToFileURL(path.join(root, 'launcher', 'runtime-capsule.mjs')))
const prepared = await capsuleCore.ensureRuntimeCapsule(root, { env: environment })
const marketManifest = JSON.parse(await readFile(
  path.join(prepared.runtimeRoot, 'app', 'node_modules', '@wsl043', 'dsh-portable-plugin-market', 'package.json'),
  'utf8',
))
const { DEFAULT_PLUGINS } = await import(pathToFileURL(path.join(root, 'launcher', 'default-plugins.mjs')).href)
const components = JSON.parse(await readFile(path.join(root, 'licenses', 'COMPONENTS.json'), 'utf8'))
const configuredDefaultNames = (components.defaultPlugins ?? []).map(plugin => plugin.package)
const productDefaults = DEFAULT_PLUGINS.filter(plugin => configuredDefaultNames.includes(plugin.name))
assert.deepEqual(productDefaults.map(plugin => plugin.name).sort(), configuredDefaultNames.sort(), 'finished-product default metadata')
let running = false

function lastJsonLine(output) {
  for (const line of String(output ?? '').trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line) } catch { /* keep looking */ }
  }
  throw new Error(`Portable CLI did not return JSON: ${output}`)
}

async function runCli(...args) {
  const command = prepared.mode === 'capsule'
    ? [runtimeEntry, 'portable-cli.mjs', ...args, '--json']
    : [cli, ...args, '--json']
  const { stdout, stderr } = await runFile(process.execPath, command, {
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
  for (const plugin of productDefaults) {
    assert.match(JSON.stringify(installed.installed), new RegExp(plugin.name), `${plugin.name} is absent from the normal Installed list`)
  }

  const profileRoot = path.join(stateRoot, 'data', 'dsh-home', 'profiles', 'web')
  const profileManifest = JSON.parse(await readFile(path.join(profileRoot, 'package.json'), 'utf8'))
  for (const plugin of productDefaults) {
    assert.equal(
      String(profileManifest.dependencies?.[plugin.name]).replaceAll('\\', '/'),
      plugin.version,
      `${plugin.name} must enter the normal npm plugin lifecycle after offline installation`,
    )
  }
  const updates = await getJson(host.url, '/dsh-market/updates?force=1', 3)
  for (const plugin of productDefaults) {
    const defaultUpdate = updates.updates?.[plugin.name]
    assert.equal(defaultUpdate?.kind, 'npm', `${plugin.name} is outside the market update lifecycle`)
    assert.equal(defaultUpdate?.version, plugin.version, `the market did not resolve ${plugin.name}`)
    assert.equal(defaultUpdate?.updateAvailable, false, `the market must not offer the bundled ${plugin.name} version as an update`)
  }

  const node = process.platform === 'win32'
    ? path.join(root, 'runtime', 'node', 'node.exe')
    : path.join(root, 'runtime', 'node', 'bin', 'node')
  const dsh = path.join(prepared.runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
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
  if (configuredDefaultNames.includes('dsh-chat-manager')) {
    assert.match(dumped.stdout, /id:\s*ui-workspace\s+[\s\S]{0,160}?disabled:\s*true/, 'official ui-workspace row is not disabled')
    assert.match(dumped.stdout, /id:\s*ui-workspace-session-delete\s+[\s\S]{0,160}?name:\s*dsh-chat-manager/, 'chat manager row is not active')
    const pluginPatch = await readFile(path.join(profileRoot, 'node_modules', 'dsh-chat-manager', 'cordis.patch.yml'), 'utf8')
    assert.match(pluginPatch, /id:\s*ui-workspace-session-delete/)
    assert.match(pluginPatch, /id:\s*ui-workspace[\s\S]+disabled:\s*true/)
  }
  if (configuredDefaultNames.includes('dsh-image-viewer')) assert.match(dumped.stdout, /name:\s*dsh-image-viewer/, 'image viewer is not active')

  const catalog = await getJson(host.url, '/dsh-market/registry', 3)
  const plugins = catalog.registry?.plugins
  assert.ok(Array.isArray(plugins) && plugins.length >= 1_000, 'the normalized live catalog is unexpectedly small')
  assert.ok(plugins.some(plugin => Array.isArray(plugin.screenshots) && plugin.screenshots.length > 0), 'registry exposes real plugin images')
  assert.ok(plugins.every(plugin => typeof plugin.name === 'string' && typeof plugin.url === 'string' && typeof plugin.page === 'string'))
  const identities = plugins.map(canonicalPluginIdentity)
  assert.equal(new Set(identities).size, identities.length, 'the normalized catalog contains duplicate repositories')

  process.stdout.write(`[plugin-marketplace-smoke] ${catalog.registry.plugins.length} live plugins; ${productDefaults.length} compatible defaults verified through the official web profile\n`)
} finally {
  if (running) await stop().catch(() => {})
  await rm(stateRoot, { recursive: true, force: true })
}
