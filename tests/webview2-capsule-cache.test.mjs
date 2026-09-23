import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/verify-webview2-capsule.ps1', import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

test('offline WebView2 capsule cache accepts only the pinned payload and runtime lock',
  { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-webview2-cache-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const payload = path.join(root, 'WebView2.dshpack')
    const lockFile = path.join(root, '..', `${path.basename(root)}.lock.json`)
    t.after(() => rm(lockFile, { force: true }))
    const bytes = Buffer.from('reviewed fixture capsule')
    const lock = { capsule: { sha256: sha256(bytes), bytes: bytes.length, rawBytes: 100, fileCount: 2 } }
    const manifest = {
      schemaVersion: 1, format: 'dshpack-zstd-v1', filename: 'WebView2.dshpack',
      platform: 'win32', arch: 'x64', ...lock.capsule,
      required: ['app/msedgewebview2.exe', 'app/msedge.dll'],
    }
    await writeFile(payload, bytes)
    await writeFile(lockFile, JSON.stringify(lock))
    await writeFile(path.join(root, 'portable-runtime.json'), await readFile(lockFile))
    await writeFile(path.join(root, 'runtime-capsule.json'), JSON.stringify(manifest))
    const verify = () => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      script, '-Root', root, '-LockFile', lockFile], { windowsHide: true })
    await assert.doesNotReject(verify())
    await writeFile(payload, Buffer.from('altered fixture capsule'))
    await assert.rejects(verify(), /capsule bytes do not match/i)
    await writeFile(payload, bytes)
    await writeFile(path.join(root, 'unexpected.txt'), 'extra')
    await assert.rejects(verify(), /unexpected files/i)
  })
