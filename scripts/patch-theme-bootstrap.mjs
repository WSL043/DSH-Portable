import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeDataTarget } from '../launcher/data-paths.mjs'

const marker = 'dsh-portable-theme-bootstrap-v1'

export function patchThemeBootstrap(source) {
  if (source.includes(marker)) return source
  const needle = "this.host = host;\n\t\t\t\tthis.preference = DEFAULT_PREFERENCE;"
  if (source.split(needle).length !== 2) throw new Error('theme client bootstrap seam changed upstream')
  return source.replace(needle, `this.host = host;\n\t\t\t\t/* ${marker} */\n\t\t\t\tconst bootPreference = typeof document === "undefined" ? null : document.documentElement?.dataset.dsThemeSource;\n\t\t\t\tthis.preference = ["light", "dark", "system"].includes(bootPreference) ? bootPreference : DEFAULT_PREFERENCE;`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('usage: patch-theme-bootstrap.mjs <staged-app-directory>')
  process.chdir(process.argv[2])
  const lib = 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib'
  const hostFile = await safeDataTarget(process.cwd(), lib + '/index.js', { createParents: false })
  const filename = await safeDataTarget(process.cwd(), lib + '/client.js', { createParents: false })
  if (!hostFile || !filename) throw new Error('Staged official theme package is missing')
  const host = await readFile(hostFile, 'utf8')
  if (!host.includes('document.documentElement.dataset.dsThemeSource = preference')) {
    throw new Error('Official theme boot preference seam changed upstream')
  }
  const source = await readFile(filename, 'utf8')
  const patched = patchThemeBootstrap(source)
  if (patched !== source) await writeFile(filename, patched, 'utf8')
}
