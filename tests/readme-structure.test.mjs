import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const exists = async (filename) => access(filename).then(() => true, () => false)

function readmeDownloadNames(source) {
  return new Set([...source.matchAll(/releases\/latest\/download\/([^)\s"'<>]+)/g)].map((match) => match[1]))
}

function relativeTargets(source) {
  const markdown = [...source.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1])
  const html = [...source.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1])
  return [...markdown, ...html]
    .map((target) => target.trim().replace(/^<|>$/g, '').split(/\s+/)[0])
    .filter((target) => target && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target))
}

test('bilingual READMEs retain matching core markers, download assets, and valid relative links', async () => {
  const [chinese, english, staging] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('scripts/stage-release-assets.mjs'),
  ])

  for (const [name, document] of [['README.md', chinese], ['README.en.md', english]]) {
    assert.equal((document.match(/<!-- core-support:start -->/g) || []).length, 1, name)
    assert.equal((document.match(/<!-- core-support:end -->/g) || []).length, 1, name)
    assert.ok(document.indexOf('<!-- core-support:start -->') < document.indexOf('<!-- core-support:end -->'), name)
  }

  const chineseDownloads = readmeDownloadNames(chinese)
  const englishDownloads = readmeDownloadNames(english)
  const userAssetsBlock = staging.match(/const userAssets = \[([\s\S]*?)\n\]/)?.[1]
  assert.ok(userAssetsBlock, 'release staging must declare user-facing assets')
  const stagedDownloads = new Set(
    [...userAssetsBlock.matchAll(/'([^']+\.(?:exe|zip|tar\.gz|AppImage))'/g)].map((match) => match[1]),
  )
  assert.deepEqual([...chineseDownloads].sort(), [...englishDownloads].sort())
  assert.deepEqual([...chineseDownloads].sort(), [...stagedDownloads].sort())

  for (const [name, document] of [['README.md', chinese], ['README.en.md', english]]) {
    for (const target of relativeTargets(document)) {
      const filename = target.split(/[?#]/, 1)[0]
      if (!filename) continue
      const resolved = path.resolve(root, decodeURIComponent(filename))
      assert.equal(await exists(resolved), true, name + ' link target is missing: ' + target)
    }
  }
})

test('bilingual user guides expose the same number of chapter headings', async () => {
  const [chinese, english] = await Promise.all([
    read('docs/user-guide.zh-CN.md'),
    read('docs/user-guide.en.md'),
  ])
  const headingCount = (document) => (document.match(/^#{2,6}\s+/gm) || []).length
  assert.equal(headingCount(chinese), headingCount(english))
  assert.ok(headingCount(chinese) >= 10)
  for (const heading of [
    '组件边界与发布节奏',
    'Windows 桌面操作',
    '更新与修复',
    '便携数据',
    'DSH 终端与插件管理命令',
    '插件',
    'DSH-Recovery.exe',
    'Linux',
    'macOS',
    '离线部署',
  ]) assert.match(chinese, new RegExp('^#{2,3} ' + heading + '$', 'm'))
  for (const heading of [
    'Component boundaries and release cadence',
    'Windows desktop controls',
    'Updates and repair',
    'Portable data',
    'DSH Terminal and plugin management commands',
    'Plugins',
    'DSH-Recovery.exe',
    'Linux',
    'macOS',
    'Offline deployment',
  ]) assert.match(english, new RegExp('^#{2,3} ' + heading + '$', 'm'))
})
