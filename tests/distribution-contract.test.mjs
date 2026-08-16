import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')

test('runtime dependency boundary contains official DSH, the private desktop bridge, and its pinned package manager only', async () => {
  const runtime = JSON.parse(await read('app/package.json'))
  assert.deepEqual(runtime.dependencies, {
    '@deepseek-ai/dsh': '0.1.0-rc.6',
    '@wsl043/dsh-portable-desktop-bridge': 'file:../desktop-bridge',
    pnpm: '11.7.0',
  })
  const serialized = JSON.stringify(runtime)
  for (const forbidden of ['@yanxu', 'openai-codex', 'opencode-zen', 'GenericAgent']) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
  assert.deepEqual(runtime.allowScripts, {
    '@deepseek-ai/dsh-subprocess-local@0.1.0-rc.6': true,
    '@google/genai@1.52.0': true,
    'koffi@3.1.5': true,
    'node-pty@1.1.0': true,
    'protobufjs@7.6.5': true,
  })
})

test('upstream lock pins independently verifiable DSH and Node artifacts', async () => {
  const lock = JSON.parse(await read('upstream.lock.json'))
  assert.equal(lock.dsh.package, '@deepseek-ai/dsh')
  assert.match(lock.dsh.version, /^0\.1\.0-rc\.\d+$/)
  assert.match(lock.dsh.integrity, /^sha512-/)
  assert.match(lock.dsh.reviewedCommit, /^[0-9a-f]{40}$/)
  assert.deepEqual(lock.pnpm, {
    package: 'pnpm',
    version: '11.7.0',
    integrity: 'sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==',
  })
  for (const [key, runtime] of Object.entries(lock.node.runtimes)) {
    assert.match(runtime.sha256, /^[0-9a-f]{64}$/, key)
    assert.match(runtime.archive, /^node-v\d+\.\d+\.\d+-(win-x64\.zip|darwin-(arm64|x64)\.tar\.gz)$/, key)
  }
})

test('committed npm lock resolves the exact reviewed DSH artifact', async () => {
  const upstream = JSON.parse(await read('upstream.lock.json'))
  const lockfile = JSON.parse(await read('app/package-lock.json'))
  const rootPackage = lockfile.packages['']
  assert.deepEqual(rootPackage.dependencies, {
    '@deepseek-ai/dsh': upstream.dsh.version,
    '@wsl043/dsh-portable-desktop-bridge': 'file:../desktop-bridge',
    pnpm: upstream.pnpm.version,
  })
  const dsh = lockfile.packages['node_modules/@deepseek-ai/dsh']
  assert.equal(dsh.version, upstream.dsh.version)
  assert.equal(dsh.integrity, upstream.dsh.integrity)
  const pnpm = lockfile.packages['node_modules/pnpm']
  assert.equal(pnpm.version, upstream.pnpm.version)
  assert.equal(pnpm.integrity, upstream.pnpm.integrity)
  const desktopBridge = lockfile.packages['node_modules/@wsl043/dsh-portable-desktop-bridge']
  assert.equal(desktopBridge.resolved, 'file:../desktop-bridge')
  assert.equal(desktopBridge.license, 'MIT')
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
