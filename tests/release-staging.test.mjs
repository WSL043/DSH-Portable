import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/stage-release-assets.mjs', import.meta.url))
const required = [
  'DSH-Portable-windows-x64.exe',
  'DSH-Portable-windows-x64-offline.zip',
  'DeepSeek-Herness-Setup.exe',
  'DSH-Portable-macos-arm64.zip',
  'DSH-Portable-macos-x64.zip',
  'DeepSeek-Herness-macos-arm64.dmg',
  'DeepSeek-Herness-macos-x64.dmg',
  'portable-manifest.json',
  'DSH-Portable-update-windows-x64.zip',
  'portable-update-windows-x64.json',
  'DSH-Portable-update-macos-arm64.zip',
  'portable-update-macos-arm64.json',
  'DSH-Portable-update-macos-x64.zip',
  'portable-update-macos-x64.json',
]

test('release staging exposes seven obvious packages and keeps updater payloads in their own channel', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-release-staging-'))
  const artifacts = path.join(root, 'artifacts')
  const output = path.join(root, 'output')
  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(artifacts, { recursive: true }))
    for (const name of required) await writeFile(path.join(artifacts, name), `fixture:${name}`)
    await writeFile(path.join(artifacts, 'DSH-Portable-windows-x64-offline.exe'), 'redundant self-extractor')
    await writeFile(path.join(artifacts, 'DSH-Portable-windows-x64.exe.sha256'), 'old sidecar')

    await execFileAsync(process.execPath, [script, artifacts, output])
    const user = (await readdir(path.join(output, 'user-assets'))).sort()
    const update = (await readdir(path.join(output, 'update-assets'))).sort()
    const compat = (await readdir(path.join(output, 'compat-assets'))).sort()
    assert.equal(user.length, 8)
    assert.ok(user.includes('checksums.txt'))
    assert.ok(!user.some((name) => name.endsWith('.sha256')))
    assert.ok(!user.includes('DSH-Portable-windows-x64-offline.exe'))
    assert.equal(update.length, 8)
    assert.deepEqual(compat, [
      'portable-manifest.json',
      'portable-update-macos-arm64.json',
      'portable-update-macos-x64.json',
      'portable-update-windows-x64.json',
    ])
    const checksums = await readFile(path.join(output, 'user-assets', 'checksums.txt'), 'ascii')
    assert.equal(checksums.trim().split(/\r?\n/).length, 7)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
