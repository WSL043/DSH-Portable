import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { patchDescriptorV2ReadMigration } from './patch.mjs'

const [sourceApp, destination] = process.argv.slice(2)
if (!sourceApp || !destination) throw new Error('usage: probe.mjs <verified stable app> <new isolated directory>')
const root = path.resolve(destination)
await mkdir(root) // Refuse to reuse a previous experiment or a user installation.
await cp(path.resolve(sourceApp), path.join(root, 'app'), { recursive: true, dereference: true })
const modules = path.join(root, 'app/node_modules/@deepseek-ai')
const bundle = path.join(modules, 'dsh-session-format-v0-to-v1/lib/index.js')
await writeFile(bundle, patchDescriptorV2ReadMigration(await readFile(bundle, 'utf8')))
const { createSessionFormatCatalogWithChildren } = await import(pathToFileURL(path.join(modules, 'dsh-session-format-catalog/lib/index.js')))
const { foldSubagentDescriptor } = await import(pathToFileURL(path.join(modules, 'dsh-subagent/lib/index.js')))
const checks = []
for (const [name, data, accepted] of [
  ['one-shot-v2', { version: 2, mode: 'one-shot', provider: 'spawn' }, true],
  ['continuable-v2', { version: 2, mode: 'continuable', provider: 'spawn', label: 'child', agentProvider: 'test', agentModel: 'test', persona: 'fixture', toolFilter: { allow: ['read'] } }, true],
  ['v3-control', { version: 3, mode: 'continuable', provider: 'spawn', label: 'child', agentReasoningEffort: 'high' }, true],
  ['unknown-version', { version: 9, mode: 'one-shot', provider: 'spawn' }, false],
  ['v2-new-field', { version: 2, mode: 'continuable', provider: 'spawn', label: 'child', agentReasoningEffort: 'high' }, false],
  ['unknown-field', { version: 2, mode: 'one-shot', provider: 'spawn', unexpected: true }, false],
  ['unpaired-route', { version: 2, mode: 'continuable', provider: 'spawn', label: 'child', agentModel: 'test' }, false],
]) {
  const row = { type: 'subagent/descriptor', seq: 0, time: 1, data }
  const before = JSON.stringify(row)
  let artifact, error
  try {
    const restore = createSessionFormatCatalogWithChildren([]).createRestore({ type: 'session', version: 0, id: 'synthetic-descriptor', createdAt: 1, delegationDepth: 0 }, { recovery: 'strict', validation: 'current' })
    restore.decodeRow(row)
    artifact = restore.finish()
  } catch (failure) { error = failure.message }
  assert.equal(Boolean(artifact), accepted, `${name}: ${error}`)
  assert.equal(JSON.stringify(row), before, 'input must remain unchanged')
  if (accepted) {
    assert.deepEqual(artifact.events[0].data, { ...data, version: 3 })
    assert.ok(foldSubagentDescriptor(artifact.events), 'official runtime recognizes migrated composition')
  }
  checks.push({ name, accepted: Boolean(artifact), sourceUnchanged: true, error })
}
const report = { experimental: true, qualifiesRelease: false, checks }
await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
