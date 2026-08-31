import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const platform = process.argv[2]
const platformDirectories = {
  windows: 'launcher/windows',
  macos: 'launcher/macos',
  linux: 'launcher/linux',
}
if (!platformDirectories[platform]) throw new Error('Usage: node scripts/shell-fingerprint.mjs <windows|macos|linux>')

async function filesBelow(relativeDirectory) {
  const directory = path.join(root, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

const shared = (await readdir(path.join(root, 'launcher'), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
  .map((entry) => `launcher/${entry.name}`)
const files = [...shared, ...await filesBelow(platformDirectories[platform])].sort()
const digest = createHash('sha256')
for (const filename of files) {
  digest.update(filename)
  digest.update('\0')
  digest.update(await readFile(path.join(root, filename)))
  digest.update('\0')
}
process.stdout.write(`${digest.digest('hex')}\n`)
