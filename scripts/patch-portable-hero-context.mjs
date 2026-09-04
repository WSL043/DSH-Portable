import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'dsh-portable-hero-context-v1'

function replaceRequired(source, needle, replacement, label) {
  const matches = source.split(needle).length - 1
  if (matches !== 1) throw new Error(`${label}: expected 1 match, found ${matches}`)
  return source.replace(needle, replacement)
}

export function patchPortableHeroContext(source) {
  if (source.includes(MARKER)) return source

  const renderNeedle = `\t\t\t\t\trenderSlot("conversation.hero.agentPreset", {})`
  const renderReplacement = `${renderNeedle},\n\t\t\t\t\t/* ${MARKER} */\n\t\t\t\t\trenderSlot("conversation.hero.portableContext", {})`
  let output = replaceRequired(source, renderNeedle, renderReplacement, 'Hero context render seam changed upstream')

  const contractNeedle = `\t\t\t\t\t"conversation.hero.agentPreset": {\n\t\t\t\t\t\tkind: "single",\n\t\t\t\t\t\tscope: "root"\n\t\t\t\t\t}`
  const contractReplacement = `${contractNeedle},\n\t\t\t\t\t"conversation.hero.portableContext": {\n\t\t\t\t\t\tkind: "list",\n\t\t\t\t\t\tscope: "root"\n\t\t\t\t\t}`
  output = replaceRequired(output, contractNeedle, contractReplacement, 'Hero context contract seam changed upstream')
  return output
}

async function main() {
  const appRoot = path.resolve(process.argv[2] || '')
  if (!appRoot) throw new Error('usage: node patch-portable-hero-context.mjs <app-root>')
  const filename = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
  const source = await readFile(filename, 'utf8')
  await writeFile(filename, patchPortableHeroContext(source), 'utf8')
  console.log(filename)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
