import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

import { classifyProductVersion } from '../scripts/version-policy.mjs'
import { renderReleaseNotes, upstreamLockNameForTag } from '../scripts/render-release-notes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const exists = async (name) => access(path.join(root, name)).then(() => true, () => false)
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
  assert.ok(['stable', 'candidate'].includes(classifyProductVersion(manifest.version).channel))

  const chineseReadme = await read('README.md')
  const englishReadme = await read('README.en.md')
  const userReadme = await read('templates/USER-README.zh-CN.txt')
  const userReadmeEnglish = await read('templates/USER-README.en.txt')
  const combined = `${chineseReadme}\n${englishReadme}\n${userReadme}\n${userReadmeEnglish}`
  assert.match(chineseReadme, /<h1 align="center">DSH-Portable<\/h1>/)
  assert.match(englishReadme, /<h1 align="center">DSH-Portable<\/h1>/)
  assert.match(userReadme, /^DSH-Portable$/m)
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
  assert.doesNotMatch(chineseReadme.slice(0, chineseReadme.indexOf('## 插件')), /codex|chatgpt|dsh-codex-subscription/i)
})

test('redistribution metadata keeps the canonical project discoverable without a custom license', async () => {
  const [license, notice, chinese, english, citation, contributing, windowsBuild, macBuild, linuxBuild] = await Promise.all([
    read('LICENSE'),
    read('NOTICE.md'),
    read('README.md'),
    read('README.en.md'),
    read('CITATION.cff'),
    read('CONTRIBUTING.md'),
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
  ])
  const canonical = 'https://github.com/WSL043/DSH-Portable'

  assert.match(license, /Apache License[\s\S]+Version 2\.0/)
  assert.doesNotMatch(license, new RegExp(regexEscape(canonical)))
  assert.match(notice, new RegExp(regexEscape(canonical)))
  assert.match(chinese, /github\/downloads\/WSL043\/DSH-Portable\/total/)
  assert.match(english, /github\/downloads\/WSL043\/DSH-Portable\/total/)
  assert.match(chinese, /NOTICE\.md/)
  assert.match(english, /NOTICE\.md/)
  assert.match(citation, new RegExp(regexEscape(canonical)))
  assert.match(contributing, /npm test/)
  for (const build of [windowsBuild, macBuild, linuxBuild]) assert.match(build, /DSH-Portable-NOTICE\.md/)
  assert.doesNotMatch(license, /Non-Commercial|Commons Clause|no commercial/i)
})

test('Simplified Chinese is the default GitHub landing page and English is a complete peer', async () => {
  const chinese = await read('README.md')
  const english = await read('README.en.md')
  assert.equal(await exists('README.zh-CN.md'), false)
  assert.match(chinese.slice(0, 1400), /<strong>简体中文<\/strong>.+README\.en\.md/s)
  assert.match(english.slice(0, 1400), /README\.md.+<strong>English<\/strong>/s)
  assert.equal((english.match(/assets\/dsh-interface-en\.png/g) || []).length, 1)
  assert.equal((chinese.match(/assets\/dsh-interface-zh\.png/g) || []).length, 1)
  assert.equal((english.match(/assets\/dsh-portable-extensions-en\.png/g) || []).length, 0)
  assert.equal((chinese.match(/assets\/dsh-portable-extensions-en\.png/g) || []).length, 0)
  assert.doesNotMatch(`${chinese}\n${english}`, /assets\/(?:dsh-interface|dsh-portable-folder)\.png/)
  for (const asset of ['assets/dsh-interface-zh.png', 'assets/dsh-interface-en.png']) {
    assert.equal(await exists(asset), true, `${asset} must be shipped with the repository`)
  }
  assert.equal(await exists('assets/dsh-portable-extensions-en.png'), false)
  assert.equal(await exists('assets/dsh-portable-folder.png'), false, 'the README must not ship a decorative folder screenshot')
  for (const heading of ['Start in 3 steps', 'Portable data', 'Updates', 'Security']) assert.match(english, new RegExp(`## ${heading}`, 'i'))
  for (const heading of ['三步启动', '便携数据', '更新', '安全']) assert.match(chinese, new RegExp(`## ${heading}`))
  assert.doesNotMatch(english, /三步启动|下载 Windows|便携数据与安全/)
})

test('README status badges stay compact, useful, and visually consistent', async () => {
  const chinese = await read('README.md')
  const english = await read('README.en.md')

  for (const document of [chinese, english]) {
    const badgeBlock = document.match(/<p align="center">\s*(?:<a[^>]+><img[^>]+><\/a>\s*){4}<\/p>/)?.[0] ?? ''
    assert.notEqual(badgeBlock, '', 'README must expose one compact four-badge status row')
    assert.match(badgeBlock, /github\/v\/release\/WSL043\/DSH-Portable\?display_name=tag/)
    assert.match(badgeBlock, /github\/downloads\/WSL043\/DSH-Portable\/total/)
    assert.match(badgeBlock, /github\/actions\/workflow\/status\/WSL043\/DSH-Portable\/ci\.yml\?branch=main/)
    assert.match(badgeBlock, /github\/license\/WSL043\/DSH-Portable/)
    assert.doesNotMatch(badgeBlock, /github\/stars|Windows%20%7C|display_name=release/)
    assert.equal((badgeBlock.match(/style=flat-square/g) ?? []).length, 4)
    assert.equal((badgeBlock.match(/color=171717/g) ?? []).length, 4)
  }
})

test('update guidance describes the component update path without exposing internals', async () => {
  const chinese = await read('README.md')
  const english = await read('README.en.md')
  const userReadme = await read('templates/USER-README.zh-CN.txt')
  const userReadmeEnglish = await read('templates/USER-README.en.txt')
  const releaseNotes = renderReleaseNotes(await read('templates/RELEASE-NOTES.md'), 'v0.4.0-rc.2', '0.1.1-rc.1')

  assert.match(chinese, /启动时检查更新/)
  assert.match(chinese, /产品更新.+DeepSeek Harness 内核更新.+独立.+默认关闭/s)
  assert.match(chinese, /正在更新 DSH-Portable 还是 DeepSeek Harness/)
  assert.match(chinese, /当前版本和目标版本/)
  assert.match(chinese, /真实下载百分比/)
  assert.match(chinese, /只下载.+DSH.+组件/s)
  assert.match(chinese, /会话、设置、凭据和工作区.+保留/s)
  assert.match(chinese, /兼容性变化.+直接下载.+完整版本.+原地/s)
  assert.match(chinese, /跳过此版本/)
  assert.match(english, /opens the local workspace first.+checks in the background/is)
  assert.match(english, /Product updates and official DeepSeek Harness core updates are independent.+Check for updates at startup.+off by default/is)
  assert.match(english, /Every prompt names the target.+DSH-Portable or DeepSeek Harness.+current and next version/is)
  assert.match(english, /real download percentage/i)
  assert.match(english, /downloads only the changed DSH application component/i)
  assert.match(english, /sessions, settings, credentials, and workspace remain in place/i)
  assert.match(english, /compatibility boundary changes.+downloads the verified complete package.+in place/is)
  assert.match(english, /Skip this version/)

  assert.match(userReadme, /^DSH-Portable\r?\n=+/m)
  assert.match(userReadme, /只下载.+DSH.+组件/s)
  assert.match(userReadmeEnglish, /downloads only\s+the changed DSH application component/i)
  assert.match(releaseNotes, /Linux x64 与 ARM64/)
  assert.match(releaseNotes, /保留会话、设置、凭据、插件和工作区/)
  assert.doesNotMatch(`${chinese}\n${english}\n${userReadme}\n${userReadmeEnglish}\n${releaseNotes}`, /update-core|updaterSchema|shellSchema|journal/i)
})

test('GitHub gives Chinese and English users direct, privacy-safe feedback forms', async () => {
  const [chinese, english, bug, feature, config] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('.github/ISSUE_TEMPLATE/bug-report.yml'),
    read('.github/ISSUE_TEMPLATE/feature-request.yml'),
    read('.github/ISSUE_TEMPLATE/config.yml'),
  ])
  assert.match(chinese, /反馈问题|获取帮助/)
  assert.match(english, /Report a problem|Get help/i)
  assert.match(chinese, /issues\/new\?template=bug-report\.yml/)
  assert.match(english, /issues\/new\?template=bug-report\.yml/)
  assert.match(bug, /Bug 报告 \/ Bug report/)
  assert.match(bug, /Windows 便携版 \/ Windows portable/)
  assert.match(bug, /没有粘贴 API Key、登录凭据或私人会话/)
  assert.match(feature, /功能建议 \/ Feature request/)
  assert.match(config, /blank_issues_enabled:\s*false/)
})

test('release notes prioritize downloads and keep verification optional', async () => {
  const notes = renderReleaseNotes(await read('templates/RELEASE-NOTES.md'), 'v0.4.0', '0.1.1-rc.1')
  assert.match(notes, /^>\s+DSH-Portable 是独立社区发行版，内置官方 DeepSeek Harness/m)
  assert.doesNotMatch(notes, /0\.4\.0 是正式版|0\.4\.0 is a stable release/i)
  assert.doesNotMatch(notes, /^#\s+DSH-Portable/m)
  assert.match(notes, /DSH-Portable-windows-x64\.exe/)
  assert.ok(notes.indexOf('DSH-Portable-windows-x64.exe') < notes.indexOf('<details>'))
  assert.doesNotMatch(notes, /DSH-Portable-windows-x64-offline\.exe/, 'release notes must not link to an unpublished asset')
  assert.doesNotMatch(notes, /\b[a-f0-9]{64}\b/i)
  assert.equal((notes.match(/SHA256SUMS|\b[a-f0-9]{64}\b/gi) || []).length, 0)
})

test('public downloads expose a truthful security and code-signing policy', async () => {
  const [chinese, english, releaseNotes, signing, security] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('templates/RELEASE-NOTES.md'),
    read('CODE_SIGNING.md'),
    read('SECURITY.md'),
  ])

  assert.match(chinese, /代码签名策略.*CODE_SIGNING\.md/)
  assert.match(english, /code-signing policy.*CODE_SIGNING\.md/i)
  assert.match(releaseNotes, /代码签名策略.*CODE_SIGNING\.md/)
  assert.match(releaseNotes, /code-signing policy.*CODE_SIGNING\.md/i)
  assert.match(signing, /GitHub Actions/)
  assert.match(signing, /Get-AuthenticodeSignature/)
  assert.match(signing, /current release files are unsigned/i)
  assert.match(signing, /Authors and reviewers.+WSL043/is)
  assert.match(signing, /Approver.+WSL043/is)
  assert.match(signing, /PRIVACY\.md/)
  assert.match(security, /private vulnerability reporting/i)
  assert.match(security, /API key|credentials/i)
  assert.match(chinese, /gh attestation verify.+WSL043\/DSH-Portable/)
  assert.match(english, /gh attestation verify.+WSL043\/DSH-Portable/i)
})

test('release notes are version-specific instead of replaying one fixed feature list', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const tag = `v${manifest.version}`
  const [template, current, files] = await Promise.all([
    read('templates/RELEASE-NOTES.md'),
    read(`release-notes/${tag}.json`).then(JSON.parse),
    readdir(path.join(root, 'release-notes')),
  ])
  const notes = renderReleaseNotes(template, tag, '0.1.1-rc.2', current)
  const currentFingerprint = JSON.stringify({ zh: current.zh, en: current.en })

  assert.equal(current.version, manifest.version)
  for (const filename of files.filter(name => name !== `${tag}.json` && /^v.+\.json$/.test(name))) {
    const other = JSON.parse(await read(`release-notes/${filename}`))
    assert.notEqual(currentFingerprint, JSON.stringify({ zh: other.zh, en: other.en }), `${tag} repeats ${filename}`)
  }
  assert.match(notes, new RegExp(regexEscape(current.zh.summary)))
  assert.match(notes, new RegExp(regexEscape(current.en.summary)))
  assert.doesNotMatch(template, /设置中新增实时插件市场|DSH Settings now includes a live Plugin Market/)
  assert.doesNotMatch(template, /rc\.8|SQLite backend/)
})

test('release notes resolve the official DSH version from the matching product channel', () => {
  assert.equal(upstreamLockNameForTag('v0.6.0-rc.1'), 'upstream.preview.lock.json')
  assert.equal(upstreamLockNameForTag('v0.6.0'), 'upstream.lock.json')
  const notes = renderReleaseNotes('Official DSH {{DSH_VERSION}}', 'v0.6.0-rc.1', '0.1.2-alpha.1')
  assert.equal(notes, 'Official DSH 0.1.2-alpha.1')
})

test('0.4.1 notes describe its actual plugin-update and session-manager changes', async () => {
  const [template, descriptor] = await Promise.all([
    read('templates/RELEASE-NOTES.md'),
    read('release-notes/v0.4.1.json').then(JSON.parse),
  ])
  const notes = renderReleaseNotes(template, 'v0.4.1', '0.1.1-rc.2', descriptor)
  assert.match(notes, /插件更新现在会在打开市场时重新检查/)
  assert.match(notes, /fresh plugin releases are rechecked when the market opens/i)
  assert.match(notes, /DSH Native Session Manager 1\.1\.0/)
})

test('0.4.2 notes describe targeted compatibility guidance and website discovery', async () => {
  const [template, descriptor] = await Promise.all([
    read('templates/RELEASE-NOTES.md'),
    read('release-notes/v0.4.2.json').then(JSON.parse),
  ])
  const notes = renderReleaseNotes(template, 'v0.4.2', '0.1.1-rc.2', descriptor)
  assert.match(notes, /明确显示插件名和目标版本/)
  assert.match(notes, /host-version range mismatch/i)
  assert.match(notes, /站点地图/)
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
  assert.doesNotMatch(workflow, /^\s{6}prerelease:/m)
  assert.match(workflow, /scripts\/version-policy\.mjs/)
  assert.match(workflow, /actions\/download-artifact@v8/)
  assert.match(workflow, /steps\.version\.outputs\.updateChannelTag/)
  assert.match(workflow, /update-channel-candidate/)
  assert.match(workflow, /stage-release-assets\.mjs/)
  assert.ok(
    workflow.indexOf('Publish curated user downloads') < workflow.indexOf('Publish the isolated machine-readable update channel'),
    'the immutable version release must be public before its update channel advertises the new version',
  )
  assert.match(workflow, /stage-release-assets\.mjs artifacts release-staging "\$\{\{ steps\.version\.outputs\.channel \}\}"/)
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /attestations:\s*write/)
  assert.match(workflow, /create-release-evidence\.mjs/)
  assert.match(workflow, /actions\/attest@v4/)
  assert.match(workflow, /subject-checksums:\s*release-staging\/user-assets\/checksums\.txt/)
  assert.match(workflow, /predicate-type:\s*https:\/\/in-toto\.io\/attestation\/test-result\/v0\.1/)
  assert.match(workflow, /predicate-path:\s*release-qualification\.json/)
  assert.ok(
    workflow.indexOf('create-release-evidence.mjs') < workflow.indexOf('actions/attest@v4')
      && workflow.indexOf('actions/attest@v4') < workflow.indexOf('Publish curated user downloads'),
    'the exact qualified user assets must be recorded and attested before publication',
  )
  assert.doesNotMatch(workflow, /update-channel-core-/)
  assert.doesNotMatch(workflow, /engine-update-assets/)
  assert.match(staging, /channel === 'candidate'/)
  assert.match(staging, /user-assets/)
  assert.match(staging, /update-assets/)
  assert.doesNotMatch(staging, /compat-assets|compatibilityAssets/)
  assert.doesNotMatch(workflow, /compat-assets/)
  assert.match(staging, /checksums\.txt/)
  assert.doesNotMatch(staging, /\.sha256['"`]/)
  assert.match(updateCore, /update-channel-\$\{releaseChannel\}/)
  assert.match(bootstrap, /releases\/download\/update-channel-stable\/portable-manifest\.json/)
  assert.match(windowsBuild, /releaseChannel\s*=\s*\$ReleaseChannel/)
  assert.match(windowsBuild, /\$ManifestBody\s*=\s*\[ordered\]@\{[\s\S]+releaseChannel\s*=\s*\$ReleaseChannel/)
  assert.match(windowsBuild, /releases\/download\/\$UpdateChannelTag\/DSH-Portable-update-windows-x64\.zip/)
  assert.match(macBuild, /"releaseChannel": "\$RELEASE_CHANNEL"/)
  assert.match(macBuild, /releases\/download\/\$UPDATE_CHANNEL_TAG\/DSH-Portable-update-macos-\$ARCH\.zip/)
})

test('every desktop platform verifies the live visual plugin marketplace', async () => {
  const workflow = await read('.github/workflows/ci.yml')
  const smoke = await read('scripts/smoke-plugin-marketplace.mjs')

  assert.match(smoke, /\/dsh-market\/registry/)
  assert.match(smoke, /\/dsh-market\/installed/)
  assert.match(smoke, /\/dsh-market\/status/)
  assert.match(smoke, /plugin\.screenshots/)
  assert.doesNotMatch(smoke, /dsh-codex-subscription|ChatGPT\s*\/\s*Codex/i)
  assert.equal((workflow.match(/smoke-plugin-marketplace\.mjs/g) || []).length, 3)
})

test('installable official updates use a short-lived PR, full product gates, and an independent core channel', async () => {
  const [workflow, autoMerge, updateCore, updater, upstreamState] = await Promise.all([
    read('.github/workflows/upstream-watch.yml'),
    read('.github/workflows/merge-verified-dependencies.yml'),
    read('launcher/update-core.mjs'),
    read('scripts/update-upstream.mjs'),
    read('scripts/upstream-state.mjs'),
  ])

  assert.match(workflow, /pull-requests:\s*write/)
  assert.match(workflow, /name:\s*Dependency intake/)
  assert.match(workflow, /repository_dispatch:/)
  assert.match(workflow, /dependency-released/)
  assert.match(workflow, /cron:\s*['"]23 \*\/6 \* \* \*['"]/, 'official installable releases must be discovered without a weekly blind spot')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /node scripts\/update-upstream\.mjs/)
  assert.match(workflow, /npm ci --prefix app --ignore-scripts[\s\S]*npm test/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /automation\/verified-dependencies/)
  assert.match(workflow, /gh pr (?:create|edit)/)
  assert.match(autoMerge, /workflow_run:/)
  assert.match(autoMerge, /conclusion == 'success'/)
  assert.match(autoMerge, /gh pr merge[\s\S]+--delete-branch/)
  assert.match(autoMerge, /actions:\s*write/)
  assert.match(autoMerge, /gh workflow run ci\.yml[^\n]+--ref main/)
  assert.match(updateCore, /WSL043\/DSH-Portable-Updates\/releases\/download\/update-channel-core-/)
  assert.doesNotMatch(updateCore, /WSL043\/DSH-Portable\/releases\/download\/update-channel-core-/)
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/)
  assert.match(workflow, /git push --force origin/)
  assert.match(updater, /registry\.npmjs\.org/)
  assert.match(updater, /\/-\/package\/@deepseek-ai%2Fdsh\/dist-tags/)
  assert.match(updater, /const needsRegistry/)
  assert.match(upstreamState, /dist-tags/)
  assert.match(upstreamState, /integrity/)
  assert.match(upstreamState, /changed:\s*packageChanged/)
  assert.match(workflow, /No candidate issue was created because there is no new installable package/)
  assert.match(updater, /package-lock-only/)
  assert.match(updater, /upstream\.lock\.json/)
  assert.match(updater, /process\.execPath/)
  assert.match(updater, /npm-cli\.js/)
  assert.match(updater, /timeout:\s*\d+/)
  assert.match(updater, /install\.signal/)
  assert.match(workflow, /timeout-minutes:\s*\d+/)
  assert.match(updater, /THIRD_PARTY_NOTICES\.md/)
  assert.match(updater, /createHash\(['"]sha256['"]\)/)
  assert.match(updater, /noticesSha256/)
  assert.doesNotMatch(updater, /process\.platform\s*===\s*['"]win32['"]\s*\?\s*['"]npm\.cmd['"]/)
})

test('all bundled defaults are accumulated by the unified dependency intake', async () => {
  const [workflow, updater, ci, publish] = await Promise.all([
    read('.github/workflows/upstream-watch.yml'),
    read('scripts/update-default-plugin.mjs'),
    read('.github/workflows/ci.yml'),
    read('.github/workflows/publish.yml'),
  ])

  assert.match(workflow, /schedule:/)
  assert.match(workflow, /repository_dispatch:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /node scripts\/update-default-plugin\.mjs/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /automation\/verified-dependencies/)
  assert.match(workflow, /gh pr (?:create|edit)/)
  assert.match(workflow, /timeout-minutes:\s*\d+/)
  assert.match(updater, /registry\.npmjs\.org\/\$\{current\.package\}/)
  assert.match(updater, /current\.repository/)
  assert.match(updater, /current\.releaseChannel/)
  assert.match(updater, /Object\.entries\(lock\.defaultPlugins/)
  assert.match(updater, /repos\/\$\{current\.repository\}\/releases\/tags/)
  assert.match(updater, /assets[\s\S]+digest/)
  assert.match(updater, /createHash\(['"]sha256['"]\)/)
  assert.match(updater, /upstream\.lock\.json/)
  assert.match(updater, /upstream\.preview\.lock\.json/)
  assert.match(updater, /path\.join\(root, ['"]launcher['"], ['"]default-plugins\.mjs['"]\)/)
  assert.match(updater, /GITHUB_OUTPUT/)
  assert.match(updater, /--check/)
  assert.match(ci, /node scripts\/update-default-plugin\.mjs --check/)
  assert.match(publish, /node scripts\/update-default-plugin\.mjs --check/)
  assert.match(workflow, /launcher\/default-plugins\.mjs[\s\S]*upstream\.preview\.lock\.json/)
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

test('Windows package exposes real GUI executables with matching icon and an isolated portable launch', async () => {
  const source = await read('launcher/windows/DSH-Portable.cs')
  const bootstrap = await read('launcher/windows/DSH-Bootstrap.cs')
  const manifest = await read('launcher/windows/DSH-Portable.manifest')
  const build = await read('scripts/build-windows.ps1')
  const policy = classifyProductVersion(JSON.parse(await read('package.json')).version)

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
  assert.match(source, /using System\.Globalization;/)
  assert.match(source, /CultureInfo\.InstalledUICulture/)
  assert.match(source, /private static string L\(string chinese, string english\)/)
  assert.match(source, /CoreWebView2EnvironmentOptions/)
  assert.match(source, /Language\s*=\s*UiLanguageTag/)
  assert.match(source, /最小化到托盘/)
  assert.match(source, /Minimize to tray/)
  assert.match(source, /正在启动 DeepSeek Harness/)
  assert.match(source, /Starting DeepSeek Harness/)
  assert.match(source, /CancelButton\s*=\s*closeButton/)
  assert.match(source, /check-update/)
  assert.match(source, /defer-update/)
  assert.match(source, /ignore-update/)
  assert.match(source, /现在更新/)
  assert.match(source, /稍后/)
  assert.match(source, /跳过此版本/)
  assert.match(source, /仅下载已变更的 DSH 应用组件/)
  assert.match(source, /full-package-required/)
  assert.match(source, /--progress-json/)
  assert.match(source, /HandleUpdateProgress/)
  assert.match(source, /HandleStartupProgress/)
  const startupProgress = source.slice(
    source.indexOf('private void HandleStartupProgress'),
    source.indexOf('private static string FormatBytes'),
  )
  assert.match(startupProgress, /IsDisposed/)
  assert.match(startupProgress, /catch \(InvalidOperationException\)/)
  assert.match(source, /progressType\s*==\s*"startup-progress"/)
  assert.match(source, /Preparing the portable runtime/)
  assert.match(source, /Loading plugins and sessions/)
  assert.match(source, /activityRing\.Value\s*=\s*percent/)
  assert.match(source, /activityRing\.Indeterminate\s*=\s*false/)
  assert.match(source, /progressDetail/)
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
  assert.match(build, /DSH-FullUpdater\.exe/)
  assert.match(build, /portable-manifest\.json/)
  assert.match(build, /releases\/download\/v\$PortableVersion\/DSH-Portable-windows-x64-offline\.zip/)
  assert.doesNotMatch(build, /releases\/download\/\$UpdateChannelTag\/DSH-Portable-windows-x64-offline\.zip/)
  assert.match(build, /update-core\.mjs/)
  assert.match(build, /DSH-UpdateExtractor\.cs/)
  assert.match(build, /DSH-Portable-update-windows-x64\.zip/)
  assert.match(build, /portable-update-windows-x64\.json/)
  assert.match(build, /dsh-core-update-windows-x64\.json/)
  assert.match(build, /updaterSchema/)
  assert.match(build, /shellSchema/)
  assert.match(build, /shellSchema\s*=\s*23/)
  assert.match(build, /requiredShellSchema\s*=\s*23/)
  assert.match(source, new RegExp(`AssemblyFileVersion\\("${regexEscape(policy.windowsVersion)}"\\)`))
  assert.match(bootstrap, /ZipArchive/)
  assert.match(bootstrap, /internal sealed class BootstrapActivityRing : Control/)
  assert.doesNotMatch(bootstrap, /private readonly ProgressBar progress;/)
  assert.match(bootstrap, /progressPercentLabel/)
  assert.match(bootstrap, /FormatBytes/)
  assert.match(bootstrap, /value\s*\+\s*"%"/)
  assert.doesNotMatch(bootstrap, /tar\.exe/i)
  assert.doesNotMatch(build, /community\.1|DeepSeek Harness\.cmd/)

  const cli = await read('launcher/portable-cli.mjs')
  assert.match(cli, /rollbackPendingAppUpdate\(layout,\s*\{[\s\S]+beforeRestore:[\s\S]+ownedState\(current\)[\s\S]+await stop\(\)/)
  assert.match(cli, /catch \(error\) \{[\s\S]+await deferUpdate\(layout, \{ scope: options\.updateScope \}\)\.catch/)
  assert.match(cli, /BROWSER_FORCE_SHUTDOWN_MS\s*=\s*15000/)
  assert.match(cli, /terminateBrowserProcess\(item, true\)[\s\S]+process\.kill\(Number\(item\.pid\)/)
})

test('plugin management is a generic finished-product capability and release gate', async () => {
  const [chinese, english, userReadme, releaseNotes, workflow, smoke] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('templates/USER-README.zh-CN.txt'),
    read('templates/RELEASE-NOTES.md'),
    read('.github/workflows/ci.yml'),
    read('scripts/smoke-windows-plugins.ps1'),
  ])
  const docs = `${chinese}\n${english}\n${userReadme}\n${releaseNotes}`
  const genericProductDocs = `${userReadme}\n${releaseNotes}`
  assert.match(chinese, /dsh plugin --profile web add <插件>/)
  assert.match(chinese, /dsh plugin --profile web (?:list|remove|update)/)
  assert.match(chinese, /dsh --profile web --dump-config/)
  assert.match(chinese, /DSH 终端[\s\S]+不会修改系统 `PATH`/)
  assert.match(english, /dsh plugin --profile web add <plugin>/i)
  assert.match(english, /DSH Terminal[\s\S]+never changes the system `PATH`/i)
  assert.match(docs, /不会自动重启|never restarts/i)
  assert.doesNotMatch(genericProductDocs, /codex|chatgpt|openai-codex|zen\s*free/i)

  assert.match(workflow, /^  windows-plugin-smoke:/m)
  assert.match(workflow, /smoke-windows-plugins\.ps1/)
  assert.match(workflow, /tests\\fixtures\\dsh-portable-smoke-plugin|tests\/fixtures\/dsh-portable-smoke-plugin/)
  assert.match(smoke, /plugin.+add/s)
  assert.match(smoke, /plugin.+list/s)
  assert.match(smoke, /plugin.+update/s)
  assert.match(smoke, /plugin.+remove/s)
  assert.match(smoke, /--dump-config/)
  assert.match(smoke, /isolated PATH/i)
  assert.match(smoke, /Get-Command -Name 'dsh'/)
  assert.match(smoke, /& dsh --version/)
  assert.match(smoke, /DSH Terminal resolved the wrong dsh executable/)
  assert.match(smoke, /Get-Command.+-CommandType\s+Application/s)
  assert.match(smoke, /PreviousErrorActionPreference/)
  assert.match(smoke, /\$ErrorActionPreference\s*=\s*'Continue'/)
  assert.match(smoke, /\$ExitCode\s*=\s*\$LASTEXITCODE/)
  assert.match(smoke, /\$null\s+-ne\s+\$ProcessExitCode/)
  assert.match(smoke, /Product-Status/)
  assert.match(smoke, /DeclaredDefaults\.Count -gt 0/)
  assert.match(smoke, /RegistryArguments/)
  assert.match(smoke, /\[System\.IO\.Directory\]::Move\(\$Root,\s*\$MovedRoot\)/)
  assert.doesNotMatch(smoke, /Move-Item\s+-LiteralPath\s+\$Root/)
  assert.doesNotMatch(smoke, /where\.exe/i)
  assert.doesNotMatch(smoke, /codex|openai-codex|zen/i)
})

test('macOS and Linux finished products verify official bare dsh syntax in an isolated terminal', async () => {
  const [smoke, workflow, macSmoke, linuxSmoke, chinese, english] = await Promise.all([
    read('scripts/smoke-unix-dsh-terminal.sh'),
    read('.github/workflows/ci.yml'),
    read('scripts/smoke-macos-desktop-host.sh'),
    read('scripts/smoke-linux-plugins.sh'),
    read('README.md'),
    read('README.en.md'),
  ])
  assert.match(smoke, /command -v dsh/)
  assert.match(smoke, /dsh --version/)
  assert.match(smoke, /USER_PATH_UNCHANGED|shell configuration/i)
  assert.match(workflow, /smoke-macos-desktop-host\.sh/)
  assert.match(workflow, /smoke-linux-plugins\.sh/)
  assert.match(macSmoke, /smoke-unix-dsh-terminal\.sh/)
  assert.match(linuxSmoke, /smoke-unix-dsh-terminal\.sh/)
  assert.match(chinese, /macOS[\s\S]+Linux[\s\S]+DSH 终端[\s\S]+dsh plugin/)
  assert.match(english, /macOS[\s\S]+Linux[\s\S]+DSH Terminal[\s\S]+dsh plugin/i)
})

test('removable offline defaults are installed only for a newly created web profile', async () => {
  const [lock, windows, macos, linux, cli, core] = await Promise.all([
    read('upstream.lock.json').then(JSON.parse),
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
    read('launcher/portable-cli.mjs'),
    read('launcher/default-plugins.mjs'),
  ])
  assert.deepEqual(Object.keys(lock.defaultPlugins).sort(), ['imageViewer', 'sessionDelete'])
  for (const plugin of Object.values(lock.defaultPlugins)) {
    assert.match(plugin.package, /^dsh-[a-z0-9-]+$/)
    assert.match(plugin.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    assert.equal(plugin.url, `https://registry.npmjs.org/${plugin.package}/-/${plugin.package}-${plugin.version}.tgz`)
    assert.match(plugin.sha256, /^[0-9a-f]{64}$/)
    assert.match(plugin.integrity, /^sha512-/)
    assert.equal(plugin.license, 'MIT')
    assert.match(plugin.reviewedCommit, /^[0-9a-f]{40}$/)
    assert.equal(plugin.filename, `${plugin.package}.tgz`)
  }
  for (const build of [windows, macos, linux]) {
    assert.match(build, /default-plugins/)
    assert.match(build, /DefaultPlugins|list-default-plugins/)
    assert.match(build, /sha256|Sha256/i)
    assert.match(build, /LICENSE/)
    assert.match(build, /THIRD-PARTY-NOTICES|THIRD_PARTY_NOTICES/)
  }
  for (const build of [macos, linux]) {
    assert.doesNotMatch(build, /\$DEFAULT_PLUGIN_SHA256/)
    assert.match(build, /list-default-plugins\.mjs" "\$COMPONENT_LOCK_FILE"/)
    assert.match(build, /"defaultPlugins": \$DEFAULT_PLUGINS_JSON/)
    assert.match(build, /runtime-capsule\.mjs/)
  }
  assert.match(cli, /seedDefaultPlugins/)
  assert.match(core, /profile-exists/)
  assert.match(core, /\.dsh-portable-archives/)
  assert.match(core, /file:\$\{paths\.relative/)
  for (const build of [windows, macos, linux]) {
    const updateSection = build.slice(build.indexOf('UPDATE_COMPONENT_ROOT'))
    assert.doesNotMatch(updateSection, /(?:cp|Copy-Item)[^\n]+default-plugins/)
  }
})

test('the marketplace candidate packages no hand-maintained portable extension catalog', async () => {
  const [chinese, english, releaseNotes] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('templates/RELEASE-NOTES.md'),
  ])
  assert.equal(await exists('desktop-bridge/extensions/catalog.json'), false)
  assert.equal(await exists('desktop-bridge/lib/extensions.js'), false)
  assert.equal(await exists('scripts/smoke-portable-catalog-extension.mjs'), false)
  assert.doesNotMatch(releaseNotes, /codex|chatgpt|dsh-codex-subscription/i)
})

test('Windows portable self-extractor stays offline, movable, and registration-free', async () => {
  const extractor = await read('installer/windows/DSH-Portable.iss')
  const innoBuild = await read('scripts/build-windows-inno.ps1')
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
  assert.match(extractor, /\[Languages\]/)
  assert.match(extractor, /compiler:Default\.isl/)
  assert.match(extractor, /compiler:Languages\\ChineseSimplified\.isl/)
  assert.match(extractor, /LanguageDetectionMethod=uilanguage/)
  assert.match(extractor, /ShowLanguageDialog=auto/)
  assert.match(extractor, /english\.StartApp=/)
  assert.match(extractor, /chinesesimplified\.StartApp=/)
  assert.match(extractor, /Source:\s*"\{#Stage\}\\\*";\s*DestDir:\s*"\{app\}"/)
  assert.doesNotMatch(extractor, /Excludes:/)
  assert.doesNotMatch(extractor, /\[Icons\]|\[Registry\]|installed-mode\.json/i)

  assert.match(innoBuild, /DSH-Portable-windows-x64-offline\.exe/)
  assert.match(innoBuild, /installer\\windows\\DSH-Portable\.iss/)
  for (const compilerConsumer of [innoBuild]) {
    assert.doesNotMatch(compilerConsumer, /--version/)
    assert.match(compilerConsumer, /VersionInfo/)
    assert.match(compilerConsumer, /ProductVersion/)
    assert.match(compilerConsumer, /FileVersion/)
    assert.match(compilerConsumer, /ProcessStartInfo/)
    assert.match(compilerConsumer, /RedirectStandardOutput\s*=\s*\$true/)
    assert.match(compilerConsumer, /RedirectStandardError\s*=\s*\$true/)
    assert.match(compilerConsumer, /Inno Setup\\s\+/)
    assert.match(compilerConsumer, /--quiet/)
  }
  assert.match(innoBuild, /Inno Setup 7 or newer/)
  assert.match(innoBuild, /LocalApplicationData[\s\S]+Inno Setup 7[\\/]ISCC\.exe/)
  assert.doesNotMatch(innoBuild, /Inno Setup 6/)
  assert.match(smoke, /DSH-Portable-windows-x64-offline\.exe/)
  assert.match(smoke, /\/DIR=/)
  assert.match(smoke, /\/DIR="\{0\}"/)
  assert.match(smoke, /\/LOG="\{1\}"/)
  assert.match(smoke, /Start-Process[\s\S]+-ArgumentList \$ExtractorArguments/)
  assert.match(smoke, /\[char\]0x00FC/)
  assert.match(smoke, /installed-mode\.json/)
  assert.match(smoke, /unins\*\.exe/)
  assert.match(smoke, /runtime\\DSH-App\.dshpack/)
  assert.match(smoke, /runtime-capsule\.json/)
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
  const policy = classifyProductVersion(JSON.parse(await read('package.json')).version)

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
  assert.match(build, /dsh-core-update-macos-\$ARCH\.json/)
  assert.match(build, /"shellSchema": 18/)
  assert.match(build, /"requiredShellSchema": 18/)
  assert.match(plist, new RegExp(`<key>CFBundleVersion<\\/key>\\s*<string>${regexEscape(policy.macBuildVersion)}<\\/string>`, 's'))
  assert.match(app, /check-update/)
  assert.match(app, /Check for Updates|检查更新/)
  assert.match(app, /Check for updates at startup|启动时检查更新/)
  assert.match(app, /updateCheckEnabled/)
  assert.match(app, /issues\/new\?template=bug-report\.yml/)
  assert.match(app, /check-update", "--scope", scope, "--json", "--force/)
  assert.match(app, /check-update", "--scope", scope, "--json"/)
  assert.match(app, /update", "--scope", pendingUpdateScope/)
  assert.match(app, /productUpdateCheckEnabled/)
  assert.match(app, /engineUpdateCheckEnabled/)
  assert.match(app, /defer-update/)
  assert.match(app, /ignore-update/)
  assert.match(app, /Skip This Version|跳过此版本/)
  assert.match(app, /DSH-Portable update|DSH-Portable 更新/)
  assert.match(app, /Bundled official DSH|内置官方 DSH/)
  assert.match(app, /Delivery: component update|交付方式：轻量更新/)
  assert.match(app, /--progress-json/)
  assert.match(app, /presentUpdateProgress/)
  assert.match(app, /receivedBytes/)
  assert.match(app, /totalBytes/)
  assert.match(app, /FileHandle\.standardError\.write/)
  assert.doesNotMatch(app, /--app=/)

  const launchDesktop = app.slice(
    app.indexOf('private func launchDesktop()'),
    app.indexOf('private func presentUpdateProgress'),
  )
  const startIndex = launchDesktop.indexOf('runCLI(["start", "--no-browser", "--json"])')
  const showIndex = launchDesktop.indexOf('showWebView(url)')
  const backgroundCheckIndex = launchDesktop.indexOf('checkForUpdateAfterStartup()')
  assert.ok(startIndex >= 0 && showIndex > startIndex && backgroundCheckIndex > showIndex)
  assert.doesNotMatch(launchDesktop.slice(0, startIndex), /checkAndApplyUpdate/)
  assert.match(app, /installUpdateAtNextLaunch/)
  assert.match(app, /applyPendingUpdateBeforeStartup/)
  const pendingUpdate = app.slice(
    app.indexOf('private func applyPendingUpdateBeforeStartup()'),
    app.indexOf('private func checkForUpdateAfterStartup()'),
  )
  const pendingRunIndex = pendingUpdate.indexOf('runCLI(["update"')
  const pendingClearIndex = pendingUpdate.indexOf('installUpdateAtNextLaunch = false')
  assert.ok(
    pendingRunIndex >= 0 && pendingClearIndex > pendingRunIndex,
    'a failed macOS update must remain scheduled for the following launch',
  )
})

test('CI executes contracts and real package smoke tests on Windows and both Mac architectures', async () => {
  const workflow = await read('.github/workflows/ci.yml')
  const upstreamWorkflow = await read('.github/workflows/upstream-watch.yml')
  const desktopHostSmoke = await read('scripts/smoke-windows-desktop-host.ps1')
  const desktopMoveSmoke = await read('scripts/smoke-windows-desktop-move.ps1')
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
  assert.match(bootstrapSmoke, /the packaged full updater failed:[\s\S]+resultFile/)
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
    'macos-build:',
    'macos-portable-smoke:',
    'macos-desktop-host:',
  ]) assert.match(workflow, new RegExp(`^  ${job.replace(':', '\\:')}`, 'm'))
  assert.match(workflow, /actionlint_1\.7\.12_linux_amd64\.tar\.gz/)
  assert.match(workflow, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/)
  assert.match(workflow, /\.\/actionlint/)
  assert.match(workflow, /windows-desktop-host:[\s\S]+needs:\s*windows-build/)
  assert.match(workflow, /smoke-windows-desktop-move\.ps1/)
  assert.match(workflow, /windows-2022[\s\S]+firstColdStartSeconds:\s*75/)
  assert.match(workflow, /windows-2025[\s\S]+firstColdStartSeconds:\s*75/)
  const windowsBaseJob = workflow.match(/\n  windows-build:[\s\S]+?(?=\n  [a-z][\w-]+:)/)?.[0] || ''
  const windowsInnoJob = workflow.match(/\n  windows-inno-build:[\s\S]+?(?=\n  [a-z][\w-]+:)/)?.[0] || ''
  assert.doesNotMatch(windowsBaseJob, /BuildInstaller|ISCC|Inno Setup/)
  assert.match(windowsInnoJob, /needs:\s*windows-build/)
  assert.match(windowsInnoJob, /strategy:[\s\S]+matrix:[\s\S]+kind:\s*portable/)
  assert.doesNotMatch(windowsInnoJob, /kind:\s*installer/)
  assert.match(windowsInnoJob, /build-windows-inno\.ps1/)
  assert.match(workflow, /windows-extractor-smoke:[\s\S]+needs:\s*windows-inno-build[\s\S]+name:\s*windows-x64-extractor/)
  assert.match(desktopHostSmoke, /DeepSeek-Herness\.exe/)
  assert.match(desktopHostSmoke, /AppUserModelID/)
  assert.match(desktopHostSmoke, /MainWindowHandle/)
  assert.match(desktopHostSmoke, /CloseMainWindow/)
  assert.match(desktopHostSmoke, /WebView2/)
  assert.match(desktopHostSmoke, /browser\.json/)
  assert.match(desktopHostSmoke, /--app=/)
  assert.match(desktopHostSmoke, /--no-browser/)
  assert.match(desktopHostSmoke, /ColdStartSeconds/)
  assert.match(workflow, /smoke-windows-desktop-move\.ps1/)
  assert.match(desktopMoveSmoke, /Move-Item/)
  assert.match(desktopMoveSmoke, /smoke-windows-desktop-host\.ps1/g)
  assert.doesNotMatch(desktopMoveSmoke, /Wait-ForPortableWebViewExit|msedgewebview2\.exe/)
  assert.match(workflow, /macos-desktop-host:[\s\S]+needs:\s*macos-build/)
  assert.match(workflow, /smoke-macos-desktop-host\.sh/)
  assert.match(macDesktopHostSmoke, /DSH-Portable\.app/)
  assert.match(macDesktopHostSmoke, /WebKit|WKWebView/)
  assert.match(macDesktopHostSmoke, /osascript/)
  assert.match(macDesktopHostSmoke, /browser\.json/)
  assert.match(macDesktopHostSmoke, /--app=/)
  assert.match(macDesktopHostSmoke, /--no-browser/)
})

test('CI upgrades a running published Windows product and injects the WebView2 restart race', async () => {
  const [workflow, smoke] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('scripts/smoke-windows-version-upgrade.mjs'),
  ])
  assert.match(workflow, /^  windows-version-upgrade-smoke:/m)
  assert.match(workflow, /gh release list --repo "\$env:GITHUB_REPOSITORY"[\s\S]+isPrerelease/)
  assert.match(workflow, /\[regex\]::Match\(\$_\.tagName, '\^v[\s\S]+\$_\.isPrerelease/)
  assert.match(workflow, /Groups\[['"]base['"]\]\.Value[\s\S]+Groups\[['"]rc['"]\]\.Value/)
  assert.match(workflow, /-not \$_\.isPrerelease[\s\S]+\$_\.tagName -match '\^v\\d\+[\s\S]+\$_\.tagName -ne "v\$CandidateVersion"/)
  assert.doesNotMatch(workflow, /gh release view --repo "\$env:GITHUB_REPOSITORY" --json tagName/)
  assert.match(workflow, /gh release download \$Release\.tagName/)
  assert.match(workflow, /COMPONENTS\.json/)
  assert.match(workflow, /Components\.shellSchema[\s\S]+Target\.requiredShellSchema/)
  assert.match(workflow, /Components\.runtimeLayout[\s\S]+Target\.targetRuntimeLayout/)
  assert.match(workflow, /smoke-windows-version-upgrade\.mjs[\s\S]+--running-host[\s\S]+--simulate-webview-busy/)
  assert.match(workflow, /Components\.releaseChannel[\s\S]+Target\.releaseChannel[\s\S]+--allow-channel-migration/)
  assert.match(smoke, /\['stable', 'candidate'\]\.includes\(fullManifestSource\.releaseChannel\)/)
  assert.match(smoke, /componentManifestSource\.releaseChannel, fullManifestSource\.releaseChannel/)
  assert.match(smoke, /oldComponents\.portableVersion, fullManifestSource\.version/)
})

test('Node runtime lock covers Windows, macOS, and both Linux CPU families', async () => {
  const lock = JSON.parse(await read('upstream.lock.json'))
  assert.equal(lock.node.version, '24.19.0')
  assert.match(lock.node.runtimes['win-x64'].archive, /win-x64\.zip$/)
  assert.match(lock.node.runtimes['darwin-arm64'].archive, /darwin-arm64\.tar\.gz$/)
  assert.match(lock.node.runtimes['darwin-x64'].archive, /darwin-x64\.tar\.gz$/)
  assert.match(lock.node.runtimes['linux-arm64'].archive, /linux-arm64\.tar\.xz$/)
  assert.match(lock.node.runtimes['linux-x64'].archive, /linux-x64\.tar\.xz$/)
  for (const runtime of Object.values(lock.node.runtimes)) assert.match(runtime.sha256, /^[0-9a-f]{64}$/)
})
