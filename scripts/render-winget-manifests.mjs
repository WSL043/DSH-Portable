import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const packageIdentifier = 'WSL043.DSH-Portable'
const manifestVersion = '1.12.0'
const productCode = '{1F096C3A-7991-4E55-B0F9-68A50B24C5A8}_is1'

function requireStableVersion(value) {
  const version = String(value ?? '').trim()
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`${version || '<empty>'} is not a stable semantic version.`)
  }
  return version
}

function requireSha256(value) {
  const digest = String(value ?? '').trim().toUpperCase()
  if (!/^[0-9A-F]{64}$/.test(digest)) throw new Error('A 64-character installer SHA-256 is required.')
  return digest
}

function requireDate(value) {
  const date = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error('Release date must use YYYY-MM-DD.')
  }
  return date
}

export function renderWingetManifests({ version: rawVersion, installerSha256: rawSha256, releaseDate: rawDate }) {
  const version = requireStableVersion(rawVersion)
  const installerSha256 = requireSha256(rawSha256)
  const releaseDate = requireDate(rawDate)
  const releaseUrl = `https://github.com/WSL043/DSH-Portable/releases/tag/v${version}`
  const installerUrl = `https://github.com/WSL043/DSH-Portable/releases/download/v${version}/DeepSeek-Herness-Setup.exe`

  return {
    [`${packageIdentifier}.yaml`]: `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${manifestVersion}.schema.json
PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${manifestVersion}
`,
    [`${packageIdentifier}.installer.yaml`]: `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${manifestVersion}.schema.json
PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
MinimumOSVersion: 10.0.17763.0
InstallerType: inno
Scope: user
InstallerSwitches:
  Silent: /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
  SilentWithProgress: /SILENT /SUPPRESSMSGBOXES /NORESTART
  Custom: /NORESTART
UpgradeBehavior: install
ProductCode: '${productCode}'
ReleaseDate: ${releaseDate}
AppsAndFeaturesEntries:
- DisplayName: DeepSeek-Herness ${version}
  Publisher: WSL043
  DisplayVersion: ${version}
  ProductCode: '${productCode}'
Installers:
- Architecture: x64
  InstallerUrl: ${installerUrl}
  InstallerSha256: ${installerSha256}
ManifestType: installer
ManifestVersion: ${manifestVersion}
`,
    [`${packageIdentifier}.locale.en-US.yaml`]: `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${manifestVersion}.schema.json
PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: WSL043
PublisherUrl: https://github.com/WSL043
PublisherSupportUrl: https://github.com/WSL043/DSH-Portable/issues
PackageName: DSH-Portable
PackageUrl: https://wsl043.github.io/DSH-Portable/
License: MIT
LicenseUrl: https://github.com/WSL043/DSH-Portable/blob/main/LICENSE
Copyright: Copyright (c) 2026 WSL043
ShortDescription: Portable-first desktop distribution of DeepSeek Harness
Description: A community-maintained desktop distribution of DeepSeek Harness with movable data, tested updates, plugin management, and native Windows integration. It is not an official DeepSeek desktop app.
Moniker: dsh-portable
Tags:
- ai-agent
- deepseek
- deepseek-harness
- desktop
- portable
ReleaseNotesUrl: ${releaseUrl}
ManifestType: defaultLocale
ManifestVersion: ${manifestVersion}
`,
    [`${packageIdentifier}.locale.zh-CN.yaml`]: `# yaml-language-server: $schema=https://aka.ms/winget-manifest.locale.${manifestVersion}.schema.json
PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
PackageLocale: zh-CN
Publisher: WSL043
PublisherUrl: https://github.com/WSL043
PublisherSupportUrl: https://github.com/WSL043/DSH-Portable/issues
PackageName: DSH-Portable
PackageUrl: https://wsl043.github.io/DSH-Portable/
License: MIT
LicenseUrl: https://github.com/WSL043/DSH-Portable/blob/main/LICENSE
Copyright: Copyright (c) 2026 WSL043
ShortDescription: 便携优先的 DeepSeek Harness 桌面发行版
Description: 由社区维护的 DeepSeek Harness 桌面发行版，提供可移动数据、经过成品验收的更新、插件管理与原生 Windows 集成；并非 DeepSeek 官方桌面应用。
Tags:
- AI-Agent
- DeepSeek
- DeepSeek-Harness
- 便携
- 桌面
ReleaseNotesUrl: ${releaseUrl}
ManifestType: locale
ManifestVersion: ${manifestVersion}
`,
  }
}

export async function writeWingetManifests(input, outputDirectory) {
  const files = renderWingetManifests(input)
  const destination = path.resolve(outputDirectory)
  await mkdir(destination, { recursive: true })
  await Promise.all(Object.entries(files).map(([name, body]) => writeFile(path.join(destination, name), body, 'utf8')))
  return { destination, files: Object.keys(files) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, installerSha256, releaseDate, outputDirectory] = process.argv.slice(2)
  if (!outputDirectory) throw new Error('Usage: render-winget-manifests.mjs <version> <installer-sha256> <release-date> <output-directory>')
  const result = await writeWingetManifests({ version, installerSha256, releaseDate }, outputDirectory)
  console.log(JSON.stringify(result))
}
