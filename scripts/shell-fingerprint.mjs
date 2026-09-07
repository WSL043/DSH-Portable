import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const platformDirectories = {
  windows: 'launcher/windows',
  macos: 'launcher/macos',
  linux: 'launcher/linux',
}

async function filesBelow(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(root, relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

export async function computeShellFingerprint(root, platform) {
  if (!platformDirectories[platform]) throw new Error('Unsupported shell platform')
  const shared = (await readdir(path.join(root, 'launcher'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => `launcher/${entry.name}`)
  const files = [...shared, ...await filesBelow(root, platformDirectories[platform])].sort()
  const digest = createHash('sha256')
  for (const filename of files) {
    digest.update(filename)
    digest.update('\0')
    const bytes = await readFile(path.join(root, filename))
    // Git's Windows checkout conversion must not change source compatibility.
    // Other shell files already have explicit line endings in .gitattributes.
    digest.update(/\.(cs|manifest)$/.test(filename) ? bytes.toString('utf8').replaceAll('\r\n', '\n') : bytes)
    digest.update('\0')
  }
  return digest.digest('hex')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${await computeShellFingerprint(path.resolve(import.meta.dirname, '..'), process.argv[2])}\n`)
}
