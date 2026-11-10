import assert from 'node:assert/strict'
import test from 'node:test'
import {
  verifyWindowsAclHide,
  verifyWindowsSubprocessHide,
  verifyWindowsWin32ProcessHide,
} from '../scripts/patch-windows-subprocess-hide.mjs'

const subprocess = [
  '\t\t...force ? ["/F"] : []\n\t], {\n\t\tstdio: "ignore",\n\t\twindowsHide: true\n\t});',
  '\t\t"/F"\n\t], {\n\t\tstdio: "ignore",\n\t\twindowsHide: true\n\t});',
  '\t\tdetached: platform !== "win32",\n\t\twindowsHide: platform === "win32"\n\t});',
].join('\n')

const acl = [
  'from "@deepseek-ai/dsh-win32-process";',
  'function spawnSandboxed(api, token, options) {\n\treturn spawnPipedProcess(api, {\n\t\t...options,\n\t\ttoken\n\t});\n}',
  'function spawnSandboxedInherited(api, token, options) {\n\treturn spawnInheritedJobProcess(api, {\n\t\t...options,\n\t\ttoken\n\t});\n}',
].join('\n')

const startup = '\t\t\tcb: 104,\n\t\t\tdwFlags: 257,\n\t\t\twShowWindow: 0,\n\t\t\thStdInput:'
const sharedOwner = [startup, startup].join('\n')

test('official subprocess and both taskkill paths must hide their Windows children', () => {
  verifyWindowsSubprocessHide(subprocess)
  assert.throws(() => verifyWindowsSubprocessHide(subprocess.replace('windowsHide: true', 'windowsHide: false')), /must hide/)
})

test('official ACL must delegate both launch paths to the shared hidden process owner', () => {
  verifyWindowsAclHide(acl)
  verifyWindowsWin32ProcessHide(sharedOwner)
  assert.throws(() => verifyWindowsAclHide(acl.replace('spawnPipedProcess(api', 'differentProcess(api')), /shared process owner/)
  assert.throws(() => verifyWindowsWin32ProcessHide(sharedOwner.replace('wShowWindow: 0', 'wShowWindow: 1')), /request SW_HIDE/)
  assert.throws(() => verifyWindowsWin32ProcessHide(sharedOwner + '\n' + startup.replace('dwFlags: 257', 'dwFlags: 256')), /request SW_HIDE/)
})
