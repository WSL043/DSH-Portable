import fs from 'node:fs'
import { createHash } from 'node:crypto'

const inputs = ['tsdown.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'scripts/normalize-client-banner.mjs']
function addSources(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = directory + '/' + entry.name
    if (entry.isSymbolicLink()) throw new Error('linked client source is not reproducible: ' + filename)
    if (entry.isDirectory()) addSources(filename)
    else if (entry.isFile()) inputs.push(filename)
    else throw new Error('unsupported client source: ' + filename)
  }
}
addSources('src')
const normalizeLines = text => text.replace(/\r\n?/g, '\n')
const digest = createHash('sha256')
for (const filename of inputs.sort()) {
  digest.update(filename + '\0').update(normalizeLines(fs.readFileSync(filename, 'utf8'))).update('\0')
}
const stamp = '// dsh-portable-client-source-sha256: ' + digest.digest('hex')

const file = 'client/client.js'
const name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name
const original = normalizeLines(fs.readFileSync(file, 'utf8'))
const quotedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const identifier = '[$_\\p{ID_Start}][$_\\u200c\\u200d\\p{ID_Continue}]*'
const header = new RegExp("^window\\.__ModuleLoader__\\.load\\(\\{\\s*id:\\s*([\"'`])" + quotedName
  + "\\1\\s*,\\s*factory:\\s*(?:\\((" + identifier + ")\\)|(" + identifier + "))\\s*=>\\s*\\{", 'u')
const match = original.match(header)
if (!match) throw new Error('unexpected client bundle banner')
let code = original.replace(header, () => `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (${match[2] ?? match[3]}) => {`)
const root = process.cwd().replaceAll('\\', '/')
code = code.replace(/(dsh-css:)([^\n"]*?)(src[/\\][^\n"]*?\.css\.mjs)/g, (_all, mark, _dir, relative) => mark + relative.replaceAll('\\', '/'))
if (code.includes(root) || /dsh-css:(?:\/|[A-Za-z]:[/\\])[^\n"]*/.test(code)) throw new Error('absolute build path leaked into client bundle')
code = code.replace(/\n\/\/ dsh-portable-client-source-sha256: [^\n]*\n?$/, '').trimEnd() + '\n' + stamp + '\n'
if (process.argv.includes('--check')) {
  if (code !== original) throw new Error('stale client bundle: run build:client before committing source changes')
} else fs.writeFileSync(file, code)
