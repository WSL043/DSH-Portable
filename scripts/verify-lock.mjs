import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [lockfileName, upstreamName] = process.argv.slice(2)
if (!lockfileName || !upstreamName) {
  console.error('usage: node verify-lock.mjs <package-lock.json> <upstream.lock.json>')
  process.exit(2)
}

const [lockfile, upstream] = await Promise.all([
  readFile(path.resolve(lockfileName), 'utf8').then(JSON.parse),
  readFile(path.resolve(upstreamName), 'utf8').then(JSON.parse),
])

assert.equal(lockfile.lockfileVersion, 3, 'npm lockfile version must be 3')
const root = lockfile.packages?.['']
const desktopBridgePackage = '@wsl043/dsh-portable-desktop-bridge'
const settingsPackage = '@deepseek-ai/dsh-settings'
assert.deepEqual(root?.dependencies, {
  [upstream.dsh.package]: upstream.dsh.version,
  [settingsPackage]: upstream.dsh.version,
  [desktopBridgePackage]: 'file:../desktop-bridge',
  [upstream.pluginMarket.package]: 'file:vendor/dsh-portable-plugin-market',
  [upstream.pnpm.package]: upstream.pnpm.version,
})
const installed = lockfile.packages?.[`node_modules/${upstream.dsh.package}`]
assert.equal(installed?.version, upstream.dsh.version, 'pinned DSH version')
assert.equal(installed?.integrity, upstream.dsh.integrity, 'pinned DSH integrity')
assert.equal(installed?.license, 'MIT', 'DSH npm license')
assert.equal(lockfile.packages?.[`node_modules/${settingsPackage}`]?.version, upstream.dsh.version, 'plugin market settings runtime')
const packageManager = lockfile.packages?.[`node_modules/${upstream.pnpm.package}`]
assert.equal(packageManager?.version, upstream.pnpm.version, 'pinned pnpm version')
assert.equal(packageManager?.integrity, upstream.pnpm.integrity, 'pinned pnpm integrity')
assert.equal(packageManager?.license, 'MIT', 'pnpm npm license')
assert.equal(packageManager?.bin?.pnpm, 'bin/pnpm.mjs', 'pnpm executable entry')
const pluginMarket = lockfile.packages?.[`node_modules/${upstream.pluginMarket.package}`]
assert.equal(pluginMarket?.resolved, 'vendor/dsh-portable-plugin-market', 'plugin market must resolve only to the reviewed Portable component')
assert.equal(pluginMarket?.link, true, 'plugin market must stay a local link')
const pluginMarketSource = lockfile.packages?.['vendor/dsh-portable-plugin-market']
assert.equal(pluginMarketSource?.version, upstream.pluginMarket.version, 'pinned Portable plugin market version')
assert.equal(pluginMarketSource?.license, 'MIT', 'plugin market license')
const desktopBridge = lockfile.packages?.[`node_modules/${desktopBridgePackage}`]
assert.equal(desktopBridge?.resolved, '../desktop-bridge', 'desktop bridge must resolve only to the local product component')
assert.equal(desktopBridge?.link, true, 'desktop bridge must stay an npm local link')
const desktopBridgeSource = lockfile.packages?.['../desktop-bridge']
assert.equal(desktopBridgeSource?.name, desktopBridgePackage, 'desktop bridge link target identity')
assert.equal(desktopBridgeSource?.license, 'Apache-2.0', 'desktop bridge license')

const defaultPlugins = upstream.defaultPlugins ?? {}
assert.deepEqual(Object.keys(defaultPlugins).sort(), ['chatManager', 'imageViewer'], 'Portable must pin only the two reviewed defaults')
assert.deepEqual(Object.values(defaultPlugins).map(plugin => plugin.package), ['dsh-image-viewer', 'dsh-chat-manager'])
assert.equal(new Set(Object.values(defaultPlugins).map(plugin => plugin.filename)).size, 2, 'default plugin archive names must be unique')
for (const plugin of Object.values(defaultPlugins)) {
  assert.ok(['stable', 'prerelease'].includes(plugin.releaseChannel), `${plugin.package} release channel`)
  if (plugin.releaseChannel === 'stable') {
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/, `${plugin.package} pinned stable version`)
  } else {
    assert.match(plugin.version, /^\d+\.\d+\.\d+-beta\.\d+$/, `${plugin.package} pinned prerelease version`)
  }
  assert.equal(plugin.spec, plugin.version, `${plugin.package} exact lifecycle spec`)
  assert.match(plugin.url, /^https:\/\//, `${plugin.package} artifact URL`)
  assert.match(plugin.sha256, /^[0-9a-f]{64}$/, `${plugin.package} SHA-256`)
  assert.match(plugin.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, `${plugin.package} npm integrity`)
  assert.match(plugin.reviewedCommit, /^[0-9a-f]{40}$/, `${plugin.package} reviewed commit`)
  assert.equal(plugin.license, 'MIT', `${plugin.package} license`)
  assert.ok(plugin.spec, `${plugin.package} lifecycle spec`)
}

const serializedRoot = JSON.stringify(root)
for (const forbidden of ['@yanxu', 'openai-codex', 'opencode-zen', 'GenericAgent']) {
  assert.equal(serializedRoot.includes(forbidden), false, `forbidden root integration: ${forbidden}`)
}

console.log(JSON.stringify({
  dshVersion: installed.version,
  pluginMarketVersion: pluginMarketSource.version,
  pnpmVersion: packageManager.version,
  integrity: installed.integrity,
  packages: Object.keys(lockfile.packages).length,
}))
