import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

test('native tray onboarding persists across processes and directory moves', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'portable-tray-notice-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  const start = source.indexOf('        internal static bool TryClaimTrayNotice(')
  const end = source.indexOf('        private void RestoreFromTray()', start)
  assert.ok(start > 0 && end > start)
  const cs = join(root, 'Probe.cs'), exe = join(root, 'Probe.exe')
  await writeFile(cs, 'using System; using System.IO; class Probe {\n' + source.slice(start, end) +
    'static void Main(string[] args) { Console.WriteLine(TryClaimTrayNotice(args[0])); } }')
  const compile = spawnSync(join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    ['/nologo', '/target:exe', '/out:' + exe, cs], { encoding: 'utf8', windowsHide: true })
  assert.equal(compile.status, 0, compile.stdout + compile.stderr)
  const claim = directory => {
    const result = spawnSync(exe, [directory], { encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const data = join(root, 'data'), moved = join(root, 'moved')
  assert.equal(claim(data), 'True')
  assert.equal(claim(data), 'False')
  await rename(data, moved)
  assert.equal(claim(moved), 'False')
  assert.equal(claim(join(root, 'new-user')), 'True')
  const unavailable = join(root, 'not-a-directory')
  await writeFile(unavailable, 'fixture')
  assert.equal(claim(unavailable), 'False')
})
