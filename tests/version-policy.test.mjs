import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { classifyProductVersion } from '../scripts/version-policy.mjs'
import { renderReleaseNotes } from '../scripts/render-release-notes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('stable and release-candidate versions have unambiguous GitHub channels', () => {
  assert.deepEqual(classifyProductVersion('0.2.0'), {
    version: '0.2.0',
    tag: 'v0.2.0',
    channel: 'stable',
    updateChannelTag: 'update-channel-stable',
    prerelease: false,
    windowsVersion: '0.2.0.65534',
    macBuildVersion: '2000999',
  })
  assert.deepEqual(classifyProductVersion('0.3.0-rc.4'), {
    version: '0.3.0-rc.4',
    tag: 'v0.3.0-rc.4',
    channel: 'candidate',
    updateChannelTag: 'update-channel-candidate',
    prerelease: true,
    windowsVersion: '0.3.0.4',
    macBuildVersion: '3000004',
  })
  for (const invalid of ['v0.2.0', '0.2', '0.2.0-rc', '0.2.0-rc.0', '0.2.0-beta.1']) {
    assert.throws(() => classifyProductVersion(invalid), /stable or release-candidate version/i)
  }
})

test('release notes always link to the immutable release tag being published', () => {
  const source = '[download](https://github.com/WSL043/DSH-Portable/releases/latest/download/file.zip)'
  assert.equal(
    renderReleaseNotes(source, 'v0.3.0-rc.1', '0.1.1-rc.1'),
    '[download](https://github.com/WSL043/DSH-Portable/releases/download/v0.3.0-rc.1/file.zip)',
  )
  assert.throws(() => renderReleaseNotes(source, 'latest', '0.1.1-rc.1'), /tag/i)
})

test('candidate notes recommend a self-contained candidate package instead of the stable bootstrap', () => {
  const source = '{{PRODUCT_VERSION}}\n{{CHANNEL_UPGRADE_NOTICE_ZH}}\n{{CHANNEL_UPGRADE_NOTICE_EN}}\n[download](https://github.com/WSL043/DSH-Portable/releases/latest/download/{{WINDOWS_PRIMARY_FILENAME}})\n{{WINDOWS_PRIMARY_GUIDE_ZH}}\n{{WINDOWS_PRIMARY_GUIDE_EN}}'
  const candidate = renderReleaseNotes(source, 'v0.4.0-rc.2', '0.1.1-rc.1')
  assert.match(candidate, /^0\.4\.0-rc\.2$/m)
  assert.match(candidate, /v0\.4\.0-rc\.2\/DSH-Portable-windows-x64-offline\.zip/)
  assert.doesNotMatch(candidate, /DSH-Portable-windows-x64\.exe/)
  assert.match(candidate, /candidate/i)
  assert.match(candidate, /候选/)
  assert.match(candidate, /解压/)
  assert.match(candidate, /Extract/)
  assert.doesNotMatch(candidate, /\{\{[^}]+\}\}/)

  const stable = renderReleaseNotes(source, 'v0.4.0', '0.1.1-rc.1')
  assert.match(stable, /^0\.4\.0$/m)
  assert.match(stable, /v0\.4\.0\/DSH-Portable-windows-x64\.exe/)
  assert.match(stable, /双击/)
  assert.match(stable, /Run it once/)
  assert.doesNotMatch(stable, /candidate channel|候选更新通道/i)
  assert.doesNotMatch(stable, /\{\{[^}]+\}\}/)
})

test('stable release notes never describe the product as a candidate', async () => {
  const template = await read('templates/RELEASE-NOTES.md')
  const stable = renderReleaseNotes(template, 'v0.4.0', '0.1.1-rc.1')
  assert.doesNotMatch(stable, /\{\{DSH_VERSION\}\}/)
  assert.match(stable, /0\.1\.1-rc\.1/)
  assert.doesNotMatch(stable, /候选版|candidate(?: release| build| version)?/i)
  assert.match(stable, /0\.4\.0 是正式版/)
  assert.match(stable, /0\.4\.0 is a stable release/i)
})

test('all finished-product manifests use the same declared product version', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const policy = classifyProductVersion(manifest.version)
  assert.ok(['stable', 'candidate'].includes(policy.channel))
  const desktopBridge = JSON.parse(await read('desktop-bridge/package.json'))
  const appLock = JSON.parse(await read('app/package-lock.json'))
  assert.equal(desktopBridge.version, policy.version)
  assert.equal(appLock.packages['../desktop-bridge'].version, policy.version)

  const productSources = await Promise.all([
    read('installer/windows/DSH-Portable.iss'),
    read('installer/windows/DeepSeek-Herness.iss'),
    read('launcher/linux/Cargo.toml'),
    read('launcher/linux/package.json'),
    read('launcher/linux/tauri.conf.json'),
    read('launcher/macos/Info.plist'),
    read('launcher/macos/Info-installed.plist'),
    read('launcher/macos/Info-stop-installed.plist'),
  ])
  const productVersion = new RegExp(regexEscape(policy.version))
  for (const source of productSources) assert.match(source, productVersion)
  const windowsSources = await Promise.all([
    read('launcher/windows/DSH-Bootstrap.cs'),
    read('launcher/windows/DSH-Portable.cs'),
    read('launcher/windows/DSH-Command.cs'),
  ])
  const windowsVersion = new RegExp(regexEscape(policy.windowsVersion))
  for (const source of windowsSources) assert.match(source, windowsVersion)
  assert.doesNotMatch([...productSources, ...windowsSources].join('\n'), new RegExp(`${regexEscape(policy.version)}-rc\\.`))
})

test('publishing derives prerelease state from the product version instead of user input', async () => {
  const workflow = await read('.github/workflows/publish.yml')
  assert.doesNotMatch(workflow, /^\s{6}prerelease:/m)
  assert.match(workflow, /scripts\/version-policy\.mjs/)
  assert.match(workflow, /--draft/)
  assert.match(workflow, /--draft=false/)
  assert.match(workflow, /--prerelease=false/)
  assert.match(workflow, /--latest/)
})
