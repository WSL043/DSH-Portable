import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { classifyProductVersion } from '../scripts/version-policy.mjs'
import { renderReleaseNotes, upstreamLockNameForTag } from '../scripts/render-release-notes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('stable, alpha, beta, and release-candidate versions preserve their conventional stage', () => {
  assert.deepEqual(classifyProductVersion('0.2.0'), {
    version: '0.2.0',
    tag: 'v0.2.0',
    channel: 'stable',
    stage: 'stable',
    updateChannelTag: 'update-channel-stable',
    prerelease: false,
    windowsVersion: '0.2.0.65534',
    macBuildVersion: '2000999',
  })
  assert.deepEqual(classifyProductVersion('0.6.0-alpha.1'), {
    version: '0.6.0-alpha.1',
    tag: 'v0.6.0-alpha.1',
    channel: 'candidate',
    stage: 'alpha',
    updateChannelTag: 'update-channel-candidate',
    prerelease: true,
    windowsVersion: '0.6.0.10001',
    macBuildVersion: '6000101',
  })
  assert.deepEqual(classifyProductVersion('0.6.0-beta.2'), {
    version: '0.6.0-beta.2',
    tag: 'v0.6.0-beta.2',
    channel: 'candidate',
    stage: 'beta',
    updateChannelTag: 'update-channel-candidate',
    prerelease: true,
    windowsVersion: '0.6.0.30002',
    macBuildVersion: '6000402',
  })
  assert.deepEqual(classifyProductVersion('0.3.0-rc.4'), {
    version: '0.3.0-rc.4',
    tag: 'v0.3.0-rc.4',
    channel: 'candidate',
    stage: 'rc',
    updateChannelTag: 'update-channel-candidate',
    prerelease: true,
    windowsVersion: '0.3.0.50004',
    macBuildVersion: '3000704',
  })
  for (const invalid of ['v0.2.0', '0.2', '0.2.0-rc', '0.2.0-rc.0', '0.2.0-preview.1', '0.2.0-alpha.200']) {
    assert.throws(() => classifyProductVersion(invalid), /stable, alpha, beta, or release-candidate version/i)
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

test('prerelease notes name the actual maturity stage and all prereleases use the preview lock', () => {
  const source = '{{RELEASE_INTRO_ZH}}\n{{RELEASE_INTRO_EN}}'
  const alpha = renderReleaseNotes(source, 'v0.6.0-alpha.1', '0.1.2-alpha.5')
  const beta = renderReleaseNotes(source, 'v0.6.0-beta.1', '0.1.2-alpha.5')
  const rc = renderReleaseNotes(source, 'v0.6.0-rc.1', '0.1.2-alpha.5')
  assert.match(alpha, /Alpha/)
  assert.match(alpha, /开发阶段/)
  assert.match(beta, /Beta/)
  assert.match(beta, /真实测试/)
  assert.match(rc, /RC/)
  assert.match(rc, /最终验证/)
  for (const tag of ['v0.6.0-alpha.1', 'v0.6.0-beta.1', 'v0.6.0-rc.1']) {
    assert.equal(upstreamLockNameForTag(tag), 'upstream.preview.lock.json')
  }
  assert.equal(upstreamLockNameForTag('v0.6.0'), 'upstream.lock.json')
})

test('stable release notes never describe the product as a candidate', async () => {
  const template = await read('templates/RELEASE-NOTES.md')
  const stable = renderReleaseNotes(template, 'v0.4.0', '0.1.1-rc.1')
  assert.doesNotMatch(stable, /\{\{DSH_VERSION\}\}/)
  assert.match(stable, /0\.1\.1-rc\.1/)
  assert.doesNotMatch(stable, /候选版|candidate(?: release| build| version)?/i)
  assert.doesNotMatch(stable, /0\.4\.0 是正式版|0\.4\.0 is a stable release/i)
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
    read('launcher/linux/Cargo.toml'),
    read('launcher/linux/package.json'),
    read('launcher/linux/tauri.conf.json'),
    read('launcher/macos/Info.plist'),
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
