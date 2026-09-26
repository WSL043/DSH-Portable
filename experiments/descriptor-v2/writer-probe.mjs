import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// This consumes a separately installed, exact historical writer. Never import it in products.
const [writerRoot, patchedApp, originalApp, output] = process.argv.slice(2)
if (!output) throw new Error('usage: writer-probe.mjs <old writer root> <patched isolated app> <unmodified app> <new output>')
const root = path.resolve(output)
await mkdir(root)
async function load(base, name) {
  return import(pathToFileURL(path.resolve(base, 'node_modules/@deepseek-ai', name, 'lib/index.js')))
}
for (const name of ['dsh-session', 'dsh-subagent', 'dsh-llm', 'dsh-agent', 'dsh-tools', 'dsh-scope', 'dsh-timeout']) {
  const pkg = JSON.parse(await readFile(path.resolve(writerRoot, 'node_modules/@deepseek-ai', name, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '0.1.1-rc.2', `unexpected writer dependency ${name}`)
}
const { Session, SessionId, packChunkRuns, SESSION_FORMAT_VERSION } = await load(writerRoot, 'dsh-session')
const { snapshotSubagentDescriptor, seedDescriptorTurn, SUBAGENT_DESCRIPTOR_VERSION } = await load(writerRoot, 'dsh-subagent')
const { createUserMessage, createAssistantMessage, createToolResultMessage } = await load(writerRoot, 'dsh-llm')
assert.equal(SESSION_FORMAT_VERSION, 0)
assert.equal(SUBAGENT_DESCRIPTOR_VERSION, 2)
function turn(session, label, number) {
  session.append('turn/start', { turn: number })
  // Released dsh-agent-loop 0.1.1-rc.2 lines 548-554 starts the step BEFORE committing user messages.
  session.append('step/start', { turn: number, step: 1 })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: label }] }), { surfaceOp: 'append' })
  session.append('request/header', { header: { config: { provider: 'fixture', model: 'fixture' } }, reason: 'initial' })
  const callId = `${label}-call`
  session.append('assistant/message', { turn: number, step: 1, message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'tool-call', id: callId, name: 'fixture_tool', arguments: '{}' }] }) }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const call = session.append('tool/call', { turn: number, step: 1, callId, name: 'fixture_tool', arguments: '{}' })
  session.append('tool/result', { turn: number, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: `${label}-tool-result` }], isError: false }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn: number, step: 1 })
  session.append('step/start', { turn: number, step: 2 })
  session.append('assistant/message', { turn: number, step: 2, message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: `${label}-done` }] }) }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: number, step: 2 })
  session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
}
const parent = Session.create(SessionId('writer-parent'), undefined, { version: 0, id: 'writer-parent', createdAt: 1000, cwd: root, delegationDepth: 0 })
turn(parent, 'parent', 1)
const descriptor = snapshotSubagentDescriptor({ mode: 'continuable', provider: 'in-process', label: 'historical child', agentProvider: 'fixture', agentModel: 'fixture', persona: 'historical persona', toolFilter: { allow: ['fixture_tool'] } })
const child = Session.create(SessionId('writer-child'), seedDescriptorTurn(SessionId('writer-child'), parent.events, descriptor), { version: 0, id: 'writer-child', createdAt: 1001, cwd: root, parentSession: parent.id, seedLength: parent.events.length, origin: 'subagent', delegationDepth: 1 })
turn(child, 'child', 2)
const files = new Map()
for (const session of [parent, child]) {
  // Header mapping matches published persistence-jsonl 0.1.1-rc.2; rows use its exported packer.
  const text = [{ type: 'session', ...session.header, delegationDepth: session.header.delegationDepth ?? 0 }, ...packChunkRuns(session.events)].map(JSON.stringify).join('\n') + '\n'
  const file = path.join(root, `${session.id}.jsonl`)
  await writeFile(file, text)
  files.set(file, createHash('sha256').update(text).digest('hex'))
}
const { createSessionFormatCatalogWithChildren, historicalSessionFormatCatalog } = await load(patchedApp, 'dsh-session-format-catalog')
const { historicalChildCatalogSource } = await load(patchedApp, 'dsh-session-format-v3-to-v4')
const { foldSubagentDescriptor } = await load(patchedApp, 'dsh-subagent')
const originalCatalog = originalApp === '-' ? undefined : await load(originalApp, 'dsh-session-format-catalog')
async function restore(id, catalog) {
  const rows = (await readFile(path.join(root, `${id}.jsonl`), 'utf8')).trim().split('\n').map(JSON.parse)
  const decoder = catalog.createRestore(rows.shift(), { recovery: 'strict', validation: 'current' })
  for (const row of rows) decoder.decodeRow(row)
  return decoder.finish()
}
if (originalCatalog) await assert.rejects(restore(child.id, originalCatalog.historicalSessionFormatCatalog), /subagent\/descriptor .*uses unsupported descriptor version 2/)
const childHistory = await restore(child.id, historicalSessionFormatCatalog)
const childFacts = historicalChildCatalogSource(childHistory)
const restoredParent = await restore(parent.id, createSessionFormatCatalogWithChildren([childFacts]))
const restoredChild = await restore(child.id, createSessionFormatCatalogWithChildren([]))
assert.deepEqual(foldSubagentDescriptor(restoredChild.events), { ...descriptor, version: 3 })
assert.equal(restoredChild.header.parentSession, parent.id)
// V2->V3 inserts a system-head event; compare the inherited content, not raw legacy offsets.
const inherited = restoredChild.events.slice(0, restoredChild.inheritedEventCount)
const inheritedMessages = inherited.filter(e => ['user/message', 'assistant/message', 'tool/result'].includes(e.type))
assert.deepEqual(inheritedMessages.map(e => e.data), restoredParent.events.filter(e => ['user/message', 'assistant/message', 'tool/result'].includes(e.type)).map(e => e.data))
assert.deepEqual(inheritedMessages.map(e => (e.data.message ?? e.data).id), parent.events.filter(e => ['user/message', 'assistant/message', 'tool/result'].includes(e.type)).map(e => (e.data.message ?? e.data).id))
const inheritedTool = inheritedMessages.find(e => e.type === 'tool/result').data.message
assert.equal(inheritedTool.toolCallId, 'parent-call')
assert.deepEqual(inheritedTool.content, [{ type: 'text', text: 'parent-tool-result' }])
assert.ok(!JSON.stringify(inherited).includes('child-tool-result'))
assert.ok(restoredParent.events.some(e => e.type === 'subagent/catalog' && e.data.childId === child.id))
for (const label of ['parent', 'child']) assert.ok(JSON.stringify(restoredChild.events).includes(`${label}-tool-result`))
for (const [file, hash] of files) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash)
const result = { experimental: true, qualifiesRelease: false, writer: '0.1.1-rc.2', originalRuntimeRefusalVerified: Boolean(originalCatalog), physicalHeader: 'published header mapping; official event packer', checks: ['exact-writer-versions', 'parent-child-catalog', 'inherited-message-identity-and-content', 'descriptor-composition', 'both-tool-results', 'source-file-hashes'], files: Object.fromEntries(files), remaining: ['real agent continuation', 'official persistence save path', 'final packaged native acceptance'] }
await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
