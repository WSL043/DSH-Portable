import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifiedPackageFile } from './verified-package-file.mjs'

export function verifyWindowsSubprocessHide(source) {
  const hidden = [
    '\t\t...force ? ["/F"] : []\n\t], {\n\t\tstdio: "ignore",\n\t\twindowsHide: true\n\t});',
    '\t\t"/F"\n\t], {\n\t\tstdio: "ignore",\n\t\twindowsHide: true\n\t});',
    '\t\tdetached: platform !== "win32",\n\t\twindowsHide: platform === "win32"\n\t});',
  ]
  assert.ok(hidden.every(needle => source.split(needle).length === 2), 'Official subprocess helpers must hide their Windows child processes')
}

function subprocessHideModule(indexSource) {
  const chunks = [...indexSource.matchAll(/from "\.\/(runner-launch-[A-Za-z0-9_-]+\.js)";/g)]
  assert.ok(chunks.length <= 1, 'Ambiguous Windows subprocess runner module')
  return chunks[0]?.[1] || 'index.js'
}

export function verifyWindowsAclHide(source) {
  const adapters = [
    'from "@deepseek-ai/dsh-win32-process";',
    'function spawnSandboxed(api, token, options) {\n\treturn spawnPipedProcess(api, {\n\t\t...options,\n\t\ttoken\n\t});\n}',
    'function spawnSandboxedInherited(api, token, options) {\n\treturn spawnInheritedJobProcess(api, {\n\t\t...options,\n\t\ttoken\n\t});\n}',
  ]
  assert.ok(adapters.every(needle => source.split(needle).length === 2), 'Official Windows ACL must use the shared process owner')
}

export function verifyWindowsWin32ProcessHide(source) {
  const startup = '\t\t\tcb: 104,\n\t\t\tdwFlags: 257,\n\t\t\twShowWindow: 0,\n\t\t\thStdInput:'
  const legacy = startup.replace('dwFlags: 257,\n\t\t\twShowWindow: 0,', 'dwFlags: 256,')
  const hidden = source.split(startup).length === 3 && !source.includes(legacy)
    && source.match(/dwFlags: 257/g)?.length === 2 && source.match(/wShowWindow: 0/g)?.length === 2
  assert.ok(hidden, 'Both official restricted Windows process paths must request SW_HIDE')
}

export async function verifyInstalledWindowsSubprocesses(root) {
  const readLib = async (pkg, name) => readFile(await verifiedPackageFile(root, 'node_modules', '@deepseek-ai', pkg, 'lib', name), 'utf8')
  const runner = 'dsh-subprocess-local'
  verifyWindowsSubprocessHide(await readLib(runner, subprocessHideModule(await readLib(runner, 'index.js'))))

  const acl = 'dsh-sandbox-windows-acl'
  const aclLib = await verifiedPackageFile(root, 'node_modules', '@deepseek-ai', acl, 'lib')
  const types = (await readdir(aclLib))
    .filter(name => /^types-[A-Za-z0-9_-]+\.js$/.test(name))
  assert.equal(types.length, 1, 'Expected one official Windows ACL types module')
  verifyWindowsAclHide(await readLib(acl, types[0]))
  verifyWindowsWin32ProcessHide(await readLib('dsh-win32-process', 'index.js'))
}

// This historical adapter path is also used by the core qualification workflow.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node patch-windows-subprocess-hide.mjs <app-root>')
  await verifyInstalledWindowsSubprocesses(path.resolve(process.argv[2]))
}
