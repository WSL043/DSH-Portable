import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUBPROCESS_MARKER = 'dsh-portable-windows-subprocess-hide-v1'
const ACL_MARKER = 'dsh-portable-windows-acl-hide-v1'

function replaceRequired(source, needle, replacement, label) {
  const matches = source.split(needle).length - 1
  if (matches !== 1) throw new Error(`${label}: expected 1 match, found ${matches}`)
  return source.replace(needle, replacement)
}

export function patchWindowsSubprocessHide(source) {
  if (source.includes(SUBPROCESS_MARKER)) return source
  let output = replaceRequired(
    source,
    `\t\t...force ? ["/F"] : []\n\t], { stdio: "ignore" });`,
    `\t\t...force ? ["/F"] : []\n\t], { stdio: "ignore", windowsHide: true });`,
    'Windows process inspector taskkill seam changed upstream',
  )
  output = replaceRequired(
    output,
    `\t\t"/F"\n\t], { stdio: "ignore" });`,
    `\t\t"/F"\n\t], { stdio: "ignore", windowsHide: true });`,
    'subprocess taskkill seam changed upstream',
  )
  output = replaceRequired(
    output,
    `\t\tdetached: platform !== "win32"\n\t});`,
    `\t\tdetached: platform !== "win32",\n\t\twindowsHide: true\n\t});`,
    'subprocess spawn seam changed upstream',
  )
  return `/* ${SUBPROCESS_MARKER} */\n${output}`
}

export function patchWindowsAclHide(source) {
  if (source.includes(ACL_MARKER)) return source
  const needle = `\t\tcb: 104,\n\t\tdwFlags: 256,\n\t\thStdInput:`
  const replacement = `\t\tcb: 104,\n\t\tdwFlags: 257,\n\t\twShowWindow: 0,\n\t\thStdInput:`
  const matches = source.split(needle).length - 1
  if (matches !== 2) {
    throw new Error(`Windows ACL CreateProcessAsUserW seams changed upstream: expected 2 matches, found ${matches}`)
  }
  return `/* ${ACL_MARKER} */\n${source.split(needle).join(replacement)}`
}

async function main() {
  if (!process.argv[2]) throw new Error('usage: node patch-windows-subprocess-hide.mjs <app-root>')
  const appRoot = path.resolve(process.argv[2])
  const subprocessFilename = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js')
  const aclLib = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib')
  const aclCandidates = (await readdir(aclLib)).filter(name => /^types-[A-Za-z0-9_-]+\.js$/.test(name))
  if (aclCandidates.length !== 1) {
    throw new Error(`Windows ACL runtime seam changed upstream: expected 1 compiled types module, found ${aclCandidates.length}`)
  }
  const aclFilename = path.join(aclLib, aclCandidates[0])
  const [subprocessSource, aclSource] = await Promise.all([
    readFile(subprocessFilename, 'utf8'),
    readFile(aclFilename, 'utf8'),
  ])
  await Promise.all([
    writeFile(subprocessFilename, patchWindowsSubprocessHide(subprocessSource), 'utf8'),
    writeFile(aclFilename, patchWindowsAclHide(aclSource), 'utf8'),
  ])
  console.log(subprocessFilename)
  console.log(aclFilename)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
