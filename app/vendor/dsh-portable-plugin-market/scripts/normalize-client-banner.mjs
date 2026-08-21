import fs from 'node:fs'

const file = 'client/client.js'
const name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`
let code = fs.readFileSync(file, 'utf8')
if (!code.startsWith(required)) {
  const lines = code.split('\n')
  const expected = ['window.__ModuleLoader__.load({', `\tid: ${JSON.stringify(name)},`, '\tfactory: (require) => {']
  if (lines.slice(0, 3).join('\n') !== expected.join('\n')) throw new Error('unexpected client bundle banner')
  lines[0] = required
  lines[1] = ''
  lines[2] = ''
  code = lines.join('\n')
}
const root = process.cwd().replaceAll('\\', '/')
code = code.replace(/(dsh-css:)([^\n"]*?)(src[/\\][^\n"]*?\.css\.mjs)/g, (_all, mark, _dir, relative) => mark + relative.replaceAll('\\', '/'))
if (code.includes(root) || /dsh-css:(?:\/|[A-Za-z]:[/\\])[^\n"]*/.test(code)) throw new Error('absolute build path leaked into client bundle')
fs.writeFileSync(file, code)
