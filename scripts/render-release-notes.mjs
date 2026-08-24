import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function releaseLocale(value, label) {
  if (!value || typeof value.summary !== 'string' || value.summary.trim().length < 12) {
    throw new Error(`${label} release summary is missing or too short.`)
  }
  if (!Array.isArray(value.highlights) || value.highlights.length < 1 || value.highlights.length > 6
    || value.highlights.some(item => typeof item !== 'string' || item.trim().length < 12)) {
    throw new Error(`${label} release highlights must contain 1-6 useful items.`)
  }
  return { summary: value.summary.trim(), highlights: value.highlights.map(item => item.trim()) }
}

export function validateReleaseDescriptor(value, tag) {
  const version = String(tag).replace(/^v/, '')
  if (!value || value.version !== version) throw new Error(`release-notes/${tag}.json must describe ${version}.`)
  const zh = releaseLocale(value.zh, 'Chinese')
  const en = releaseLocale(value.en, 'English')
  return { version, zh, en }
}

function highlights(items) {
  return items.map(item => `- ${item}`).join('\n')
}

export function renderReleaseNotes(source, tag, dshVersion, descriptor = null) {
  if (!/^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(String(tag))) {
    throw new Error('A stable or release-candidate tag is required to render release notes.')
  }
  if (!/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(String(dshVersion))) {
    throw new Error('The pinned official DSH version is required to render release notes.')
  }
  const candidate = /-rc\./.test(tag)
  const release = descriptor === null
    ? {
        zh: { summary: `${tag.slice(1)} 的用户更新。`, highlights: [] },
        en: { summary: `User-facing changes in ${tag.slice(1)}.`, highlights: [] },
      }
    : validateReleaseDescriptor(descriptor, tag)
  const replacements = {
    '{{PRODUCT_VERSION}}': tag.slice(1),
    '{{DSH_VERSION}}': dshVersion,
    '{{RELEASE_INTRO_ZH}}': candidate
      ? `**这是候选版，不会推送给稳定版用户。**`
      : '',
    '{{RELEASE_INTRO_EN}}': candidate
      ? `**This is a release candidate and is not offered to stable users.**`
      : '',
    '{{RELEASE_SUMMARY_ZH}}': release.zh.summary,
    '{{RELEASE_SUMMARY_EN}}': release.en.summary,
    '{{RELEASE_HIGHLIGHTS_ZH}}': highlights(release.zh.highlights),
    '{{RELEASE_HIGHLIGHTS_EN}}': highlights(release.en.highlights),
    '{{VERIFICATION_SCOPE_ZH}}': candidate
      ? '候选成品会经过 Windows、macOS、Linux x64 与 ARM64 验收。'
      : '正式成品已通过 Windows、macOS、Linux x64 与 ARM64 验收。',
    '{{VERIFICATION_SCOPE_EN}}': candidate
      ? 'Candidate artifacts are verified on Windows, macOS, Linux x64, and Linux ARM64.'
      : 'Stable artifacts are verified on Windows, macOS, Linux x64, and Linux ARM64.',
    '{{CHANNEL_UPGRADE_NOTICE_ZH}}': candidate
      ? '如果你正在使用仍指向稳定更新通道的较早候选版，请从本页手动下载一次与你的系统匹配的完整包；从此版本开始，后续候选版只检查候选更新通道，正式版发布后会正常升级到正式版。'
      : '',
    '{{CHANNEL_UPGRADE_NOTICE_EN}}': candidate
      ? 'If an earlier candidate still checks the stable update channel, manually download the complete package for your system from this release once. From this version onward, candidates check only the candidate channel and will advance to the final stable release when it is published.'
      : '',
    '{{WINDOWS_PRIMARY_FILENAME}}': candidate
      ? 'DSH-Portable-windows-x64-offline.zip'
      : 'DSH-Portable-windows-x64.exe',
    '{{WINDOWS_PRIMARY_GUIDE_ZH}}': candidate
      ? '解压后直接运行文件夹中的 `DeepSeek-Herness.exe`。会话、设置、插件和工作区都保存在这个可移动目录中。'
      : '双击后会在旁边准备可移动的 `DSH-Portable` 文件夹。以后直接运行文件夹中的 `DeepSeek-Herness.exe`。',
    '{{WINDOWS_PRIMARY_GUIDE_EN}}': candidate
      ? 'Extract the archive, then run `DeepSeek-Herness.exe` inside the folder. Sessions, settings, plugins, and the workspace stay in this movable directory.'
      : 'Run it once to create a movable `DSH-Portable` folder beside the launcher. Afterwards, start `DeepSeek-Herness.exe` inside that folder.',
  }
  let rendered = String(source)
  for (const [token, value] of Object.entries(replacements)) rendered = rendered.replaceAll(token, value)
  const result = rendered.replaceAll(
    'https://github.com/WSL043/DSH-Portable/releases/latest/download/',
    `https://github.com/WSL043/DSH-Portable/releases/download/${tag}/`,
  ).replace(/\n{3,}/g, '\n\n')
  const unresolved = result.match(/\{\{[A-Z0-9_]+\}\}/g)
  if (unresolved !== null) throw new Error(`Unresolved release-note tokens: ${[...new Set(unresolved)].join(', ')}`)
  return result
}

async function loadReleaseDescriptor(projectRoot, tag) {
  const directory = path.join(projectRoot, 'release-notes')
  const filename = `${tag}.json`
  const descriptor = validateReleaseDescriptor(
    JSON.parse(await readFile(path.join(directory, filename), 'utf8')),
    tag,
  )
  const fingerprint = JSON.stringify({ zh: descriptor.zh, en: descriptor.en })
  for (const candidate of await readdir(directory)) {
    if (candidate === filename || !/^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?\.json$/.test(candidate)) continue
    const other = validateReleaseDescriptor(
      JSON.parse(await readFile(path.join(directory, candidate), 'utf8')),
      candidate.slice(0, -'.json'.length),
    )
    const otherFingerprint = JSON.stringify({ zh: other.zh, en: other.en })
    if (fingerprint === otherFingerprint) throw new Error(`${filename} repeats the release content from ${candidate}.`)
  }
  return descriptor
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const [, , input, output, tag] = process.argv
  if (!input || !output || !tag) throw new Error('usage: node render-release-notes.mjs <input> <output> <tag>')
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const upstream = JSON.parse(await readFile(path.join(projectRoot, 'upstream.lock.json'), 'utf8'))
  const descriptor = await loadReleaseDescriptor(projectRoot, tag)
  const rendered = renderReleaseNotes(await readFile(input, 'utf8'), tag, upstream.dsh.version, descriptor)
  await writeFile(output, rendered, 'utf8')
}
