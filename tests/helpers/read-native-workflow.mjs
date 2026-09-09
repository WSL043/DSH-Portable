import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function readNativeWorkflow() {
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(workflow, /run: \|\s*\.\/scripts\/verify-windows-native-artifact\.ps1 -RunnerLabel/)
  const sequence = await readFile(new URL('../../scripts/verify-windows-native-artifact.ps1', import.meta.url), 'utf8')
  return `${workflow}\n${sequence}`
}
