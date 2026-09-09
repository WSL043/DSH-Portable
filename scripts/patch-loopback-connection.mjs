import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'dsh-portable-loopback-connection-v1'
const ORIGINAL = 'stopNetworkWatch: watchBrowserNetwork(controller)'
const REPLACEMENT = `stopNetworkWatch: handle.isLoopback ? () => {} : watchBrowserNetwork(controller) /* ${MARKER} */`

export function patchLoopbackConnection(source) {
  if (source.includes(MARKER)) return source
  const matches = source.split(ORIGINAL).length - 1
  if (matches !== 1) throw new Error(`Loopback connection seam changed: expected 1 match, found ${matches}`)
  return source.replace(ORIGINAL, REPLACEMENT)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node patch-loopback-connection.mjs <app root>')
  const appRoot = path.resolve(process.argv[2])
  const filename = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-connection', 'lib', 'client.js')
  const source = await readFile(filename, 'utf8')
  const patched = patchLoopbackConnection(source)
  if (patched !== source) await writeFile(filename, patched, 'utf8')
  console.log(filename)
}
