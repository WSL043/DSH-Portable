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
assert.deepEqual(root?.dependencies, {
  [upstream.dsh.package]: upstream.dsh.version,
  [desktopBridgePackage]: 'file:../desktop-bridge',
  [upstream.pluginMarket.package]: upstream.pluginMarket.version,
  [upstream.pnpm.package]: upstream.pnpm.version,
})
const installed = lockfile.packages?.[`node_modules/${upstream.dsh.package}`]
assert.equal(installed?.version, upstream.dsh.version, 'pinned DSH version')
assert.equal(installed?.integrity, upstream.dsh.integrity, 'pinned DSH integrity')
assert.equal(installed?.license, 'MIT', 'DSH npm license')
const packageManager = lockfile.packages?.[`node_modules/${upstream.pnpm.package}`]
assert.equal(packageManager?.version, upstream.pnpm.version, 'pinned pnpm version')
assert.equal(packageManager?.integrity, upstream.pnpm.integrity, 'pinned pnpm integrity')
assert.equal(packageManager?.license, 'MIT', 'pnpm npm license')
assert.equal(packageManager?.bin?.pnpm, 'bin/pnpm.mjs', 'pnpm executable entry')
const pluginMarket = lockfile.packages?.[`node_modules/${upstream.pluginMarket.package}`]
assert.equal(pluginMarket?.version, upstream.pluginMarket.version, 'pinned plugin market version')
assert.equal(pluginMarket?.integrity, upstream.pluginMarket.integrity, 'pinned plugin market integrity')
assert.equal(pluginMarket?.license, 'MIT', 'plugin market npm license')
const desktopBridge = lockfile.packages?.[`node_modules/${desktopBridgePackage}`]
assert.equal(desktopBridge?.resolved, '../desktop-bridge', 'desktop bridge must resolve only to the local product component')
assert.equal(desktopBridge?.link, true, 'desktop bridge must stay an npm local link')
const desktopBridgeSource = lockfile.packages?.['../desktop-bridge']
assert.equal(desktopBridgeSource?.name, desktopBridgePackage, 'desktop bridge link target identity')
assert.equal(desktopBridgeSource?.license, 'MIT', 'desktop bridge license')

assert.deepEqual(upstream.defaultPlugins?.sessionDelete, {
  package: 'dsh-native-session-delete',
  version: '1.0.0',
  url: 'https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.0/dsh-native-session-delete.tgz',
  sha256: 'e51bbe07ca27f87b742438d15afc16319074a338688f8e28480bff084d74462e',
  integrity: 'sha512-PMcKj2vxJQbmWiXTnuuYRcAKWVqmGY1dRnbzYQDNgBhrgK2HmODWloFHFiS9t4EuWpSp7q5SsPfSjzlhdigYzg==',
  license: 'MIT',
  reviewedCommit: '5842dc611884da08c8a95e306a9e41ac0bcb7c7e',
  filename: 'dsh-native-session-delete.tgz',
}, 'locked default session-delete plugin')

const serializedRoot = JSON.stringify(root)
for (const forbidden of ['@yanxu', 'openai-codex', 'opencode-zen', 'GenericAgent']) {
  assert.equal(serializedRoot.includes(forbidden), false, `forbidden root integration: ${forbidden}`)
}

console.log(JSON.stringify({
  dshVersion: installed.version,
  pluginMarketVersion: pluginMarket.version,
  pnpmVersion: packageManager.version,
  integrity: installed.integrity,
  packages: Object.keys(lockfile.packages).length,
}))
