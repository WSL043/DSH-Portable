import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function renderReleaseNotes(source, tag) {
  if (!/^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(String(tag))) {
    throw new Error('A stable or release-candidate tag is required to render release notes.')
  }
  return String(source).replaceAll(
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
