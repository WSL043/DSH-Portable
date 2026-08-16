import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { classifyProductVersion } from '../scripts/version-policy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')

test('stable and release-candidate versions have unambiguous GitHub channels', () => {
  assert.deepEqual(classifyProductVersion('0.2.0'), {
    version: '0.2.0',
    tag: 'v0.2.0',
    channel: 'stable',
    prerelease: false,
    windowsVersion: '0.2.0.65534',
    macBuildVersion: '2000999',
  })
  assert.deepEqual(classifyProductVersion('0.3.0-rc.4'), {
    version: '0.3.0-rc.4',
    tag: 'v0.3.0-rc.4',
    channel: 'candidate',
    prerelease: true,
    windowsVersion: '0.3.0.4',
    macBuildVersion: '3000004',
  })
  for (const invalid of ['v0.2.0', '0.2', '0.2.0-rc', '0.2.0-rc.0', '0.2.0-beta.1']) {
    assert.throws(() => classifyProductVersion(invalid), /stable or release-candidate version/i)
  }
})

test('all finished-product manifests use the same stable product version', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.version, '0.2.1')

  const sources = await Promise.all([
    read('installer/windows/DSH-Portable.iss'),
    read('installer/windows/DeepSeek-Herness.iss'),
    read('launcher/windows/DSH-Bootstrap.cs'),
    read('launcher/windows/DSH-Portable.cs'),
    read('launcher/windows/DSH-Command.cs'),
    read('launcher/linux/Cargo.toml'),
    read('launcher/linux/package.json'),
    read('launcher/linux/tauri.conf.json'),
    read('launcher/macos/Info.plist'),
    read('launcher/macos/Info-installed.plist'),
    read('launcher/macos/Info-stop-installed.plist'),
  ])
  for (const source of sources) assert.match(source, /0\.2\.1/)
  assert.doesNotMatch(sources.join('\n'), /0\.2\.1-rc\./)
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
