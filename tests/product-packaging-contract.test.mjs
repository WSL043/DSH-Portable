import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const exists = async (name) => access(path.join(root, name)).then(() => true, () => false)

function pngCornerAlphas(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    offset += 12 + length
  }
  assert.equal(bitDepth, 8, 'icon PNGs must use 8-bit channels')
  assert.equal(colorType, 6, 'icon PNGs must retain an RGBA alpha channel')
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const compressed = inflateSync(Buffer.concat(idat))
  const rows = Buffer.alloc(height * stride)
  for (let y = 0, inputOffset = 0; y < height; y += 1) {
    const filter = compressed[inputOffset]
    inputOffset += 1
    for (let x = 0; x < stride; x += 1) {
      const raw = compressed[inputOffset + x]
      const left = x >= bytesPerPixel ? rows[y * stride + x - bytesPerPixel] : 0
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0
      const upperLeft = y > 0 && x >= bytesPerPixel ? rows[(y - 1) * stride + x - bytesPerPixel] : 0
      let value = raw
      if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + up
      else if (filter === 3) value = raw + Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upperLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upperLeft)
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)
      } else assert.equal(filter, 0, `unsupported PNG filter ${filter}`)
      rows[y * stride + x] = value & 0xff
    }
    inputOffset += stride
  }
  const alphaAt = (x, y) => rows[y * stride + x * bytesPerPixel + 3]
  return [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)]
}

function icoPngFrames(ico) {
  assert.equal(ico.readUInt16LE(2), 1)
  const count = ico.readUInt16LE(4)
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    return ico.subarray(offset, offset + length)
  })
}

test('the public product identity is DSH-Portable everywhere users see it', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.name, 'dsh-portable')
  assert.equal(manifest.version, '0.2.0-rc.4')

  const chineseReadme = await read('README.md')
  const englishReadme = await read('README.en.md')
  const userReadme = await read('templates/USER-README.txt')
  const installedReadme = await read('templates/INSTALLED-README.txt')
  const combined = `${chineseReadme}\n${englishReadme}\n${userReadme}\n${installedReadme}`
  assert.match(chineseReadme, /<h1 align="center">DSH-Portable<\/h1>/)
  assert.match(englishReadme, /<h1 align="center">DSH-Portable<\/h1>/)
  assert.match(userReadme, /^DSH-Portable$/m)
  assert.match(installedReadme.slice(0, 1000), /中文[\s\S]+关闭窗口[\s\S]+系统托盘/)
  assert.match(installedReadme, /English[\s\S]+system tray/i)
  assert.doesNotMatch(combined, /DeepSeek Harness Windows Portable|community\.1|Unofficial community packaging/i)
  assert.doesNotMatch(userReadme, /reviewed commit|build script|npm lock|promotion|development history/i)
})

test('the GitHub landing page gives beginners one obvious download path', async () => {
  const chineseReadme = await read('README.md')
  const englishReadme = await read('README.en.md')
  const recommendedUrl = 'https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe'

  assert.match(chineseReadme, /<img[^>]+assets\/DSH-Portable\.svg[^>]+alt="DeepSeek Harness"/i)
  assert.match(englishReadme, /Start in 3 steps/i)
  assert.match(chineseReadme, /三步启动/)
  assert.match(englishReadme, new RegExp(recommendedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(chineseReadme, new RegExp(recommendedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(chineseReadme.indexOf(recommendedUrl) < chineseReadme.indexOf('<details>'), 'the recommended download must appear before advanced choices')
  assert.doesNotMatch(englishReadme.slice(0, englishReadme.indexOf('<details>')), /\|\s*Download\s*\|\s*Use case\s*\|/i)
  assert.doesNotMatch(englishReadme, /Each release includes a `\.sha256` file/i)
  assert.doesNotMatch(chineseReadme, /不用配置 Node\.js|不需要安装 Node\.js/)
  assert.match(chineseReadme, /会话、设置、插件和工作区/)
  assert.match(chineseReadme, /U 盘|移动硬盘/)
  assert.match(chineseReadme, /WSL043\/dsh-codex-subscription/)
})

test('Simplified Chinese is the default GitHub landing page and English is a complete peer', async () => {
  const chinese = await read('README.md')
  const english = await read('README.en.md')
  assert.equal(await exists('README.zh-CN.md'), false)
  assert.match(chinese.slice(0, 1400), /<strong>简体中文<\/strong>.+README\.en\.md/s)
  assert.match(english.slice(0, 1400), /README\.md.+<strong>English<\/strong>/s)
  assert.equal((english.match(/assets\/dsh-interface\.png/g) || []).length, 1)
  assert.equal((chinese.match(/assets\/dsh-interface\.png/g) || []).length, 1)
  for (const heading of ['Start in 3 steps', 'Portable data', 'Updates', 'Security']) assert.match(english, new RegExp(`## ${heading}`, 'i'))
  for (const heading of ['三步启动', '便携数据', '更新', '安全']) assert.match(chinese, new RegExp(`## ${heading}`))
  assert.doesNotMatch(english, /三步启动|下载 Windows|便携数据与安全/)
})

test('update guidance describes the component update path without exposing internals', async () => {
  const chinese = await read('README.md')
  const english = await read('README.en.md')
  const userReadme = await read('templates/USER-README.txt')
  const releaseNotes = await read('templates/RELEASE-NOTES.md')

  assert.match(chinese, /启动时检查更新/)
  assert.match(chinese, /只下载.+DSH.+组件/s)
  assert.match(chinese, /会话、设置、凭据和工作区.+保留/s)
  assert.match(chinese, /兼容性变化.+完整安装包/s)
  assert.match(english, /checks for updates when it starts/i)
  assert.match(english, /downloads only the changed DSH application component/i)
  assert.match(english, /sessions, settings, credentials, and workspace remain in place/i)
  assert.match(english, /compatibility boundary changes.+complete package/is)

  assert.match(userReadme, /^DSH-Portable\r?\n=+\r?\n\r?\n中文/m)
  assert.match(userReadme, /只下载.+DSH.+组件/s)
  assert.match(userReadme, /English[\s\S]+downloads only\s+the changed DSH application component/i)
  assert.match(releaseNotes, /启动时检查更新/)
  assert.match(releaseNotes, /本次更新.+完整包.+后续.+DSH 应用组件/s)
  assert.doesNotMatch(`${chinese}\n${english}\n${userReadme}\n${releaseNotes}`, /update-core|updaterSchema|shellSchema|journal/i)
})

test('release notes prioritize downloads and keep verification optional', async () => {
  const notes = await read('templates/RELEASE-NOTES.md')
  assert.match(notes, /^>\s+打包官方 DeepSeek Harness 预览版/m)
  assert.doesNotMatch(notes, /^#\s+DSH-Portable/m)
  assert.match(notes, /DSH-Portable-windows-x64\.exe/)
  assert.ok(notes.indexOf('DSH-Portable-windows-x64.exe') < notes.indexOf('<details>'))
  assert.doesNotMatch(notes, /\b[a-f0-9]{64}\b/i)
  assert.equal((notes.match(/SHA256SUMS|\b[a-f0-9]{64}\b/gi) || []).length, 0)
})

test('publishing separates beginner downloads from machine update assets', async () => {
  const [workflow, staging, windowsBuild, macBuild, updateCore, bootstrap] = await Promise.all([
    read('.github/workflows/publish.yml'),
    read('scripts/stage-release-assets.mjs'),
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('launcher/update-core.mjs'),
    read('launcher/windows/DSH-Bootstrap.cs'),
  ])

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /prerelease:[\s\S]+default:\s*false/)
  assert.match(workflow, /actions\/download-artifact@v8/)
  assert.match(workflow, /update-channel-stable/)
  assert.match(workflow, /stage-release-assets\.mjs/)
  assert.match(staging, /user-assets/)
  assert.match(staging, /update-assets/)
  assert.match(staging, /checksums\.txt/)
  assert.doesNotMatch(staging, /\.sha256['"`]/)
  assert.match(updateCore, /releases\/download\/update-channel-stable\/portable-update-/)
  assert.match(bootstrap, /releases\/download\/update-channel-stable\/portable-manifest\.json/)
  assert.match(windowsBuild, /releases\/download\/update-channel-stable\/DSH-Portable-update-windows-x64\.zip/)
  assert.match(macBuild, /releases\/download\/update-channel-stable\/DSH-Portable-update-macos-\$ARCH\.zip/)
})

test('official preview updates become tested candidate pull requests instead of manual issues', async () => {
  const [workflow, updater] = await Promise.all([
    read('.github/workflows/upstream-watch.yml'),
    read('scripts/update-upstream.mjs'),
  ])

  assert.match(workflow, /pull-requests:\s*write/)
  assert.match(workflow, /node scripts\/update-upstream\.mjs/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /gh pr (?:create|edit)/)
  assert.doesNotMatch(workflow, /issues:\s*write/)
  assert.match(updater, /registry\.npmjs\.org/)
  assert.match(updater, /dist-tags/)
  assert.match(updater, /integrity/)
  assert.match(updater, /package-lock-only/)
  assert.match(updater, /upstream\.lock\.json/)
})

test('desktop icons are derived from the pinned official DSH mark', async () => {
  const provenance = JSON.parse(await read('assets/BRAND-ASSETS.json'))
  assert.deepEqual(provenance.source, {
    repository: 'https://github.com/deepseek-ai/deepseek-harness',
    commit: '47f943859bef60e4160492346772ded9b24f765a',
    path: 'apps/web/public/favicon.svg',
    gitBlob: 'c92f15d43b4e12aafac4e09728db9696384b6b99',
  })
  assert.deepEqual(provenance.appIconTheme, { light: '#000000', dark: '#FFFFFF' })
  assert.match(provenance.derivation, /official application favicon geometry and adaptive theme/i)

  const svg = await read('assets/DSH-Portable.svg')
  const renderer = await read('scripts/render-icons.mjs')
  assert.match(svg, /viewBox="0 0 50 50"/)
  assert.match(svg, /path\s*\{\s*fill:\s*#fff;/)
  assert.match(svg, /fill="#000"/)
  assert.doesNotMatch(svg, /#4D6BFE/i)
  assert.doesNotMatch(renderer, /\.flatten\(/, 'icon rendering must not replace transparency with a white square')
  assert.equal(await exists('assets/DSH-Portable.ico'), true)
  assert.equal(await exists('assets/DSH-Portable.icns'), true)

  const png = await readFile(path.join(root, 'assets/DSH-Portable-512.png'))
  assert.deepEqual(pngCornerAlphas(png), [0, 0, 0, 0], 'the user-visible PNG must have transparent corners')
  const ico = await readFile(path.join(root, 'assets/DSH-Portable.ico'))
  for (const frame of icoPngFrames(ico)) {
    assert.deepEqual(pngCornerAlphas(frame), [0, 0, 0, 0], 'every Windows icon size must have transparent corners')
  }
})

test('Windows package exposes real GUI executables with matching icon and no path install', async () => {
  const source = await read('launcher/windows/DSH-Portable.cs')
  const bootstrap = await read('launcher/windows/DSH-Bootstrap.cs')
  const manifest = await read('launcher/windows/DSH-Portable.manifest')
  const build = await read('scripts/build-windows.ps1')

  assert.match(source, /Application\.ExecutablePath/)
  assert.match(source, /portable-cli\.mjs/)
  assert.match(source, /Icon\.ExtractAssociatedIcon/)
  assert.match(source, /nonInteractive/)
  assert.match(source, /Environment\.ExitCode/)
  assert.match(source, /DSH_PORTABLE_LAUNCHER_DIAGNOSTIC/)
  assert.match(source, /StandardOutputEncoding\s*=\s*Encoding\.UTF8/)
  assert.match(source, /StandardErrorEncoding\s*=\s*Encoding\.UTF8/)
  assert.match(source, /new TextBox/)
  assert.match(source, /new WebView2/)
  assert.match(source, /SetCurrentProcessExplicitAppUserModelID/)
  assert.match(source, /ScrollBars\.Vertical/)
  assert.match(source, /try\s*\{\s*Clipboard\.SetText/s)
  assert.match(source, /IsStopCommand\(launcherArgs\)[\s\S]+停止失败[\s\S]+启动失败/)
  assert.match(source, /CancelButton\s*=\s*closeButton/)
  assert.match(source, /check-update/)
  assert.match(source, /defer-update/)
  assert.match(source, /现在更新/)
  assert.match(source, /稍后/)
  assert.match(source, /仅下载已变更的 DSH 应用组件/)
  assert.match(source, /full-package-required/)
  assert.ok(source.indexOf('check-update') < source.indexOf('new[] { "update"'), 'the launcher must check before it can request an update')
  assert.doesNotMatch(source, /Program Files|USERPROFILE/i)
  assert.match(manifest, /requestedExecutionLevel level="asInvoker"/)
  assert.match(manifest, /longPathAware[^>]*>true</)
  assert.match(build, /target:winexe/i)
  assert.match(build, /win32icon/i)
  assert.match(build, /DeepSeek-Herness\.exe/)
  assert.doesNotMatch(build, /Stop DeepSeek-Herness\.exe/)
  assert.match(build, /DSH-Portable-windows-x64-offline\.zip/)
  assert.match(build, /DSH-Bootstrap\.cs/)
  assert.match(build, /portable-manifest\.json/)
  assert.match(build, /update-core\.mjs/)
  assert.match(build, /DSH-UpdateExtractor\.cs/)
  assert.match(build, /DSH-Portable-update-windows-x64\.zip/)
  assert.match(build, /portable-update-windows-x64\.json/)
  assert.match(build, /updaterSchema/)
  assert.match(build, /shellSchema/)
  assert.match(build, /shellSchema\s*=\s*5/)
  assert.match(build, /requiredShellSchema\s*=\s*5/)
  assert.match(source, /AssemblyFileVersion\("0\.2\.0\.4"\)/)
  assert.match(bootstrap, /ZipArchive/)
  assert.doesNotMatch(bootstrap, /tar\.exe/i)
  assert.doesNotMatch(build, /community\.1|DeepSeek Harness\.cmd/)

  const cli = await read('launcher/portable-cli.mjs')
  assert.match(cli, /rollbackPendingAppUpdate\(layout,\s*\{[\s\S]+beforeRestore:[\s\S]+ownedState\(current\)[\s\S]+await stop\(\)/)
  assert.match(cli, /catch \(error\) \{[\s\S]+await deferUpdate\(layout\)\.catch/)
  assert.match(cli, /BROWSER_FORCE_SHUTDOWN_MS\s*=\s*15000/)
  assert.match(cli, /terminateBrowserProcess\(item, true\)[\s\S]+process\.kill\(Number\(item\.pid\)/)
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
  assert.match(setup, /Name:\s*"\{group\}\\DeepSeek-Herness";[^\n]+IconFilename:\s*"\{app\}\\DeepSeek-Herness\.exe"/)
  assert.doesNotMatch(setup, /Name:\s*"\{group\}\\Stop DeepSeek-Herness"/)
  assert.match(setup, /Compression=lzma2\/ultra64/)
  assert.doesNotMatch(setup, /Stop DeepSeek-Herness\.exe/)
  assert.match(setup, /Excludes:\s*"\\data\\\*,\\workspace\\\*"/)
  assert.doesNotMatch(setup, /Excludes:\s*"data\\\*,workspace\\\*"/)
  assert.match(setup, /DeepSeek-Herness\.exe";\s*Parameters:\s*"stop/)
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
  assert.match(smoke, /WScript\.Shell/)
  assert.match(smoke, /CreateShortcut/)
  assert.match(smoke, /IconLocation/)
  assert.match(smoke, /amazon-bedrock\.json/)
  assert.match(verifyRuntime, /amazon-bedrock\.json/)
  for (const stage of ['Install package', 'Start installed runtime', 'Stop installed runtime', 'Uninstall package']) {
    assert.match(smoke, new RegExp(stage))
  }
})

test('plugin management is a generic finished-product capability and release gate', async () => {
  const [chinese, english, userReadme, releaseNotes, workflow, smoke, installerSmoke] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('templates/USER-README.txt'),
    read('templates/RELEASE-NOTES.md'),
    read('.github/workflows/ci.yml'),
    read('scripts/smoke-windows-plugins.ps1'),
    read('scripts/smoke-windows-installer.ps1'),
  ])
  const docs = `${chinese}\n${english}\n${userReadme}\n${releaseNotes}`
  assert.match(chinese, /\.\\dsh\.exe plugin --profile web add <插件>/)
  assert.match(chinese, /\.\\dsh\.exe plugin --profile web (?:list|remove|update)/)
  assert.match(chinese, /\.\\dsh\.exe --profile web --dump-config/)
  assert.match(english, /\.\\dsh\.exe plugin --profile web add <plugin>/i)
  assert.match(docs, /不会自动重启|never restarts/i)
  assert.match(chinese, /github\.com\/WSL043\/dsh-codex-subscription/)
  assert.match(english, /github\.com\/WSL043\/dsh-codex-subscription/)
  assert.doesNotMatch(docs, /openai-codex|zen\s*free/i)

  assert.match(workflow, /^  windows-plugin-smoke:/m)
  assert.match(workflow, /smoke-windows-plugins\.ps1/)
  assert.match(workflow, /tests\\fixtures\\dsh-portable-smoke-plugin|tests\/fixtures\/dsh-portable-smoke-plugin/)
  assert.match(installerSmoke, /smoke-windows-plugins\.ps1/)
  assert.match(smoke, /plugin.+add/s)
  assert.match(smoke, /plugin.+list/s)
  assert.match(smoke, /plugin.+update/s)
  assert.match(smoke, /plugin.+remove/s)
  assert.match(smoke, /--dump-config/)
  assert.match(smoke, /isolated PATH/i)
  assert.match(smoke, /Get-Command.+-CommandType\s+Application/s)
  assert.match(smoke, /PreviousErrorActionPreference/)
  assert.match(smoke, /\$ErrorActionPreference\s*=\s*'Continue'/)
  assert.match(smoke, /\$ExitCode\s*=\s*\$LASTEXITCODE/)
  assert.match(smoke, /\$null\s+-ne\s+\$ProcessExitCode/)
  assert.match(smoke, /Product-Status/)
  assert.doesNotMatch(smoke, /where\.exe/i)
  assert.doesNotMatch(smoke, /codex|openai-codex|zen/i)
})

test('Windows portable self-extractor stays offline, movable, and registration-free', async () => {
  const extractor = await read('installer/windows/DSH-Portable.iss')
  const build = await read('scripts/build-windows.ps1')
  const smoke = await read('scripts/smoke-windows-portable-extractor.ps1')
  const workflow = await read('.github/workflows/ci.yml')

  assert.match(extractor, /AppName=DSH-Portable/)
  assert.match(extractor, /OutputBaseFilename=DSH-Portable-windows-x64-offline/)
  assert.match(extractor, /DefaultDirName=\{src\}\\DSH-Portable/)
  assert.match(extractor, /UsePreviousAppDir=no/)
  assert.match(extractor, /Uninstallable=no/)
  assert.match(extractor, /CreateUninstallRegKey=no/)
  assert.match(extractor, /PrivilegesRequired=lowest/)
  assert.match(extractor, /Compression=lzma2\/ultra64/)
  assert.match(extractor, /Source:\s*"\{#Stage\}\\\*";\s*DestDir:\s*"\{app\}"/)
  assert.doesNotMatch(extractor, /Excludes:/)
  assert.doesNotMatch(extractor, /\[Icons\]|\[Registry\]|installed-mode\.json/i)

  assert.match(build, /DSH-Portable-windows-x64-offline\.exe/)
  assert.match(build, /PortableExtractorSha256/)
  assert.match(build, /installer\\windows\\DSH-Portable\.iss/)
  assert.match(build, /--version/)
  assert.match(build, /Inno Setup 7 or newer/)
  assert.doesNotMatch(build, /Inno Setup 6/)
  assert.match(smoke, /DSH-Portable-windows-x64-offline\.exe/)
  assert.match(smoke, /\/DIR=/)
  assert.match(smoke, /\/DIR="\{0\}"/)
  assert.match(smoke, /\/LOG="\{1\}"/)
  assert.match(smoke, /Start-Process[\s\S]+-ArgumentList \$ExtractorArguments/)
  assert.match(smoke, /\[char\]0x00FC/)
  assert.match(smoke, /installed-mode\.json/)
  assert.match(smoke, /unins\*\.exe/)
  assert.match(smoke, /amazon-bedrock\.json/)
  assert.match(smoke, /runtime\\node\\node\.exe/)
  assert.doesNotMatch(smoke, /&\s+node\s+/)
  assert.match(smoke, /smoke-portable\.mjs/)
  assert.match(workflow, /smoke-windows-portable-extractor\.ps1/)
  assert.match(workflow, /artifacts\/DSH-Portable-windows-x64\.exe/)
  assert.match(workflow, /artifacts\/DSH-Portable-windows-x64\.exe\.sha256/)
  assert.match(workflow, /filename:\s*DSH-Portable-windows-x64-offline\.exe/)
  assert.match(workflow, /artifacts\/portable-manifest\.json/)
  assert.match(workflow, /artifacts\/DSH-Portable-update-windows-x64\.zip/)
  assert.match(workflow, /artifacts\/portable-update-windows-x64\.json/)
})

test('macOS package is a movable signed app shell for both supported architectures', async () => {
  const plist = await read('launcher/macos/Info.plist')
  const app = await read('launcher/macos/DeepSeek-Herness.swift')
  const stop = await read('launcher/macos/Stop DSH-Portable.command')
  const build = await read('scripts/build-macos.sh')

  assert.match(plist, /<string>DSH-Portable<\/string>/)
  assert.match(plist, /<string>io\.github\.wsl043\.dsh-portable<\/string>/)
  assert.match(plist, /<string>DSH-Portable<\/string>\s*<key>CFBundleIconFile<\/key>/s)
  assert.match(app, /import AppKit/)
  assert.match(app, /import WebKit/)
  assert.match(app, /runtime\/node\/bin\/node/)
  assert.match(app, /start", "--no-browser", "--json/)
  assert.match(stop, /portable-cli\.mjs" stop/)
  assert.match(build, /darwin-\$ARCH/)
  assert.match(build, /cd "\$STAGE\/app"/)
  assert.doesNotMatch(build, /npm[^\n]+ci --prefix/)
  assert.match(build, /codesign --force --deep --sign -/)
  assert.match(build, /DSH-Portable-macos-\$ARCH\.zip/)
  assert.match(build, /DSH-Portable-update-macos-\$ARCH\.zip/)
  assert.match(build, /portable-update-macos-\$ARCH\.json/)
  assert.match(build, /"shellSchema": 5/)
  assert.match(build, /"requiredShellSchema": 5/)
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>2<\/string>/s)
  assert.match(app, /check-update/)
  assert.match(app, /defer-update/)
  assert.doesNotMatch(app, /--app=/)
})

test('macOS DMG carries a self-contained app and keeps installed data outside its signature', async () => {
  const installedApp = await read('launcher/macos/DeepSeek-Herness.swift')
  const build = await read('scripts/build-macos.sh')
  assert.match(installedApp, /Bundle\.main\.resourceURL/)
  assert.match(installedApp, /Library\/Application Support\/DeepSeek-Herness/)
  assert.match(installedApp, /DSH_PORTABLE_STATE_ROOT/)
  assert.doesNotMatch(installedApp, /--app=/)
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
  const upstreamWorkflow = await read('.github/workflows/upstream-watch.yml')
  const desktopHostSmoke = await read('scripts/smoke-windows-desktop-host.ps1')
  const macDesktopHostSmoke = await read('scripts/smoke-macos-desktop-host.sh')
  const bootstrapSmoke = await read('scripts/smoke-windows-bootstrap.mjs')
  const updateSmoke = await read('scripts/smoke-update-artifact.mjs')
  for (const runner of ['windows-latest', 'macos-15', 'macos-15-intel']) assert.match(workflow, new RegExp(runner))
  assert.match(workflow, /build-windows\.ps1/)
  assert.match(workflow, /build-macos\.sh/)
  assert.match(workflow, /smoke-portable\.mjs/)
  assert.match(workflow, /smoke-windows-bootstrap\.mjs/)
  assert.match(workflow, /tar\.exe -x -f artifacts\/DSH-Portable-windows-x64-offline\.zip/)
  assert.doesNotMatch(workflow, /Expand-Archive/)
  assert.match(workflow, /actions\/checkout@v7/)
  assert.match(workflow, /actions\/setup-node@v7/)
  assert.match(workflow, /actions\/upload-artifact@v7/)
  assert.match(workflow, /actions\/download-artifact@v8/)
  assert.match(upstreamWorkflow, /actions\/checkout@v7/)
  assert.match(upstreamWorkflow, /actions\/setup-node@v7/)
  assert.match(upstreamWorkflow, /node scripts\/update-upstream\.mjs/)
  assert.doesNotMatch(`${workflow}\n${upstreamWorkflow}`, /actions\/(?:checkout|setup-node|upload-artifact|download-artifact|github-script)@v[1-6]\b/)
  assert.match(workflow, /innosetup-7\.1\.0-x64\.exe/)
  assert.match(workflow, /0362a383ed217d4c4239b5933866dd96d3eb2102737da92f80f6057a4b40df2f/)
  assert.match(workflow, /Get-FileHash[\s\S]+SHA256/)
  assert.match(workflow, /\/PORTABLE=1/)
  assert.match(workflow, /-IsccPath \$env:ISCC_PATH/)
  assert.doesNotMatch(workflow, /choco install innosetup/)
  assert.match(workflow, /compression-level:\s*0/)
  assert.match(bootstrapSmoke, /DSH-Portable-windows-x64\.exe/)
  assert.match(bootstrapSmoke, /中文 空格/)
  assert.match(bootstrapSmoke, /\.dsh-portable-install-/)
  assert.match(bootstrapSmoke, /maxRetries:\s*40/)
  assert.match(bootstrapSmoke, /process\.env\.CI/)
  assert.match(workflow, /DSH-Portable-update-macos-\$\{\{ matrix\.arch \}\}\.zip/)
  assert.match(workflow, /portable-update-macos-\$\{\{ matrix\.arch \}\}\.json/)
  assert.match(workflow, /verify-update-artifact\.mjs/)
  assert.match(workflow, /smoke-update-artifact\.mjs/)
  assert.match(updateSmoke, /rollbackVerified/)
  assert.match(updateSmoke, /Update failed and was rolled back|rolled back/i)
  assert.ok(
    workflow.indexOf('node scripts/smoke-update-artifact.mjs') < workflow.indexOf('node scripts/smoke-portable.mjs'),
    'the update smoke must run before the movable-root smoke renames the package',
  )
  for (const job of [
    'workflow-lint:',
    'contracts:',
    'windows-build:',
    'windows-inno-build:',
    'windows-portable-smoke:',
    'windows-plugin-smoke:',
    'windows-desktop-host:',
    'windows-extractor-smoke:',
    'windows-installer-smoke:',
    'macos-build:',
    'macos-portable-smoke:',
    'macos-desktop-host:',
    'macos-dmg-smoke:',
  ]) assert.match(workflow, new RegExp(`^  ${job.replace(':', '\\:')}`, 'm'))
  assert.match(workflow, /actionlint_1\.7\.12_linux_amd64\.tar\.gz/)
  assert.match(workflow, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/)
  assert.match(workflow, /\.\/actionlint/)
  assert.match(workflow, /windows-desktop-host:[\s\S]+needs:\s*windows-build/)
  assert.match(workflow, /smoke-windows-desktop-host\.ps1/)
  const windowsBaseJob = workflow.match(/\n  windows-build:[\s\S]+?(?=\n  [a-z][\w-]+:)/)?.[0] || ''
  const windowsInnoJob = workflow.match(/\n  windows-inno-build:[\s\S]+?(?=\n  [a-z][\w-]+:)/)?.[0] || ''
  assert.doesNotMatch(windowsBaseJob, /BuildInstaller|ISCC|Inno Setup/)
  assert.match(windowsInnoJob, /needs:\s*windows-build/)
  assert.match(windowsInnoJob, /strategy:[\s\S]+matrix:[\s\S]+kind:\s*portable[\s\S]+kind:\s*installer/)
  assert.match(windowsInnoJob, /build-windows-inno\.ps1/)
  assert.match(workflow, /windows-extractor-smoke:[\s\S]+needs:\s*windows-inno-build[\s\S]+name:\s*windows-x64-extractor/)
  assert.match(workflow, /windows-installer-smoke:[\s\S]+needs:\s*windows-inno-build[\s\S]+name:\s*windows-x64-installer/)
  assert.match(desktopHostSmoke, /DeepSeek-Herness\.exe/)
  assert.match(desktopHostSmoke, /AppUserModelID/)
  assert.match(desktopHostSmoke, /MainWindowHandle/)
  assert.match(desktopHostSmoke, /CloseMainWindow/)
  assert.match(desktopHostSmoke, /WebView2/)
  assert.match(desktopHostSmoke, /browser\.json/)
  assert.match(desktopHostSmoke, /--app=/)
  assert.match(desktopHostSmoke, /--no-browser/)
  assert.match(workflow, /macos-desktop-host:[\s\S]+needs:\s*macos-build/)
  assert.match(workflow, /smoke-macos-desktop-host\.sh/)
  assert.match(macDesktopHostSmoke, /DSH-Portable\.app/)
  assert.match(macDesktopHostSmoke, /WebKit|WKWebView/)
  assert.match(macDesktopHostSmoke, /osascript/)
  assert.match(macDesktopHostSmoke, /browser\.json/)
  assert.match(macDesktopHostSmoke, /--app=/)
  assert.match(macDesktopHostSmoke, /--no-browser/)
})

test('Node runtime lock covers Windows and both Mac CPU families', async () => {
  const lock = JSON.parse(await read('upstream.lock.json'))
  assert.equal(lock.node.version, '24.19.0')
  assert.match(lock.node.runtimes['win-x64'].archive, /win-x64\.zip$/)
  assert.match(lock.node.runtimes['darwin-arm64'].archive, /darwin-arm64\.tar\.gz$/)
  assert.match(lock.node.runtimes['darwin-x64'].archive, /darwin-x64\.tar\.gz$/)
  for (const runtime of Object.values(lock.node.runtimes)) assert.match(runtime.sha256, /^[0-9a-f]{64}$/)
})
