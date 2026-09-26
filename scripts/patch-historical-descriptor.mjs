import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const descriptorV2PatchIdentity = Object.freeze({
  id: 'released-v0-descriptor-v2-read-v1',
  dshVersion: '0.1.7-alpha.1',
  sourceSha256: '1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1',
  patchedSha256: '18a9dbd15694de23a89a9db8787f336e9da1ddf70a32f2ecd9c2918011c833d6',
})
const hash = source => createHash('sha256').update(source).digest('hex')
// Only the reviewed immutable baseline is supported. Retire after equivalent
// official migration passes the same writer/continuation fixtures.
export function patchDescriptorV2ReadMigration(source) {
  if (hash(source) === descriptorV2PatchIdentity.patchedSha256) return source
  if (hash(source) !== descriptorV2PatchIdentity.sourceSha256) {
    throw new Error('Unreviewed migration bundle; refusing descriptor compatibility patch')
  }
  const start = source.indexOf('function normalizeReleasedV0Event(event, sessionId, state) {')
  const end = source.indexOf('\nfunction normalizeLegacyCompactionType', start)
  if (start < 0 || end < start) throw new Error('Migration seam unavailable')
  const original = source.slice(start, end)
  const validation = '\tif (message.type !== "assistant/chunk") assertReleasedEventPayload(message, 0);'
  if (!original.includes(validation)) throw new Error('Migration validation seam unavailable')
  const replacement = original.replace('const message = normalizeLegacyMessage(', 'let message = normalizeLegacyMessage(')
    .replace(validation, `\tif (message.type === "subagent/descriptor" && message.data?.version === 2) {
    // v2 had no reasoning-effort member. Unknown v2 fields remain invalid;
    // the existing v3 validator below checks all other keys and semantics.
    if (Object.hasOwn(message.data, "agentReasoningEffort")) throw new SessionFormatError("descriptor v2 cannot contain agentReasoningEffort");
    message = { ...message, data: { ...message.data, version: 3 } };
  }
${validation}`)
  const result = source.slice(0, start) + replacement + source.slice(end)
  if (hash(result) !== descriptorV2PatchIdentity.patchedSha256) throw new Error('Historical compatibility output does not match reviewed identity')
  return result
}

export async function prepareHistoricalDescriptor(appRoot, { verifyOnly = false } = {}) {
  const core = JSON.parse(await readFile(path.join(appRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
  if (core.version !== descriptorV2PatchIdentity.dshVersion) return { applied: false, reason: 'different-core' }
  const bundle = path.join(appRoot, 'node_modules/@deepseek-ai/dsh-session-format-v0-to-v1/lib/index.js')
  const manifest = path.join(appRoot, 'portable-session-compatibility.json')
  const source = await readFile(bundle, 'utf8')
  if (verifyOnly) {
    if (hash(source) !== descriptorV2PatchIdentity.patchedSha256
      || JSON.stringify(JSON.parse(await readFile(manifest, 'utf8'))) !== JSON.stringify(descriptorV2PatchIdentity)) {
      throw new Error('Historical compatibility package identity mismatch')
    }
  } else {
    const patched = patchDescriptorV2ReadMigration(source)
    if (patched !== source) {
      // Detach pnpm hardlinks before replacing bytes; never rewrite a shared store inode.
      const temporary = `${bundle}.${randomUUID()}.portable-tmp`
      try {
        await writeFile(temporary, patched, { flag: 'wx' })
        await rename(temporary, bundle)
      } finally { await rm(temporary, { force: true }) }
    }
    await writeFile(manifest, JSON.stringify(descriptorV2PatchIdentity, null, 2) + '\n')
  }
  return { applied: true, ...descriptorV2PatchIdentity }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: patch-historical-descriptor.mjs <staged-app>')
  console.log(JSON.stringify(await prepareHistoricalDescriptor(path.resolve(process.argv[2]))))
}
