import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [artifactArg = 'artifacts', outputArg = 'release-staging', channel = 'stable'] = process.argv.slice(2)
if (!['stable', 'candidate'].includes(channel)) throw new Error(`unsupported release channel: ${channel}`)
const artifacts = path.resolve(artifactArg)
const output = path.resolve(outputArg)
const userDir = path.join(output, 'user-assets')
const updateDir = path.join(output, 'update-assets')

const userAssets = [
  ...(channel === 'candidate' ? [] : ['DSH-Portable-windows-x64.exe']),
  'portable-manifest.json',
  'DSH-Portable-windows-x64-offline.zip',
  'DSH-Portable-macos-arm64.zip',
  'DSH-Portable-macos-x64.zip',
  'DSH-Portable-linux-x64.tar.gz',
  'DSH-Portable-linux-arm64.tar.gz',
  'DeepSeek-Herness-linux-x64.AppImage',
  'DeepSeek-Herness-linux-arm64.AppImage',
]
const updateAssets = [
  'portable-manifest.json',
  'DSH-Portable-windows-x64-offline.zip',
  'DSH-Portable-update-windows-x64.zip',
  'portable-update-windows-x64.json',
  'DSH-Portable-update-macos-arm64.zip',
  'portable-update-macos-arm64.json',
  'DSH-Portable-update-macos-x64.zip',
  'portable-update-macos-x64.json',
  'DSH-Portable-update-linux-x64.zip',
  'portable-update-linux-x64.json',
  'DSH-Portable-update-linux-arm64.zip',
  'portable-update-linux-arm64.json',
]
async function requireFile(name) {
  const filename = path.join(artifacts, name)
  const info = await stat(filename).catch(() => null)
  if (!info?.isFile() || info.size === 0) throw new Error(`required release artifact is missing or empty: ${name}`)
  return filename
}

async function copySet(names, destination) {
  await mkdir(destination, { recursive: true })
  for (const name of names) await copyFile(await requireFile(name), path.join(destination, name))
}

await rm(output, { recursive: true, force: true })
await Promise.all([
  copySet(userAssets, userDir),
  copySet(updateAssets, updateDir),
])

const checksums = []
for (const name of userAssets) {
  const bytes = await readFile(path.join(userDir, name))
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
}
await writeFile(path.join(userDir, 'checksums.txt'), `${checksums.join('\n')}\n`, 'ascii')

console.log(JSON.stringify({ userAssets: userAssets.length + 1, updateAssets: updateAssets.length }))
