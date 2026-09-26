import { createHash } from 'node:crypto'

// Experimental only: not referenced by any product builder or runtime launcher.
// This exact alpha.1 bundle is the published stable baseline, not a moving source.
export function patchDescriptorV2ReadMigration(source) {
  if (createHash('sha256').update(source).digest('hex') !== '1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1') {
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
  return source.slice(0, start) + replacement + source.slice(end)
}
