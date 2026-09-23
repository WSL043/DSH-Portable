import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { safeDataTarget, writeDataFileAtomic } from './data-paths.mjs'

const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/
const PROFILE_MANIFEST = 'data/dsh-home/profiles/web/package.json'
const RECOVERY_JOURNAL = 'data/runtime/startup-profile-recovery.json'

function kindOf(name) {
  if (name.startsWith('@deepseek-ai/')) return 'official'
  if (name === '@wsl043/dsh-portable-desktop-bridge' || name === '@wsl043/dsh-portable-plugin-market') return 'portable'
  return 'community'
}

async function manifestPath(layout) {
  return safeDataTarget(layout.stateRoot, PROFILE_MANIFEST, { createParents: false })
}

async function readProfile(layout) {
  const filename = await manifestPath(layout)
  if (!filename) return null
  const source = await readFile(filename, 'utf8')
  const manifest = JSON.parse(source)
  if (!Array.isArray(manifest?.dsh?.profile?.bundles)
    || !manifest.dsh.profile.bundles.every(name => typeof name === 'string')) {
    throw new Error('The web profile bundle list is invalid; no recovery edit was made.')
  }
  return { filename, source, manifest, bundles: manifest.dsh.profile.bundles }
}

async function packageVersion(root, name) {
  if (!PACKAGE_NAME.test(name)) return null
  const filename = path.join(root, 'node_modules', ...name.split('/'), 'package.json')
  try {
    const manifest = JSON.parse(await readFile(filename, 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    // A broken package manifest is unavailable for startup even if the path exists.
    return null
  }
}

async function readJournal(layout) {
  const filename = await safeDataTarget(layout.stateRoot, RECOVERY_JOURNAL, { createParents: false })
  if (!filename) return { filename: null, pauses: [] }
  const parsed = JSON.parse(await readFile(filename, 'utf8'))
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.pauses)
    || !parsed.pauses.every(item => item && typeof item.name === 'string' && PACKAGE_NAME.test(item.name) && kindOf(item.name) !== 'portable'
      && Number.isSafeInteger(item.position) && item.position >= 0)) {
    throw new Error('Startup profile recovery journal is invalid; no recovery edit was made.')
  }
  return { filename, pauses: parsed.pauses }
}

async function saveJournal(layout, pauses) {
  const filename = await safeDataTarget(layout.stateRoot, RECOVERY_JOURNAL)
  await writeDataFileAtomic(filename, `${JSON.stringify({ schemaVersion: 1, pauses }, null, 2)}\n`)
}

export async function inspectStartupProfile(layout) {
  let profile
  try { profile = await readProfile(layout) } catch {
    return { status: 'invalid-profile', bundles: [], paused: [], detail: 'web profile manifest is invalid or unsafe' }
  }
  let journal
  let journalError = false
  try { journal = await readJournal(layout) } catch {
    journal = { pauses: [] }
    journalError = true
  }
  if (!profile) return { status: journalError ? 'invalid-journal' : 'absent', bundles: [], paused: [], journalError }
  const root = path.dirname(profile.filename)
  const bundles = []
  for (const [position, name] of profile.bundles.entries()) {
    if (!PACKAGE_NAME.test(name)) {
      bundles.push({ index: position + 1, name, kind: 'unknown', status: 'invalid', version: null })
      continue
    }
    const profileVersion = await packageVersion(root, name)
    const runtimeVersion = profileVersion === null ? await packageVersion(layout.appDir, name) : null
    bundles.push({
      index: position + 1,
      name,
      kind: kindOf(name),
      status: profileVersion !== null ? 'profile' : runtimeVersion !== null ? 'runtime' : 'missing',
      version: profileVersion ?? runtimeVersion,
    })
  }
  return {
    status: journalError || bundles.some(item => item.status === 'missing' || item.status === 'invalid') ? 'attention' : 'ok',
    bundles,
    paused: journal.pauses.map((item, index) => ({ index: index + 1, name: item.name, pausedAt: item.pausedAt })),
    journalError,
  }
}

export async function pauseStartupProfileBundle(layout, index) {
  const profile = await readProfile(layout)
  if (!profile) throw new Error('Web profile does not exist; no plugin was paused.')
  const position = index - 1
  const name = profile.bundles[position]
  if (!Number.isSafeInteger(index) || index < 1 || !name || !PACKAGE_NAME.test(name)) {
    throw new Error('Select an active bundle from the recovery list.')
  }
  const kind = kindOf(name)
  const missingOfficial = kind === 'official'
    && await packageVersion(path.dirname(profile.filename), name) === null
    && await packageVersion(layout.appDir, name) === null
  if (kind !== 'community' && !missingOfficial) {
    throw new Error('Only community plugins or an unavailable official bundle can be temporarily paused; Portable and installed official bundles are protected.')
  }
  const journal = await readJournal(layout)
  if (journal.pauses.some(item => item.name === name)) throw new Error('This plugin already has a pending recovery record.')
  const backup = await safeDataTarget(layout.stateRoot, `data/runtime/startup-profile-backup-${randomUUID()}.json`)
  await writeDataFileAtomic(backup, profile.source)
  profile.manifest.dsh.profile.bundles = profile.bundles.filter(item => item !== name)
  await writeDataFileAtomic(profile.filename, `${JSON.stringify(profile.manifest, null, 2)}\n`)
  const pauses = [...journal.pauses, {
    name, position, pausedAt: new Date().toISOString(),
    backup: path.relative(layout.stateRoot, backup).replaceAll('\\', '/'),
  }]
  try { await saveJournal(layout, pauses) } catch (error) {
    await writeDataFileAtomic(profile.filename, profile.source)
    throw error
  }
  return { status: 'paused', name, backup, preserved: ['dependencies', 'plugin files', 'settings', 'sessions', 'workspace'] }
}

export async function restoreStartupProfileBundle(layout, index) {
  const journal = await readJournal(layout)
  const record = journal.pauses[index - 1]
  if (!Number.isSafeInteger(index) || index < 1 || !record) throw new Error('Select a paused plugin from the recovery list.')
  const profile = await readProfile(layout)
  if (!profile) throw new Error('Web profile does not exist; no plugin was restored.')
  const name = record.name
  if (profile.bundles.includes(name)) throw new Error('Plugin is already active; inspect the profile before clearing its recovery record.')
  if (await packageVersion(path.dirname(profile.filename), name) === null
    && await packageVersion(layout.appDir, name) === null) {
    throw new Error(`Plugin ${name} is not installed in the web profile; restore its package before enabling it.`)
  }
  profile.manifest.dsh.profile.bundles.splice(Math.min(record.position, profile.bundles.length), 0, name)
  await writeDataFileAtomic(profile.filename, `${JSON.stringify(profile.manifest, null, 2)}\n`)
  try { await saveJournal(layout, journal.pauses.filter((_, position) => position !== index - 1)) } catch (error) {
    await writeDataFileAtomic(profile.filename, profile.source)
    throw error
  }
  return { status: 'restored', name }
}
