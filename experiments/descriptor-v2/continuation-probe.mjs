import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [app, fixtures, destination] = process.argv.slice(2)
if (!destination) throw new Error('usage: continuation-probe.mjs <isolated patched app> <writer fixtures> <new destination>')
const root = path.resolve(destination)
await mkdir(root)
const load = name => import(pathToFileURL(path.resolve(app, 'node_modules/@deepseek-ai', name, 'lib/index.js')))
const { Context } = await load('cordis')
const { LlmAdapter, createUserMessage } = await load('dsh-llm')
const ctx = new Context()
const requests = []
let lease
try {
  for (const [name, config] of [
    ['dsh-session-projection', {}], ['dsh-session', {}], ['dsh-agent', {}],
    ['dsh-llm', {}], ['dsh-tools', {}],
    ['dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }],
    ['dsh-session-persistence-jsonl', { root: path.join(root, 'sessions'), compression: 'none' }],
    ['dsh-agent-loop', { agents: [], maxParallelToolCalls: 1 }],
  ]) await ctx.plugin((await load(name)).default, config).await()
  class DeterministicAdapter extends LlmAdapter {
    async *stream(options) {
      requests.push(structuredClone(options.messages))
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'continued-from-historical-child' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'continued-from-historical-child' } }
      yield { type: 'finish', reason: 'stop' }
    }
  }
  ctx.llm.registerAdapter(['fixture'], new DeterministicAdapter())
  const originalHashes = new Map()
  for (const id of ['writer-parent', 'writer-child']) {
    const source = path.resolve(fixtures, `${id}.jsonl`)
    const text = await readFile(source, 'utf8')
    const header = JSON.parse(text.split('\n')[0])
    const current = ctx.sessionPersistence.locate(header).path
    await mkdir(path.dirname(current), { recursive: true })
    const historical = path.join(path.dirname(current), 'session.jsonl')
    await copyFile(source, historical)
    originalHashes.set(historical, createHash('sha256').update(text).digest('hex'))
  }
  lease = await ctx.agentLoop.resume(ctx, { resumeSessionId: 'writer-child', agentOptions: { provider: 'fixture', model: 'fixture' } })
  lease.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue fixture' }] }))
  await lease.agent.whenIdle()
  assert.equal(requests.length, 1)
  assert.match(JSON.stringify(requests[0]), /parent-tool-result/)
  assert.match(JSON.stringify(requests[0]), /child-tool-result/)
  assert.match(JSON.stringify(lease.agent.session.snapshotEvents()), /continued-from-historical-child/)
  await lease.dispose()
  lease = undefined
  const reopened = await ctx.sessionPersistence.open('writer-child', 'read')
  let saved
  try {
    saved = await reopened.read(0)
    assert.match(JSON.stringify(saved.events), /continued-from-historical-child/)
  } finally { await reopened.close() }
  // Persist the durable shape left by an interrupted turn. This is a journal
  // recovery test, not a claim of physical power-loss or storage fault coverage.
  const interruptedTurn = Math.max(...saved.events.filter(e => e.type === 'turn/start').map(e => e.data.turn)) + 1
  const writer = await ctx.sessionPersistence.open('writer-child', 'write')
  try {
    await writer.append([{ type: 'turn/start', seq: saved.events.length, time: Date.now(), data: { turn: interruptedTurn } }])
  } finally { await writer.close() }
  lease = await ctx.agentLoop.resume(ctx, { resumeSessionId: 'writer-child', agentOptions: { provider: 'fixture', model: 'fixture' } })
  assert.ok(lease.agent.session.snapshotEvents().some(e => e.type === 'turn/end' && e.data.turn === interruptedTurn && e.data.reason.kind === 'interrupted'))
  lease.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue after interrupted journal' }] }))
  await lease.agent.whenIdle()
  assert.equal(requests.length, 2)
  await lease.dispose()
  lease = undefined
  const recovered = await ctx.sessionPersistence.open('writer-child', 'read')
  try {
    const events = (await recovered.read(0)).events
    assert.ok(events.some(e => e.type === 'turn/end' && e.data.turn === interruptedTurn && e.data.reason.kind === 'interrupted'))
    assert.equal(events.filter(e => e.type === 'assistant/message' && JSON.stringify(e.data).includes('continued-from-historical-child')).length, 2)
  } finally { await recovered.close() }
  for (const [file, hash] of originalHashes) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash)
  const result = { experimental: true, qualifiesRelease: false, continuation: true, persistedReopen: true, interruptedJournalRecovery: true, physicalPowerLossTested: false, originalHistoricalFilesUnchanged: true }
  await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await lease?.dispose()
  await ctx.fiber.dispose()
}
