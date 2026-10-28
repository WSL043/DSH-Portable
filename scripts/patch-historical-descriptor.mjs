import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const descriptorV2PatchIdentity = Object.freeze({
  id: 'released-v0-descriptor-v2-read-v1',
  dshVersion: '0.1.7-alpha.1',
  sourceSha256: '1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1',
  patchedSha256: '18a9dbd15694de23a89a9db8787f336e9da1ddf70a32f2ecd9c2918011c833d6',
})
// Alpha 2 only centralizes canonical UTC validation; the reviewed descriptor seam is unchanged.
const alpha2Identity = Object.freeze({
  ...descriptorV2PatchIdentity,
  dshVersion: '0.2.2-alpha.2',
  sourceSha256: '8a78721683388aef35c70c274b27c7700f9cc8deb42cb3d7a1f562a6aa6b7607',
  patchedSha256: '97880785fab8cadf1c0344b4dcd4426040a443be9253c590ce0dc3886d49b1f2',
})
const legacyValidationBlobs = Object.freeze({
  'packages/session/session-format-v0-to-v1/src/validation.ts': '762ed963f73c7159f5309176cc69b11db25ac634',
  'packages/session/session-format-v0-to-v1/src/payload-validation.ts': '5b19f7cc6668d8e9bfc1c75806d3898132eb94ee',
})
const alpha2ValidationBlobs = Object.freeze({
  ...legacyValidationBlobs,
  'packages/session/session-format-v0-to-v1/src/payload-validation.ts': '7fd302dfd927427ecab8437946558d037f20cad2',
})

// Shape review does not admit a runtime version; the exact-version allowlist still does that.
export function descriptorV2ReviewedInputsFor(version) {
  return version === alpha2Identity.dshVersion
    ? { identity: alpha2Identity, validationBlobs: alpha2ValidationBlobs }
    : { identity: descriptorV2PatchIdentity, validationBlobs: legacyValidationBlobs }
}
const HISTORICAL_DESCRIPTOR_VERSIONS_URL = new URL('../config/historical-descriptor-versions.json', import.meta.url)
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function readHistoricalDescriptorVersions(filePath = HISTORICAL_DESCRIPTOR_VERSIONS_URL) {
  let versions
  try {
    versions = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'missing' : 'unreadable or invalid JSON'
    throw new Error(`historical descriptor version allowlist is ${reason}`, { cause: error })
  }
  if (!Array.isArray(versions) || versions.length === 0
    || versions.some(version => typeof version !== 'string' || !EXACT_VERSION.test(version))
    || new Set(versions).size !== versions.length) {
    throw new Error('historical descriptor version allowlist must be a non-empty array of unique exact version strings')
  }
  return versions
}

export function descriptorV2PatchIdentityFor(version) {
  const versions = readHistoricalDescriptorVersions()
  if (version === descriptorV2PatchIdentity.dshVersion && versions.includes(version)) return descriptorV2PatchIdentity
  // This file is an exact, reviewable allowlist; ranges, prefixes, and globs are invalid.
  if (versions.includes(version)) {
    return Object.freeze({ ...descriptorV2ReviewedInputsFor(version).identity, dshVersion: version })
  }
  return null
}
const hash = source => createHash('sha256').update(source).digest('hex')
// Only the reviewed immutable baseline is supported. Retire after equivalent
// official migration passes the same writer/continuation fixtures.
export function patchDescriptorV2ReadMigration(source) {
  const digest = hash(source)
  const identity = [descriptorV2PatchIdentity, alpha2Identity]
    .find(item => digest === item.sourceSha256 || digest === item.patchedSha256)
  if (!identity) throw new Error('Unreviewed migration bundle; refusing descriptor compatibility patch')
  if (digest === identity.patchedSha256) return source
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
  if (hash(result) !== identity.patchedSha256) throw new Error('Historical compatibility output does not match reviewed identity')
  return result
}

export async function prepareHistoricalDescriptor(appRoot, { verifyOnly = false } = {}) {
  const core = JSON.parse(await readFile(path.join(appRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
  const identity = descriptorV2PatchIdentityFor(core.version)
  if (!identity) return { applied: false, reason: 'different-core' }
  const bundle = path.join(appRoot, 'node_modules/@deepseek-ai/dsh-session-format-v0-to-v1/lib/index.js')
  const manifest = path.join(appRoot, 'portable-session-compatibility.json')
  const source = await readFile(bundle, 'utf8')
  if (verifyOnly) {
    if (hash(source) !== identity.patchedSha256
      || JSON.stringify(JSON.parse(await readFile(manifest, 'utf8'))) !== JSON.stringify(identity)) {
      throw new Error('Historical compatibility package identity mismatch')
    }
  } else {
    if (![identity.sourceSha256, identity.patchedSha256].includes(hash(source))) {
      throw new Error('Unreviewed migration bundle for selected core version')
    }
    const patched = patchDescriptorV2ReadMigration(source)
    if (patched !== source) {
      // Detach pnpm hardlinks before replacing bytes; never rewrite a shared store inode.
      const temporary = `${bundle}.${randomUUID()}.portable-tmp`
      try {
        await writeFile(temporary, patched, { flag: 'wx' })
        await rename(temporary, bundle)
      } finally { await rm(temporary, { force: true }) }
    }
    await writeFile(manifest, JSON.stringify(identity, null, 2) + '\n')
  }
  return { applied: true, ...identity }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: patch-historical-descriptor.mjs <staged-app>')
  console.log(JSON.stringify(await prepareHistoricalDescriptor(path.resolve(process.argv[2]))))
}
