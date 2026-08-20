import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function renderReleaseNotes(source, tag) {
  if (!/^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(String(tag))) {
    throw new Error('A stable or release-candidate tag is required to render release notes.')
  }
  const candidate = /-rc\./.test(tag)
  const replacements = {
    '{{PRODUCT_VERSION}}': tag.slice(1),
    '{{RELEASE_INTRO_ZH}}': candidate
      ? `${tag.slice(1)} 是插件市场候选版，不会推送给稳定版用户：`
      : `${tag.slice(1)} 是正式版：`,
    '{{RELEASE_INTRO_EN}}': candidate
      ? `${tag.slice(1)} is the Plugin Market candidate and is not offered to stable users:`
      : `${tag.slice(1)} is a stable release:`,
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
  return rendered.replaceAll(
    'https://github.com/WSL043/DSH-Portable/releases/latest/download/',
    `https://github.com/WSL043/DSH-Portable/releases/download/${tag}/`,
  )
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const [, , input, output, tag] = process.argv
  if (!input || !output || !tag) throw new Error('usage: node render-release-notes.mjs <input> <output> <tag>')
  const rendered = renderReleaseNotes(await readFile(input, 'utf8'), tag)
  await writeFile(output, rendered, 'utf8')
}
