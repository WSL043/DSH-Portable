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
  const optional = {}
  for (const key of ['knownIssues', 'upgradeNotes']) {
    if (value[key] === undefined) continue
    if (!Array.isArray(value[key]) || value[key].some(item => typeof item !== 'string' || item.trim().length < 12)) {
      throw new Error(`${label} ${key} must contain useful text items.`)
    }
    optional[key] = value[key].map(item => item.trim())
  }
  return { summary: value.summary.trim(), highlights: value.highlights.map(item => item.trim()), ...optional }
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

function optionalSection(title, items = []) {
  return items.length ? `### ${title}\n\n${highlights(items)}` : ''
}

export function renderReleaseNotes(source, tag, dshVersion, descriptor = null) {
  if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(String(tag))) {
    throw new Error('A stable, alpha, beta, or release-candidate tag is required to render release notes.')
  }
  if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(String(dshVersion))) {
    throw new Error('The pinned official DSH version is required to render release notes.')
  }
  const stage = /-(alpha|beta|rc)\./.exec(tag)?.[1] ?? 'stable'
  const candidate = stage !== 'stable'
  const releaseIntro = {
    alpha: {
      zh: '**这是 Alpha 开发阶段版本，功能仍可能不完整或不稳定，不会推送给稳定版用户。**',
      en: '**This is an Alpha development build. Features may still be incomplete or unstable, and it is not offered to stable users.**',
    },
    beta: {
      zh: '**这是 Beta 真实测试阶段版本，主要功能已经可用，但仍可能发现回归，不会推送给稳定版用户。**',
      en: '**This is a Beta build for real-world testing. Core features are usable, but regressions may remain, and it is not offered to stable users.**',
    },
    rc: {
      zh: '**这是 RC 最终验证阶段版本，当前构建已基本达到正式发布标准，不会推送给稳定版用户。**',
      en: '**This is an RC build for final validation. It is expected to meet the stable-release bar and is not offered to stable users.**',
    },
  }
  const alphaMigrationNotice = {
    zh: '历史 RC 标签不会改写；由于 SemVer 会把同版本号的 RC 排在 Alpha 之后，使用 0.6.0 历史 RC 的用户需要从本页手动下载一次完整包。此后 Alpha、Beta、RC 和正式版将按正常成熟度顺序推进。',
    en: 'Historical RC tags remain unchanged. Because SemVer orders an RC after an Alpha with the same base version, users of the historical 0.6.0 RC builds must manually download a complete package from this page once. Future Alpha, Beta, RC, and stable releases will then advance in conventional maturity order.',
  }
  const release = descriptor === null
    ? {
        zh: { summary: `${tag.slice(1)} 的用户更新。`, highlights: [] },
        en: { summary: `User-facing changes in ${tag.slice(1)}.`, highlights: [] },
      }
    : validateReleaseDescriptor(descriptor, tag)
  const replacements = {
    '{{PRODUCT_VERSION}}': tag.slice(1),
    '{{DSH_VERSION}}': dshVersion,
    '{{RELEASE_INTRO_ZH}}': candidate ? releaseIntro[stage].zh : '',
    '{{RELEASE_INTRO_EN}}': candidate ? releaseIntro[stage].en : '',
    '{{RELEASE_SUMMARY_ZH}}': release.zh.summary,
    '{{RELEASE_SUMMARY_EN}}': release.en.summary,
    '{{RELEASE_HIGHLIGHTS_ZH}}': highlights(release.zh.highlights),
    '{{RELEASE_HIGHLIGHTS_EN}}': highlights(release.en.highlights),
    '{{RELEASE_KNOWN_ISSUES_ZH}}': optionalSection('已知限制', release.zh.knownIssues),
    '{{RELEASE_KNOWN_ISSUES_EN}}': optionalSection('Known limitations', release.en.knownIssues),
    '{{RELEASE_UPGRADE_NOTES_ZH}}': optionalSection('升级说明', release.zh.upgradeNotes),
    '{{RELEASE_UPGRADE_NOTES_EN}}': optionalSection('Upgrade notes', release.en.upgradeNotes),
    '{{VERIFICATION_SCOPE_ZH}}': candidate
      ? '候选成品会经过 Windows、macOS、Linux x64 与 ARM64 验收。'
      : '正式成品已通过 Windows、macOS、Linux x64 与 ARM64 验收。',
    '{{VERIFICATION_SCOPE_EN}}': candidate
      ? 'Candidate artifacts are verified on Windows, macOS, Linux x64, and Linux ARM64.'
      : 'Stable artifacts are verified on Windows, macOS, Linux x64, and Linux ARM64.',
    '{{CHANNEL_UPGRADE_NOTICE_ZH}}': candidate
      ? tag === 'v0.6.0-alpha.1' ? alphaMigrationNotice.zh : '候选版用于测试；请从本页下载与你的系统匹配的完整包，或在便携版设置中主动选择候选更新通道。'
      : '',
    '{{CHANNEL_UPGRADE_NOTICE_EN}}': candidate
      ? tag === 'v0.6.0-alpha.1' ? alphaMigrationNotice.en : 'For testing, download the complete package for your system from this release, or explicitly select the candidate channel in Portable settings.'
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

export function upstreamLockNameForTag(tag) {
  return /-(?:alpha|beta|rc)\.[1-9]\d*$/.test(String(tag))
    ? 'upstream.preview.lock.json'
    : 'upstream.lock.json'
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
    if (candidate === filename || !/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?\.json$/.test(candidate)) continue
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
  const upstream = JSON.parse(await readFile(path.join(projectRoot, upstreamLockNameForTag(tag)), 'utf8'))
  const descriptor = await loadReleaseDescriptor(projectRoot, tag)
  const rendered = renderReleaseNotes(await readFile(input, 'utf8'), tag, upstream.dsh.version, descriptor)
  await writeFile(output, rendered, 'utf8')
}
