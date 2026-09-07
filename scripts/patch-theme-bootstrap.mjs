import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const marker = 'dsh-portable-theme-bootstrap-v1'

export function patchThemeBootstrap(source, kind) {
  if (source.includes(marker)) return source
  const needle = kind === 'host'
    ? "  const systemDark = preference === 'system'"
    : 'this.preference = DEFAULT_PREFERENCE;'
  if (source.split(needle).length !== 2) throw new Error(`theme ${kind} bootstrap seam changed upstream`)
  const replacement = kind === 'host'
    ? `  /* ${marker} */\n  document.body.setAttribute('data-dsh-theme-preference', preference)\n${needle}`
    : `/* ${marker} */\n\t\t\t\tconst bootPreference = typeof document === "undefined" ? null : document.body?.getAttribute("data-dsh-theme-preference");\n\t\t\t\tthis.preference = ["light", "dark", "system"].includes(bootPreference) ? bootPreference : DEFAULT_PREFERENCE;`
  return source.replace(needle, replacement)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: patch-theme-bootstrap.mjs <app-root>')
  const lib = path.join(path.resolve(process.argv[2]), 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib')
  for (const [file, kind] of [['index.js', 'host'], ['client.js', 'client']]) {
    const filename = path.join(lib, file)
    await writeFile(filename, patchThemeBootstrap(await readFile(filename, 'utf8'), kind), 'utf8')
  }
}
