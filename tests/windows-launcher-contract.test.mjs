import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const source = path.join(projectRoot, 'launcher', 'windows', 'DSH-Portable.cs')
const utf8FailureFixture = path.join(projectRoot, 'tests', 'fixtures', 'launcher-error-utf8.mjs')

function cscPath() {
  const windows = process.env.WINDIR || 'C:\\Windows'
  return path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
}

async function compileLauncher(output) {
  await execFileAsync(cscPath(), [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    `/out:${output}`,
    source,
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
    await compileLauncher(executable)

    await assert.rejects(execFileAsync(executable, ['--json'], {
      env: { ...process.env, DSH_PORTABLE_LAUNCHER_DIAGNOSTIC: diagnostic },
    }), (error) => error.code === 17)

    const text = (await readFile(diagnostic, 'utf8')).replace(/^\uFEFF/, '')
    assert.equal(text, '启动失败：找不到运行模块 “测试”')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
