import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifiedPackageFile } from './verified-package-file.mjs'

const SUBPROCESS_MARKER = 'dsh-portable-windows-subprocess-hide-v1'
const ACL_MARKER = 'dsh-portable-windows-acl-hide-v1'
const ACL_ADAPTER_MARKER = 'dsh-portable-windows-acl-shared-process-v1'
const WIN32_PROCESS_MARKER = 'dsh-portable-windows-process-hide-v1'

function replaceRequired(source, needle, replacement, label) {
  const matches = source.split(needle).length - 1
  if (matches !== 1) throw new Error(`${label}: expected 1 match, found ${matches}`)
  return source.replace(needle, replacement)
}

export function patchWindowsSubprocessHide(source) {
  if (source.includes(SUBPROCESS_MARKER)) return source
  const upstreamHidden = [
    `\t\t...force ? ["/F"] : []\n\t], {\n\t\tstdio: "ignore",\n\t\twindowsHide: true\n\t});`,
    `\t\t"/F"\n\t], {\n\t\tstdio: "ignore",\n\t\twindowsHide: true\n\t});`,
    `\t\tdetached: platform !== "win32",\n\t\twindowsHide: platform === "win32"\n\t});`,
  ]
  // The official runner already hides these helpers. Verify all three seams
  // without changing its code; an unknown shape still fails below.
  if (upstreamHidden.every(needle => source.split(needle).length === 2)) {
    return source
  }
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

export function subprocessHideModule(indexSource) {
  const chunks = [...indexSource.matchAll(/from "\.\/(runner-launch-[A-Za-z0-9_-]+\.js)";/g)]
  if (chunks.length > 1) throw new Error('Ambiguous Windows subprocess runner module')
  return chunks[0]?.[1] || 'index.js'
}

export function patchWindowsAclHide(source) {
  if (source.includes(ACL_MARKER) || source.includes(ACL_ADAPTER_MARKER)) return source
  const needle = `\t\tcb: 104,\n\t\tdwFlags: 256,\n\t\thStdInput:`
  const replacement = `\t\tcb: 104,\n\t\tdwFlags: 257,\n\t\twShowWindow: 0,\n\t\thStdInput:`
  const matches = source.split(needle).length - 1
  if (matches === 2) {
    return `/* ${ACL_MARKER} */\n${source.split(needle).join(replacement)}`
  }
  if (matches !== 0) {
    throw new Error(`Windows ACL CreateProcessAsUserW seams changed upstream: expected 2 legacy matches or a recognized shared-process adapter, found ${matches}`)
  }

  const adapterSeams = [
    `from "@deepseek-ai/dsh-win32-process";`,
    `function spawnSandboxed(api, token, options) {\n\treturn spawnPipedProcess(api, {\n\t\t...options,\n\t\ttoken\n\t});\n}`,
    `function spawnSandboxedInherited(api, token, options) {\n\treturn spawnInheritedJobProcess(api, {\n\t\t...options,\n\t\ttoken\n\t});\n}`,
  ]
  for (const seam of adapterSeams) {
    const seamMatches = source.split(seam).length - 1
    if (seamMatches !== 1) {
      throw new Error(`Windows ACL CreateProcessAsUserW seams changed upstream: unrecognized shared-process adapter (${seamMatches} matches)`)
    }
  }
  return source
}

export function patchWindowsWin32ProcessHide(source) {
  if (source.includes(WIN32_PROCESS_MARKER)) return source
  const legacyNeedle = `\t\t\tcb: 104,\n\t\t\tdwFlags: 256,\n\t\t\thStdInput:`
  const replacement = `\t\t\tcb: 104,\n\t\t\tdwFlags: 257,\n\t\t\twShowWindow: 0,\n\t\t\thStdInput:`
  const upstreamHiddenNeedle = `\t\t\tcb: 104,\n\t\t\tdwFlags: 257,\n\t\t\twShowWindow: 0,\n\t\t\thStdInput:`
  const legacyMatches = source.split(legacyNeedle).length - 1
  const upstreamHiddenMatches = source.split(upstreamHiddenNeedle).length - 1
  const hiddenFlags = source.match(/dwFlags: 257/g)?.length ?? 0
  const hiddenWindows = source.match(/wShowWindow: 0/g)?.length ?? 0
  if (legacyMatches === 0 && upstreamHiddenMatches === 2 && hiddenFlags === 2 && hiddenWindows === 2) {
    // The official shared owner already requests STARTF_USESHOWWINDOW/SW_HIDE.
    return source
  }
  if (legacyMatches !== 2 || upstreamHiddenMatches !== 0) {
    throw new Error(`Windows shared process CreateProcessAsUserW seams changed upstream: expected 2 legacy matches or 2 upstream hidden matches, found legacy ${legacyMatches}, upstream ${upstreamHiddenMatches}`)
  }
  return `/* ${WIN32_PROCESS_MARKER} */\n${source.split(legacyNeedle).join(replacement)}`
}

async function main() {
  if (!process.argv[2]) throw new Error('usage: node patch-windows-subprocess-hide.mjs <app-root>')
  const appRoot = path.resolve(process.argv[2])
  const subprocessIndex = await verifiedPackageFile(appRoot, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js')
  const subprocessFilename = await verifiedPackageFile(appRoot, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', subprocessHideModule(await readFile(subprocessIndex, 'utf8')))
  const aclLib = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib')
  const aclCandidates = (await readdir(aclLib)).filter(name => /^types-[A-Za-z0-9_-]+\.js$/.test(name))
  if (aclCandidates.length !== 1) {
    throw new Error(`Windows ACL runtime seam changed upstream: expected 1 compiled types module, found ${aclCandidates.length}`)
  }
  const aclFilename = await verifiedPackageFile(appRoot, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', aclCandidates[0])
  const [subprocessSource, aclSource] = await Promise.all([
    readFile(subprocessFilename, 'utf8'),
    readFile(aclFilename, 'utf8'),
  ])
  const patchedAcl = patchWindowsAclHide(aclSource)
  const patchedSubprocess = patchWindowsSubprocessHide(subprocessSource)
  const writes = []
  if (patchedSubprocess !== subprocessSource) writes.push(writeFile(subprocessFilename, patchedSubprocess, 'utf8'))
  if (patchedAcl !== aclSource) writes.push(writeFile(aclFilename, patchedAcl, 'utf8'))
  let win32ProcessFilename
  if (patchedAcl.includes(ACL_ADAPTER_MARKER) || patchedAcl.includes('from "@deepseek-ai/dsh-win32-process";')) {
    win32ProcessFilename = await verifiedPackageFile(appRoot, 'node_modules', '@deepseek-ai', 'dsh-win32-process', 'lib', 'index.js')
    const win32ProcessSource = await readFile(win32ProcessFilename, 'utf8')
    const patchedWin32Process = patchWindowsWin32ProcessHide(win32ProcessSource)
    if (patchedWin32Process !== win32ProcessSource) writes.push(writeFile(win32ProcessFilename, patchedWin32Process, 'utf8'))
  }
  await Promise.all(writes)
  console.log(subprocessFilename)
  console.log(aclFilename)
  if (win32ProcessFilename) console.log(win32ProcessFilename)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
