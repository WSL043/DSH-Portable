import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensureRuntimeCapsule } from '../launcher/runtime-capsule.mjs'
import { isOwnedDshProcess, layoutForRoot, queryProcess } from '../launcher/portable-core.mjs'

const execute = promisify(execFile)
if (process.platform !== 'win32' || !process.argv[2]) throw new Error('usage: node smoke-windows-path-alias.mjs <isolated Windows product>')
const root = await realpath(path.resolve(process.argv[2]))
const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class AliasPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetShortPathName(string path, StringBuilder result, uint size); }'
$result = New-Object System.Text.StringBuilder 32768
if ([AliasPath]::GetShortPathName($env:DSH_ALIAS_TEST_ROOT, $result, 32768) -eq 0) { throw 'GetShortPathName failed' }
$result.ToString()
`
const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  env: { ...process.env, DSH_ALIAS_TEST_ROOT: root }, encoding: 'utf8', windowsHide: true, timeout: 10000,
})
const shortRoot = stdout.trim()
assert.notEqual(shortRoot.toLowerCase(), root.toLowerCase(), 'the test needs an actual short-path alias')
async function cli(base, ...args) {
  const { stdout } = await execute(path.join(base, 'runtime', 'node', 'node.exe'), [
    path.join(base, 'launcher', 'runtime-entry.mjs'), 'portable-cli.mjs', ...args, '--json',
  ], { windowsHide: true, timeout: 120000 })
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1))
}
let first
try {
  assert.equal((await cli(root, 'status')).status, 'stopped')
  first = await cli(shortRoot, 'start', '--no-browser')
  assert.equal(first.status, 'started')
  const second = await cli(root, 'start', '--no-browser')
  assert.equal(second.status, 'already-running')
  assert.equal(second.pid, first.pid, 'changing path spelling must not create another backend')
  assert.equal(second.port, first.port)
  assert.equal(second.migration.moved, false, 'an alias is not a directory relocation')
  await cli(root, 'stop', '--no-browser')
  assert.throws(() => process.kill(first.pid, 0), { code: 'ESRCH' }, 'the original short-path backend must exit')
  console.log(JSON.stringify({ status: 'passed', reusedBackend: true, stoppedOriginalBackend: true }))
} finally {
  await cli(root, 'stop', '--no-browser').catch(() => {})
  await cli(shortRoot, 'stop', '--no-browser').catch(() => {})
  if (first?.pid) {
    const runtime = await ensureRuntimeCapsule(root)
    const layout = layoutForRoot(root, 'win32', root, runtime.runtimeRoot)
    if (isOwnedDshProcess(queryProcess(first.pid), layout, first.port)) {
      await execute('taskkill.exe', ['/PID', String(first.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
    }
  }
}
