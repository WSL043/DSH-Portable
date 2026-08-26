import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const sources = [
  path.join(projectRoot, 'launcher', 'windows', 'DSH-Portable.cs'),
  path.join(projectRoot, 'launcher', 'windows', 'PortableProcessJob.cs'),
]
const utf8FailureFixture = path.join(projectRoot, 'tests', 'fixtures', 'launcher-error-utf8.mjs')

function cscPath() {
  const windows = process.env.WINDIR || 'C:\\Windows'
  return path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
}

async function prepareWebView2(root) {
  const lock = JSON.parse(await readFile(path.join(projectRoot, 'upstream.lock.json'), 'utf8'))
  const archive = path.join(root, `Microsoft.Web.WebView2.${lock.webview2.version}.nupkg`)
  const sdk = path.join(root, 'webview2-sdk')
  const response = await fetch(lock.webview2.url)
  assert.equal(response.ok, true, `WebView2 SDK download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'), lock.webview2.sha256)
  await writeFile(archive, bytes)
  await mkdir(sdk)
  await execFileAsync('tar.exe', ['-x', '-f', archive, '-C', sdk])
  const core = path.join(sdk, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll')
  const winforms = path.join(sdk, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll')
  const loader = path.join(sdk, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll')
  await copyFile(core, path.join(root, path.basename(core)))
  await copyFile(winforms, path.join(root, path.basename(winforms)))
  await copyFile(loader, path.join(root, path.basename(loader)))
  return { core, winforms }
}

async function compileLauncher(output, webview2) {
  await execFileAsync(cscPath(), [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    `/reference:${webview2.core}`, `/reference:${webview2.winforms}`,
    `/out:${output}`,
    ...sources,
  ])
}

test('Windows launcher preserves UTF-8 diagnostics from the DSH subprocess', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-launcher-utf8-'))
  try {
    const executable = path.join(root, 'DeepSeek-Herness.exe')
    const diagnostic = path.join(root, 'launcher-diagnostic.txt')
    await mkdir(path.join(root, 'runtime', 'node'), { recursive: true })
    await mkdir(path.join(root, 'launcher'), { recursive: true })
    await copyFile(process.execPath, path.join(root, 'runtime', 'node', 'node.exe'))
    await copyFile(utf8FailureFixture, path.join(root, 'launcher', 'portable-cli.mjs'))
    await copyFile(new URL('../launcher/runtime-entry.mjs', import.meta.url), path.join(root, 'launcher', 'runtime-entry.mjs'))
    await copyFile(new URL('../launcher/runtime-capsule.mjs', import.meta.url), path.join(root, 'launcher', 'runtime-capsule.mjs'))
    const webview2 = await prepareWebView2(root)
    await compileLauncher(executable, webview2)

    await assert.rejects(execFileAsync(executable, ['--json'], {
      env: { ...process.env, DSH_PORTABLE_LAUNCHER_DIAGNOSTIC: diagnostic },
    }), (error) => error.code === 17)

    const text = (await readFile(diagnostic, 'utf8')).replace(/^\uFEFF/, '')
    assert.equal(text, '启动失败：找不到运行模块 “测试”')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
