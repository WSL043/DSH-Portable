import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const execFileAsync = promisify(execFile)

test('runtime dependency boundary contains official DSH, the private desktop bridge, the visual market, and its pinned package manager only', async () => {
  const [runtime, upstream, lockfile] = await Promise.all([
    read('app/package.json').then(JSON.parse),
    read('upstream.lock.json').then(JSON.parse),
    read('app/package-lock.json').then(JSON.parse),
  ])
  assert.deepEqual(runtime.dependencies, {
    '@deepseek-ai/dsh': upstream.dsh.version,
    '@wsl043/dsh-portable-desktop-bridge': 'file:../desktop-bridge',
    '@wsl043/dsh-portable-plugin-market': 'file:vendor/dsh-portable-plugin-market',
    pnpm: '11.7.0',
  })
  const serialized = JSON.stringify(runtime)
  for (const forbidden of ['@yanxu', 'openai-codex', 'opencode-zen', 'GenericAgent']) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
  const subprocessVersion = lockfile.packages['node_modules/@deepseek-ai/dsh-subprocess-local'].version
  const googleVersion = lockfile.packages['node_modules/@google/genai'].version
  const koffiVersion = lockfile.packages['node_modules/koffi'].version
  const nodePtyVersion = lockfile.packages['node_modules/node-pty'].version
  const protobufVersion = lockfile.packages['node_modules/protobufjs'].version
  assert.deepEqual(runtime.allowScripts, {
    [`@deepseek-ai/dsh-subprocess-local@${subprocessVersion}`]: true,
    [`@google/genai@${googleVersion}`]: true,
    [`koffi@${koffiVersion}`]: true,
    [`node-pty@${nodePtyVersion}`]: true,
    [`protobufjs@${protobufVersion}`]: true,
  })
})

test('upstream lock pins independently verifiable DSH and Node artifacts', async () => {
  const lock = JSON.parse(await read('upstream.lock.json'))
  assert.equal(lock.dsh.package, '@deepseek-ai/dsh')
  assert.match(lock.dsh.version, /^0\.\d+\.\d+(?:-rc\.\d+)?$/)
  assert.match(lock.dsh.integrity, /^sha512-/)
  assert.match(lock.dsh.reviewedCommit, /^[0-9a-f]{40}$/)
  assert.match(lock.dsh.noticesSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(lock.pnpm, {
    package: 'pnpm',
    version: '11.7.0',
    integrity: 'sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==',
  })
  assert.deepEqual(lock.pluginMarket, {
    package: '@wsl043/dsh-portable-plugin-market',
    version: '0.1.0-beta.3',
    catalog: 'https://awesome-dsh-plugin.com/plugins.json',
    catalogRepository: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
    implementationBasis: 'https://github.com/dsh-market/dsh-market',
    reviewedBasisTag: 'v1.21.2',
    reviewedBasisCommit: 'bb0f128ad14ee5de383412a817d53e21e6a0d7c6',
  })
  for (const [key, runtime] of Object.entries(lock.node.runtimes)) {
    assert.match(runtime.sha256, /^[0-9a-f]{64}$/, key)
    assert.match(runtime.archive, /^node-v\d+\.\d+\.\d+-(win-x64\.zip|darwin-(arm64|x64)\.tar\.gz|linux-(arm64|x64)\.tar\.xz)$/, key)
  }
})

test('committed npm lock resolves the exact reviewed DSH artifact', async () => {
  const upstream = JSON.parse(await read('upstream.lock.json'))
  const lockfile = JSON.parse(await read('app/package-lock.json'))
  const rootPackage = lockfile.packages['']
  assert.deepEqual(rootPackage.dependencies, {
    '@deepseek-ai/dsh': upstream.dsh.version,
    '@wsl043/dsh-portable-desktop-bridge': 'file:../desktop-bridge',
    '@wsl043/dsh-portable-plugin-market': 'file:vendor/dsh-portable-plugin-market',
    pnpm: upstream.pnpm.version,
  })
  const dsh = lockfile.packages['node_modules/@deepseek-ai/dsh']
  assert.equal(dsh.version, upstream.dsh.version)
  assert.equal(dsh.integrity, upstream.dsh.integrity)
  const pnpm = lockfile.packages['node_modules/pnpm']
  assert.equal(pnpm.version, upstream.pnpm.version)
  assert.equal(pnpm.integrity, upstream.pnpm.integrity)
  const pluginMarket = lockfile.packages['node_modules/@wsl043/dsh-portable-plugin-market']
  assert.equal(pluginMarket.resolved, 'vendor/dsh-portable-plugin-market')
  assert.equal(pluginMarket.link, true)
  const pluginMarketSource = lockfile.packages['vendor/dsh-portable-plugin-market']
  assert.equal(pluginMarketSource.version, upstream.pluginMarket.version)
  assert.equal(pluginMarketSource.license, 'MIT')
  const desktopBridge = lockfile.packages['node_modules/@wsl043/dsh-portable-desktop-bridge']
  assert.equal(desktopBridge.resolved, '../desktop-bridge')
  assert.equal(desktopBridge.link, true)
  const desktopBridgeSource = lockfile.packages['../desktop-bridge']
  const desktopBridgeManifest = JSON.parse(await read('desktop-bridge/package.json'))
  assert.equal(desktopBridgeSource.name, '@wsl043/dsh-portable-desktop-bridge')
  assert.equal(desktopBridgeSource.version, desktopBridgeManifest.version)
  assert.equal(desktopBridgeSource.license, 'Apache-2.0')
})

test('the independent lock verifier accepts the current local bridge link and exact upstream pins', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(root, 'scripts', 'verify-lock.mjs'),
    path.join(root, 'app', 'package-lock.json'),
    path.join(root, 'upstream.lock.json'),
  ])
  const result = JSON.parse(stdout)
  const upstream = JSON.parse(await read('upstream.lock.json'))
  assert.equal(result.dshVersion, upstream.dsh.version)
  assert.equal(result.pluginMarketVersion, '0.1.0-beta.3')
})

test('build script verifies downloads and emits ZIP plus checksum', async () => {
  const script = await read('scripts/build-windows.ps1')
  assert.match(script, /Get-FileHash/)
  assert.match(script, /upstream\.lock\.json/)
  assert.match(script, /NpmCli.+\bci\b/s)
  assert.match(script, /\.sha256/)
  assert.match(script, /PriorPath/)
  assert.match(script, /env:PATH\s*=\s*\$NodeFolder/)
  assert.match(script, /tar\.exe/)
  assert.doesNotMatch(script, /Compress-Archive/)
  assert.match(script, /NewGuid/)
  assert.doesNotMatch(script, /Remove-Item[^\n]+-Recurse/)
  assert.match(script, /FileShare\]::None/)
  assert.match(script, /ZipCandidate/)
  assert.match(script, /ZipBackup/)
  assert.match(script, /File\]::Replace/)
  assert.doesNotMatch(script, /File\]::Replace\([^\n]+\$null/)
  assert.match(script, /UTF8Encoding\]::new\(\$false\)/)
  assert.match(script, /Lock\.dsh\.noticesSha256/)
  assert.doesNotMatch(script, /61f68731049dbea19ba91ad8cf363dd2778c5f7b1f9a63496a6a62c1129eefee/)
})

test('all platform builders verify official notices through the reviewed upstream lock', async () => {
  const [windows, macos, linux] = await Promise.all([
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
  ])
  assert.match(windows, /Lock\.dsh\.noticesSha256/)
  assert.match(macos, /lock_value dsh\.noticesSha256/)
  assert.match(linux, /lock_value dsh\.noticesSha256/)
  for (const builder of [windows, macos, linux]) {
    assert.doesNotMatch(builder, /61f68731049dbea19ba91ad8cf363dd2778c5f7b1f9a63496a6a62c1129eefee/)
  }
})

test('one-click launchers resolve everything from their own folder', async () => {
  const windows = await read('launcher/windows/DSH-Portable.cs')
  const macos = await read('launcher/macos/DSH-Portable')
  assert.match(windows, /Application\.ExecutablePath/)
  assert.match(windows, /runtime.+node.+node\.exe/s)
  assert.doesNotMatch(windows, /AppData|Program Files|USERPROFILE/i)
  assert.match(macos, /SCRIPT_DIR/)
  assert.match(macos, /runtime\/node\/bin\/node/)
})

test('build executes a native runtime smoke check', async () => {
  const build = await read('scripts/build-windows.ps1')
  const verifier = await read('scripts/verify-runtime.mjs')
  assert.match(build, /verify-runtime\.mjs/)
  for (const dependency of ['node-pty', 'koffi', 'protobufjs', '@deepseek-ai/dsh-subprocess-local']) {
    assert.match(verifier, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(verifier, /bin\.js/)
})

test('every desktop package ships the portable repair runtime used by the CLI', async () => {
  const [windows, macos, linux] = await Promise.all([
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
  ])
  for (const build of [windows, macos, linux]) assert.match(build, /repair-core\.mjs/)
})

test('the release surface is Portable-only and does not publish traditional installers', async () => {
  const [staging, publish, workflow, chinese, english, site] = await Promise.all([
    read('scripts/stage-release-assets.mjs'),
    read('.github/workflows/publish.yml'),
    read('.github/workflows/ci.yml'),
    read('README.md'),
    read('README.en.md'),
    read('site/index.html'),
  ])
  for (const text of [staging, publish, workflow, chinese, english, site]) {
    assert.doesNotMatch(text, /DeepSeek-Herness-Setup\.exe/)
    assert.doesNotMatch(text, /DeepSeek-Herness-macos-(?:arm64|x64)\.dmg/)
  }
  assert.doesNotMatch(workflow, /windows-installer-smoke|macos-dmg-smoke|kind:\s*installer/)
  assert.doesNotMatch(publish, /winget/i)
  assert.match(chinese, /传统安装版/)
  assert.match(english, /conventional installer/i)
})

test('stop path preserves the official DSH graceful shutdown before escalation', async () => {
  const build = await read('scripts/build-windows.ps1')
  const launcher = await read('launcher/portable-cli.mjs')
  const host = await read('launcher/portable-host.mjs')
  assert.match(build, /portable-host\.mjs/)
  assert.match(host, /process\.emit\('SIGTERM'\)/)
  assert.match(host, /timingSafeEqual/)
  const signalIndex = launcher.indexOf('requestGracefulShutdown')
  const forceIndex = launcher.indexOf("'/F'")
  assert.notEqual(signalIndex, -1)
  assert.ok(signalIndex < forceIndex)
})
