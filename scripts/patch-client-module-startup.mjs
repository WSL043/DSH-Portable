import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const marker = 'dsh-portable-client-newline-scan-v1'
const original = `function newlineCount(value) {
\tlet count = 0;
\tfor (const char of value) if (char === "\\n") count += 1;
\treturn count;
}`
const replacement = `function newlineCount(value) {
\t// ${marker}: skip non-newline spans without allocating character iterators.
\tlet count = 0;
\tlet index = -1;
\twhile ((index = value.indexOf("\\n", index + 1)) !== -1) count += 1;
\treturn count;
}`

export function patchClientModuleStartup(source) {
  if (source.includes(marker)) return source
  const matches = source.split(original).length - 1
  if (matches !== 1) throw new Error(`Client module newline-count seam changed: expected 1 match, found ${matches}`)
  return source.replace(original, replacement)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node patch-client-module-startup.mjs <app root>')
  const filename = path.join(path.resolve(process.argv[2]), 'node_modules/@deepseek-ai/dsh-client-modules/lib/index.js')
  const source = await readFile(filename, 'utf8')
  const patched = patchClientModuleStartup(source)
  if (patched !== source) await writeFile(filename, patched)
  console.log(filename)
}
