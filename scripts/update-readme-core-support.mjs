import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defaultEngineUpdateIndexUrl, platformUpdateKey } from '../launcher/update-core.mjs'

export function supportedVersions(index, baseline, platform, channel) {
  if (index.schemaVersion !== 1 || index.platform !== platform || index.channel !== channel || !Array.isArray(index.versions)) throw new Error('Invalid published core index')
  return [...new Set(index.versions.filter(entry => {
    const m = entry.manifest
    return m?.updateKind === 'engine' && m.portableVersion === baseline && m.platform === platform && m.releaseChannel === channel && m.component?.dshVersion === entry.version
  }).map(entry => {
    if (!/^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/.test(entry.version)) throw new Error('Invalid core version')
    return entry.version
  }))]
}

const begin = '<!-- core-support:start -->'
const end = '<!-- core-support:end -->'
export function replaceSupport(text, section) {
  const start = text.indexOf(begin), stop = text.indexOf(end)
  if (start < 0 || stop < start || text.indexOf(begin, start + 1) !== -1) throw new Error('Missing or duplicate support markers')
  return text.slice(0, start) + begin + '\n' + section + '\n' + text.slice(stop)
}

async function json(url) {
  const headers = url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Published catalog request failed: ${response.status} ${url}`)
  return response.json()
}

export async function updateReadmes() {
  const release = await json('https://api.github.com/repos/WSL043/DSH-Portable/releases/latest')
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name) || release.draft || release.prerelease) throw new Error('Invalid stable baseline')
  const baseline = release.tag_name.slice(1)
  const platforms = [['Windows x64', 'win32', 'x64'], ['macOS arm64', 'darwin', 'arm64'], ['macOS x64', 'darwin', 'x64'], ['Linux x64', 'linux', 'x64'], ['Linux arm64', 'linux', 'arm64']]
  const rows = await Promise.all(platforms.map(async ([label, platform, arch]) => {
    const channels = await Promise.all(['stable', 'candidate'].map(async channel => {
      const url = defaultEngineUpdateIndexUrl(channel, platform, arch, baseline)
      const versions = supportedVersions(await json(url), baseline, platformUpdateKey(platform, arch), channel)
      return versions.length ? versions.map(v => `[${v}](${url})`).join(', ') : '—'
    }))
    return `| ${label} | ${channels.join(' | ')} |`
  }))
  // Fetch and validate every platform before touching either document.
  const updates = await Promise.all(['README.md', 'README.en.md'].map(async (name, i) => {
    const zh = i === 0
    const intro = zh
      ? `### 可选内核版本\n\n**版本选择从 0.6.5-rc.1 提供，正式版从 0.6.5 开始支持。** 在「设置 → 更新」分别选择 Portable 和内核版本。\n\n下表对应最新正式版 **Portable ${baseline}** 的已发布内核目录；旧版和 RC 的可选范围可能不同，以应用内兼容检查为准。`
      : `### Selectable core versions\n\n**Version selection is available from 0.6.5-rc.1, or 0.6.5 for stable releases.** Select Portable and core versions separately in Settings → Updates.\n\nThis table reflects published core catalogs for the latest stable **Portable ${baseline}**. Older and RC builds may offer different versions; the application checks compatibility.`
    const table = zh ? '| 平台 | 稳定通道 | 候选通道 |' : '| Platform | Stable channel | Candidate channel |'
    const note = zh ? '列表每小时自动同步已验收并发布的目录；官方发布后需先完成兼容验收，并非立即支持。通道名称不代表官方内核自身的版本阶段。— 表示该平台暂无匹配目录项。' : 'The list syncs hourly from qualified, published catalogs. New official releases appear after compatibility qualification, not immediately. Channel names do not change the upstream version maturity. — means no matching catalog entry.'
    const content = `${intro}\n\n${table}\n| --- | --- | --- |\n${rows.join('\n')}\n\n${note}\n`
    const url = new URL(`../${name}`, import.meta.url)
    const original = await readFile(url, 'utf8')
    return { url, original, next: replaceSupport(original, content) }
  }))
  for (const { url, original, next } of updates) if (original !== next) await writeFile(url, next)
  console.log(`README core catalogs synchronized for Portable ${baseline}`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) await updateReadmes()
