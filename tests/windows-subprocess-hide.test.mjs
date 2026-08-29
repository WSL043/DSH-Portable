import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  patchWindowsAclHide,
  patchWindowsSubprocessHide,
  patchWindowsWin32ProcessHide,
} from '../scripts/patch-windows-subprocess-hide.mjs'

const fixture = `function taskkillTree(pid, force) {
\tspawnSync("taskkill", [
\t\t"/PID",
\t\tString(pid),
\t\t"/T",
\t\t...force ? ["/F"] : []
\t], { stdio: "ignore" });
}
function taskkillProcessTree(pid) {
\tspawnSync("taskkill", [
\t\t"/PID",
\t\tString(pid),
\t\t"/T",
\t\t"/F"
\t], { stdio: "ignore" });
}
function spawnSubprocess(spec, platform) {
\tconst child = spawn(program, args, {
\t\tcwd: spec.cwd,
\t\tdetached: platform !== "win32"
\t});
}`

test('official DSH subprocess patch hides every Windows child and taskkill helper', () => {
  const output = patchWindowsSubprocessHide(fixture)
  assert.match(output, /dsh-portable-windows-subprocess-hide-v1/)
  assert.equal(output.match(/windowsHide: true/g)?.length, 3)
  assert.equal(patchWindowsSubprocessHide(output), output)
})

const aclFixture = `function spawnSandboxed() {
\tencodeStartupInfo(startupInfo, {
\t\tcb: 104,
\t\tdwFlags: 256,
\t\thStdInput: stdIn.read,
\t});
}
function spawnSandboxedInherited() {
\tencodeStartupInfo(startupInfo, {
\t\tcb: 104,
\t\tdwFlags: 256,
\t\thStdInput: stdIn,
\t});
}`

test('official DSH ACL patch requests SW_HIDE on both restricted process paths', () => {
  const output = patchWindowsAclHide(aclFixture)
  assert.match(output, /dsh-portable-windows-acl-hide-v1/)
  assert.equal(output.match(/dwFlags: 257/g)?.length, 2)
  assert.equal(output.match(/wShowWindow: 0/g)?.length, 2)
  assert.equal(patchWindowsAclHide(output), output)
})

const alphaAclFixture = `import { spawnInheritedJobProcess, spawnPipedProcess } from "@deepseek-ai/dsh-win32-process";
function spawnSandboxed(api, token, options) {
\treturn spawnPipedProcess(api, {
\t\t...options,
\t\ttoken
\t});
}
function spawnSandboxedInherited(api, token, options) {
\treturn spawnInheritedJobProcess(api, {
\t\t...options,
\t\ttoken
\t});
}`

const alphaWin32ProcessFixture = `function spawnPipedProcess() {
\t\tencodeStartupInfo(startupInfo, {
\t\t\tcb: 104,
\t\t\tdwFlags: 256,
\t\t\thStdInput: stdIn.read,
\t\t});
}
function spawnInheritedJobProcess() {
\t\tencodeStartupInfo(startupInfo, {
\t\t\tcb: 104,
\t\t\tdwFlags: 256,
\t\t\thStdInput: stdIn,
\t\t});
}`

test('official DSH Alpha shared process owner is recognized and requests SW_HIDE', () => {
  const adapter = patchWindowsAclHide(alphaAclFixture)
  assert.match(adapter, /dsh-portable-windows-acl-shared-process-v1/)
  assert.equal(patchWindowsAclHide(adapter), adapter)

  const output = patchWindowsWin32ProcessHide(alphaWin32ProcessFixture)
  assert.match(output, /dsh-portable-windows-process-hide-v1/)
  assert.equal(output.match(/dwFlags: 257/g)?.length, 2)
  assert.equal(output.match(/wShowWindow: 0/g)?.length, 2)
  assert.equal(patchWindowsWin32ProcessHide(output), output)
})

test('all finished-product builders apply the subprocess hiding patch', async () => {
  for (const filename of [
    'scripts/build-windows.ps1',
    'scripts/build-macos.sh',
    'scripts/build-linux.sh',
  ]) {
    const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8')
    assert.match(source, /patch-windows-subprocess-hide\.mjs/, filename)
  }
})

test('finished-product smoke resolves the extracted runtime capsule instead of assuming an expanded app', async () => {
  const source = await readFile(new URL('../scripts/smoke-windows-subprocess-hide.mjs', import.meta.url), 'utf8')
  assert.match(source, /ensureRuntimeCapsule\(root\)/)
  assert.match(source, /path\.join\(prepared\.runtimeRoot, 'app'\)/)
  assert.doesNotMatch(source, /const appRoot = path\.join\(root, 'app'\)/)
})

test('the patch fails closed when an official DSH subprocess seam changes', () => {
  assert.throws(
    () => patchWindowsSubprocessHide(fixture.replace('detached: platform !== "win32"', 'detached: false')),
    /subprocess spawn seam changed upstream/,
  )
  assert.throws(
    () => patchWindowsAclHide(aclFixture.replace('dwFlags: 256', 'dwFlags: 512')),
    /ACL CreateProcessAsUserW seams changed upstream/,
  )
  assert.throws(
    () => patchWindowsAclHide(alphaAclFixture.replace('spawnPipedProcess(api, {', 'spawnPipedProcessV2(api, {')),
    /unrecognized shared-process adapter/,
  )
  assert.throws(
    () => patchWindowsWin32ProcessHide(alphaWin32ProcessFixture.replace('dwFlags: 256', 'dwFlags: 512')),
    /shared process CreateProcessAsUserW seams changed upstream/,
  )
})
