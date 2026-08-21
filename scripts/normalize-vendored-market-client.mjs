import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const clientPath = path.join(root, 'app', 'vendor', 'dsh-portable-plugin-market', 'client', 'client.js')
const expected = /^(window\.__ModuleLoader__\.load\(\{\s*id:\s*)"@wsl043\/dsh-portable-plugin-market"/
const legacy = /^(window\.__ModuleLoader__\.load\(\{\s*id:\s*)"dshmarket"/
const source = await readFile(clientPath, 'utf8')
let normalized = source

if (legacy.test(normalized)) {
  normalized = normalized.replace(legacy, '$1"@wsl043/dsh-portable-plugin-market"')
} else if (!expected.test(normalized)) {
  throw new Error('refusing to rewrite an unrecognized plugin-market client bundle')
}

if (normalized === source) {
  process.stdout.write('Portable market client is already normalized.\n')
} else {
  await writeFile(clientPath, normalized, 'utf8')
  process.stdout.write('Normalized the Portable market client identity.\n')
}
