import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const exists = async (name) => access(path.join(root, name)).then(() => true, () => false)

test('the public product identity is DSH-Portable everywhere users see it', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.name, 'dsh-portable')
  assert.match(manifest.version, /^0\.1\.0-rc\.6-portable\.\d+$/)

  const readme = await read('README.md')
  const userReadme = await read('templates/USER-README.txt')
  const combined = `${readme}\n${userReadme}`
  assert.match(readme, /^# DSH-Portable/m)
  assert.match(userReadme, /^DSH-Portable$/m)
  assert.doesNotMatch(combined, /DeepSeek Harness Windows Portable|community\.1|Unofficial community packaging/i)
  assert.doesNotMatch(userReadme, /reviewed commit|build script|npm lock|promotion|development history/i)
})

test('desktop icons are derived from the pinned official DSH mark', async () => {
  const provenance = JSON.parse(await read('assets/BRAND-ASSETS.json'))
  assert.deepEqual(provenance.source, {
    repository: 'https://github.com/deepseek-ai/deepseek-harness',
    commit: '47f943859bef60e4160492346772ded9b24f765a',
    path: 'apps/web/public/favicon.svg',
    gitBlob: 'c92f15d43b4e12aafac4e09728db9696384b6b99',
  })
  assert.equal(provenance.appIconColor, '#4D6BFE')

  const svg = await read('assets/DSH-Portable.svg')
  assert.match(svg, /viewBox="0 0 50 50"/)
  assert.match(svg, /fill="#4D6BFE"/)
  assert.equal(await exists('assets/DSH-Portable.ico'), true)
  assert.equal(await exists('assets/DSH-Portable.icns'), true)
})

test('Windows package exposes real GUI executables with matching icon and no path install', async () => {
  const source = await read('launcher/windows/DSH-Portable.cs')
  const manifest = await read('launcher/windows/DSH-Portable.manifest')
  const build = await read('scripts/build-windows.ps1')

  assert.match(source, /Application\.ExecutablePath/)
  assert.match(source, /portable-cli\.mjs/)
  assert.match(source, /Icon\.ExtractAssociatedIcon/)
  assert.match(source, /nonInteractive/)
  assert.match(source, /Environment\.ExitCode/)
  assert.match(source, /DSH_PORTABLE_LAUNCHER_DIAGNOSTIC/)
  assert.doesNotMatch(source, /AppData|Program Files|USERPROFILE/i)
  assert.match(manifest, /requestedExecutionLevel level="asInvoker"/)
  assert.match(manifest, /longPathAware[^>]*>true</)
  assert.match(build, /target:winexe/i)
  assert.match(build, /win32icon/i)
  assert.match(build, /DeepSeek-Herness\.exe/)
  assert.match(build, /Stop DeepSeek-Herness\.exe/)
  assert.match(build, /DSH-Portable-windows-x64\.zip/)
  assert.doesNotMatch(build, /community\.1|DeepSeek Harness\.cmd/)
})

test('Windows setup is a per-user offline installer with durable data outside the app', async () => {
  const setup = await read('installer/windows/DeepSeek-Herness.iss')
  const build = await read('scripts/build-windows.ps1')
  const smoke = await read('scripts/smoke-windows-installer.ps1')
  const verifyRuntime = await read('scripts/verify-runtime.mjs')
  assert.match(setup, /AppId=\{[^}]+\}/)
  assert.match(setup, /OutputBaseFilename=DeepSeek-Herness-Setup/)
  assert.match(setup, /DefaultDirName=\{localappdata\}\\Programs\\DeepSeek-Herness/)
  assert.match(setup, /PrivilegesRequired=lowest/)
  assert.match(setup, /SetupIconFile=.*DSH-Portable\.ico/)
  assert.match(setup, /Compression=lzma2\/ultra64/)
  assert.match(setup, /Stop DeepSeek-Herness\.exe/)
  assert.match(setup, /Excludes:\s*"\\data\\\*,\\workspace\\\*"/)
  assert.doesNotMatch(setup, /Excludes:\s*"data\\\*,workspace\\\*"/)
  assert.match(setup, /RunOnceId:\s*"StopDeepSeekHerness"/)
  assert.match(build, /BuildInstaller/)
  assert.match(build, /ISCC/)
  assert.match(build, /subst\.exe/)
  assert.match(build, /InstallerDrive/)
  assert.match(build, /finally[\s\S]+subst\.exe[\s\S]+\/D/)
  assert.match(smoke, /DeepSeek-Herness-Setup\.exe/)
  assert.match(smoke, /DSH_PORTABLE_STATE_ROOT/)
  assert.match(smoke, /unins000\.exe/)
  assert.match(smoke, /\/SP-/)
  assert.match(smoke, /\/NOCANCEL/)
  assert.match(smoke, /\/LOG=/)
  assert.match(smoke, /Get-Content[\s\S]+SetupLog/)
  assert.match(smoke, /dsh-i-/)
  assert.match(smoke, /Invoke-BoundedProcess/)
  assert.match(smoke, /WaitForExit/)
  assert.match(smoke, /LauncherDiagnostic/)
  assert.match(smoke, /amazon-bedrock\.json/)
  assert.match(verifyRuntime, /amazon-bedrock\.json/)
  for (const stage of ['Install package', 'Start installed runtime', 'Stop installed runtime', 'Uninstall package']) {
    assert.match(smoke, new RegExp(stage))
  }
})

test('macOS package is a movable signed app shell for both supported architectures', async () => {
  const plist = await read('launcher/macos/Info.plist')
  const app = await read('launcher/macos/DSH-Portable')
  const stop = await read('launcher/macos/Stop DSH-Portable.command')
  const build = await read('scripts/build-macos.sh')

  assert.match(plist, /<string>DSH-Portable<\/string>/)
  assert.match(plist, /<string>io\.github\.wsl043\.dsh-portable<\/string>/)
  assert.match(plist, /<string>DSH-Portable<\/string>\s*<key>CFBundleIconFile<\/key>/s)
  assert.match(app, /Contents\/MacOS/)
  assert.match(app, /runtime\/node\/bin\/node/)
  assert.match(stop, /portable-cli\.mjs" stop/)
  assert.match(build, /darwin-\$ARCH/)
  assert.match(build, /cd "\$STAGE\/app"/)
  assert.doesNotMatch(build, /npm[^\n]+ci --prefix/)
  assert.match(build, /codesign --force --deep --sign -/)
  assert.match(build, /DSH-Portable-macos-\$ARCH\.zip/)
})

test('macOS DMG carries a self-contained app and keeps installed data outside its signature', async () => {
  const installedApp = await read('launcher/macos/DeepSeek-Herness-installed')
  const build = await read('scripts/build-macos.sh')
  assert.match(installedApp, /Contents\/Resources/)
  assert.match(installedApp, /Library\/Application Support\/DeepSeek-Herness/)
  assert.match(installedApp, /DSH_PORTABLE_STATE_ROOT/)
  assert.match(build, /hdiutil create/)
  assert.match(build, /-format ULMO/)
  assert.doesNotMatch(build, /-format ULFO/)
  assert.doesNotMatch(build, /-format UDZO/)
  assert.match(build, /DMG_CREATE_ATTEMPTS/)
  assert.match(build, /for \(\(attempt = 1;/)
  assert.match(build, /rm -f "\$DMG"/)
  assert.match(build, /DeepSeek-Herness-macos-\$ARCH\.dmg/)
  assert.match(build, /Applications/)
  assert.match(build, /codesign --verify --deep --strict/)
})

test('CI executes contracts and real package smoke tests on Windows and both Mac architectures', async () => {
  const workflow = await read('.github/workflows/ci.yml')
  for (const runner of ['windows-latest', 'macos-15', 'macos-15-intel']) assert.match(workflow, new RegExp(runner))
  assert.match(workflow, /build-windows\.ps1/)
  assert.match(workflow, /build-macos\.sh/)
  assert.match(workflow, /smoke-portable\.mjs/)
  assert.match(workflow, /tar\.exe -x -f artifacts\/DSH-Portable-windows-x64\.zip/)
  assert.doesNotMatch(workflow, /Expand-Archive/)
  assert.match(workflow, /actions\/checkout@v6/)
  assert.match(workflow, /actions\/setup-node@v6/)
  assert.match(workflow, /actions\/upload-artifact@v6/)
  assert.match(workflow, /compression-level:\s*0/)
  assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}/)
})

test('Node runtime lock covers Windows and both Mac CPU families', async () => {
  const lock = JSON.parse(await read('upstream.lock.json'))
  assert.equal(lock.node.version, '24.19.0')
  assert.match(lock.node.runtimes['win-x64'].archive, /win-x64\.zip$/)
  assert.match(lock.node.runtimes['darwin-arm64'].archive, /darwin-arm64\.tar\.gz$/)
  assert.match(lock.node.runtimes['darwin-x64'].archive, /darwin-x64\.tar\.gz$/)
  for (const runtime of Object.values(lock.node.runtimes)) assert.match(runtime.sha256, /^[0-9a-f]{64}$/)
})
