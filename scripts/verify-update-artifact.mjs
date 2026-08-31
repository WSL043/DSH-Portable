import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { validateArchiveEntries } from '../launcher/update-core.mjs'

const execFileAsync = promisify(execFile)

function fail(message) {
  throw new Error(message)
}

function normalizedEntry(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
}

async function sha256(filename) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest('hex')
}

async function archiveText(archive, rawEntry) {
  if (process.platform === 'linux') {
    const result = await execFileAsync('unzip', ['-p', archive, rawEntry], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    return result.stdout
  }
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
  const result = await execFileAsync(tar, ['-x', '-O', '-f', archive, rawEntry], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  })
  return result.stdout
}

async function main() {
  const [manifestFile, archive, expectedKind] = process.argv.slice(2)
  if (!manifestFile || !archive) fail('Usage: node scripts/verify-update-artifact.mjs <manifest.json> <component.zip> [product|engine]')

  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (manifest.schemaVersion !== 1 || !manifest.portableVersion || !manifest.platform) fail('Update manifest is incomplete.')
  const updateKind = manifest.updateKind ?? 'product'
  if (!['product', 'engine'].includes(updateKind)) fail('Update manifest kind is invalid.')
  if (expectedKind && updateKind !== expectedKind) fail(`Expected an ${expectedKind} update manifest, received ${updateKind}.`)
  const minimumUpdaterSchema = Number(manifest.minimumUpdaterSchema)
  const requiredShellSchema = Number(manifest.requiredShellSchema)
  if (!Number.isSafeInteger(minimumUpdaterSchema) || minimumUpdaterSchema < 1
    || !Number.isSafeInteger(requiredShellSchema) || requiredShellSchema < 1) {
    fail('Update compatibility metadata is incomplete.')
  }
  if (manifest.requiredShellFingerprint != null && !/^[a-f0-9]{64}$/i.test(String(manifest.requiredShellFingerprint))) {
    fail('Update shell fingerprint is invalid.')
  }
  const component = manifest.component
  if (!component || !['dsh-app', 'dsh-runtime-capsule'].includes(component.kind) || !component.requiredNodeVersion) {
    fail('Update component metadata is incomplete.')
  }

  const archiveInfo = await stat(archive)
  if (archiveInfo.size !== Number(component.bytes)) fail(`component size mismatch: expected ${component.bytes}, received ${archiveInfo.size}`)
  const actualDigest = await sha256(archive)
  if (actualDigest !== String(component.sha256).toLowerCase()) fail(`component digest mismatch: expected ${component.sha256}, received ${actualDigest}`)

  const archiveName = path.basename(archive)
  const declaredNames = (component.urls ?? []).map((value) => path.basename(new URL(value).pathname))
  if (!declaredNames.includes(archiveName)) fail(`Update manifest does not publish ${archiveName}.`)

  const listed = process.platform === 'linux'
    ? await execFileAsync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    : await execFileAsync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-t', '-f', archive], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    })
  const rawEntries = listed.stdout.split(/\r?\n/).filter(Boolean)
  validateArchiveEntries(rawEntries)
  const entryMap = new Map(rawEntries.map((entry) => [normalizedEntry(entry), entry]))
  const requiredEntries = component.kind === 'dsh-runtime-capsule' ? [
    'component.json',
    'runtime-capsule.json',
    'runtime/DSH-App.dshpack',
  ] : [
    'component.json',
    'app/package.json',
  ]
  for (const required of [
    ...requiredEntries,
    'licenses/COMPONENTS.json',
    'licenses/DeepSeek-Harness-LICENSE.txt',
    'licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md',
    'licenses/dsh-market-LICENSE.txt',
    'licenses/pnpm-LICENSE.txt',
  ]) {
    if (!entryMap.has(required)) fail(`Update archive is missing ${required}.`)
  }
  if (component.kind === 'dsh-app' && ![...entryMap.keys()].some((entry) => entry.startsWith('app/node_modules/@deepseek-ai/dsh/'))) {
    fail('Update archive contains no DeepSeek Harness runtime.')
  }

  const embedded = JSON.parse(await archiveText(archive, entryMap.get('component.json')))
  const components = JSON.parse(await archiveText(archive, entryMap.get('licenses/COMPONENTS.json')))
  for (const [field, expected] of Object.entries({
    kind: component.kind,
    portableVersion: manifest.portableVersion,
    dshVersion: component.dshVersion,
    dshCommit: component.dshCommit,
  })) {
    if (embedded[field] !== expected) fail(`Embedded component ${field} does not match the manifest.`)
  }
  if (components.portableVersion !== manifest.portableVersion
    || components.dshVersion !== component.dshVersion
    || components.dshCommit !== component.dshCommit
    || components.platform !== manifest.platform
    || components.nodeVersion !== component.requiredNodeVersion
    || (component.runtimeLayout && components.runtimeLayout !== component.runtimeLayout)
    || Number(components.updaterSchema) < Number(manifest.minimumUpdaterSchema)
    || Number(components.shellSchema) < Number(manifest.requiredShellSchema)
    || (manifest.requiredShellFingerprint && components.shellFingerprint !== manifest.requiredShellFingerprint)) {
    fail('Installed component metadata does not match the update manifest.')
  }

  process.stdout.write(`${JSON.stringify({
    status: 'verified',
    updateKind,
    platform: manifest.platform,
    portableVersion: manifest.portableVersion,
    dshVersion: component.dshVersion,
    bytes: archiveInfo.size,
    sha256: actualDigest,
  })}\n`)
}

await main()
