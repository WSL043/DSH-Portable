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
  'DSH-Portable-macos-arm64.zip',
  'DSH-Portable-macos-x64.zip',
  'DSH-Portable-linux-x64.tar.gz',
  'DSH-Portable-linux-arm64.tar.gz',
  'DeepSeek-Herness-linux-x64.AppImage',
  'DeepSeek-Herness-linux-arm64.AppImage',
  'portable-manifest.json',
  'DSH-Portable-update-windows-x64.zip',
  'portable-update-windows-x64.json',
  'DSH-Portable-update-macos-arm64.zip',
  'portable-update-macos-arm64.json',
  'DSH-Portable-update-macos-x64.zip',
  'portable-update-macos-x64.json',
  'DSH-Portable-update-linux-x64.zip',
  'portable-update-linux-x64.json',
  'DSH-Portable-update-linux-arm64.zip',
  'portable-update-linux-arm64.json',
]

async function stageRelease(channel) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-release-staging-'))
  const artifacts = path.join(root, 'artifacts')
  const output = path.join(root, 'output')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(artifacts, { recursive: true }))
  for (const name of required) await writeFile(path.join(artifacts, name), `fixture:${name}`)
  await writeFile(path.join(artifacts, 'DSH-Portable-windows-x64-offline.exe'), 'redundant self-extractor')
  await writeFile(path.join(artifacts, 'DSH-Portable-windows-x64.exe.sha256'), 'old sidecar')
  await execFileAsync(process.execPath, [script, artifacts, output, channel])
  return { root, output }
}

test('stable release staging exposes obvious packages for every platform and keeps updater payloads in their own channel', async () => {
  const { root, output } = await stageRelease('stable')
  try {
    const user = (await readdir(path.join(output, 'user-assets'))).sort()
    const update = (await readdir(path.join(output, 'update-assets'))).sort()
    assert.equal(user.length, 10)
    assert.ok(user.includes('portable-manifest.json'), 'the immutable version release must publish the exact full-package manifest used by desktop updates')
    assert.ok(user.includes('checksums.txt'))
    assert.ok(!user.some((name) => name.endsWith('.sha256')))
    assert.ok(!user.includes('DSH-Portable-windows-x64-offline.exe'))
    assert.equal(update.length, 12)
    await assert.rejects(readdir(path.join(output, 'compat-assets')), { code: 'ENOENT' })
    const checksums = await readFile(path.join(output, 'user-assets', 'checksums.txt'), 'ascii')
    assert.equal(checksums.trim().split(/\r?\n/).length, 9)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('candidate releases never offer a stable-channel bootstrap as a candidate download', async () => {
  const { root, output } = await stageRelease('candidate')
  try {
    const user = (await readdir(path.join(output, 'user-assets'))).sort()
    assert.ok(!user.includes('DSH-Portable-windows-x64.exe'))
    assert.ok(user.includes('DSH-Portable-windows-x64-offline.zip'))
    assert.ok(user.includes('portable-manifest.json'))
    const checksums = await readFile(path.join(output, 'user-assets', 'checksums.txt'), 'ascii')
    assert.ok(!checksums.includes('DSH-Portable-windows-x64.exe'))
    assert.equal(checksums.trim().split(/\r?\n/).length, 8)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
