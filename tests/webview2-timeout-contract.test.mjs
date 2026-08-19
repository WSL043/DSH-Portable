import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '..')
const launcherSource = path.join(projectRoot, 'launcher', 'windows', 'DSH-Portable.cs')

test('Windows desktop host allows one minute for WebView2 workspace navigation', async () => {
  const source = await readFile(launcherSource, 'utf8')
  assert.match(source, /WorkspaceNavigationTimeoutMs\s*=\s*60000/)
  assert.equal((source.match(/Task\.Delay\(WorkspaceNavigationTimeoutMs\)/g) ?? []).length, 2)
  assert.doesNotMatch(source, /Task\.Delay\(30000\)/)
  assert.doesNotMatch(source, /工作台未能在 30 秒内打开|workspace did not open within 30 seconds/)
  assert.equal((source.match(/60 秒内打开/g) ?? []).length, 2)
  assert.equal((source.match(/within 60 seconds/g) ?? []).length, 2)
})
