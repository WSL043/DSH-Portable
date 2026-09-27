import { lstat, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { lstatIfPresent, normalizeDataPath, safeDataTarget, writeDataFileAtomic } from './data-paths.mjs'
import { queryProcess } from './portable-core.mjs'

const JOURNAL = 'data/runtime/data-import.json'
const failure = message => Object.assign(new Error(message), { code: 'DSH_DATA_IMPORT_RECOVERY_REQUIRED' })

export async function assertImportProfilesIdle(layout, paths) {
  const profiles = new Set(paths.map(value => /^data\/dsh-home\/profiles\/([^/]+)\//.exec(value)?.[1]).filter(Boolean))
  for (const profile of [...profiles].sort()) {
    const lock = await safeDataTarget(layout.stateRoot, `data/dsh-home/profiles/${profile}/package.json.lock`, { leaf: 'any', createParents: false })
    if (lock && await lstatIfPresent(lock)) throw Object.assign(failure('An official plugin profile lock is present. Close its writer before recovering or importing; an unknown lock is never deleted automatically.'), { code: 'DSH_DATA_IMPORT_PROFILE_BUSY' })
  }
}

export async function importEntryIdentity(filename) {
  const stat = await lstat(filename, { bigint: true })
  // The same filesystem entry retains its identity when renamed during rollback.
  // Never infer successful restoration merely from a missing backup.
  return { dev: String(stat.dev), ino: String(stat.ino), birth: String(stat.birthtimeNs),
    ...(stat.isFile() ? { hash: createHash('sha256').update(await readFile(filename)).digest('hex') } : {}),
    kind: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other' }
}

async function hasIdentity(filename, identity) {
  if (!identity || !await lstatIfPresent(filename)) return false
  const actual = await importEntryIdentity(filename)
  return actual.ino !== '0' && Object.keys(actual).every(key => actual[key] === identity[key])
}

export async function saveImportJournal(layout, journal) {
  const filename = await safeDataTarget(layout.stateRoot, JOURNAL)
  await writeDataFileAtomic(filename, `${JSON.stringify(journal)}\n`)
}

export async function clearImportJournal(layout) {
  const filename = await safeDataTarget(layout.stateRoot, JOURNAL, { createParents: false })
  if (filename) await rm(filename, { force: true })
}

function checkedPath(value, prefix) {
  if (typeof value !== 'string' || normalizeDataPath(value) !== value
    || (prefix ? !value.startsWith(prefix) : !/^(?:data|workspace)\//.test(value))) {
    throw failure('Unsafe import recovery record. Keep the recovery files for diagnosis.')
  }
  return value
}

// Caller holds the product mutation lock and has established that this
// environment is stopped. Paths are relative so recovery survives a folder move.
export async function recoverInterruptedImport(layout, { trace = () => {} } = {}) {
  const filename = await safeDataTarget(layout.stateRoot, JOURNAL, { createParents: false })
  if (!filename || !await lstatIfPresent(filename)) return { status: 'none' }
  if ((await lstat(filename)).size > 64 * 1024 * 1024) throw failure('Import recovery record is too large.')
  let journal
  try { journal = JSON.parse(await readFile(filename, 'utf8')) } catch { throw failure('Import recovery record is unreadable.') }
  if (journal.schemaVersion !== 1 || !['active', 'committed'].includes(journal.phase)
    || !Array.isArray(journal.entries) || journal.entries.length > 200_000
    || !Array.isArray(journal.createdProfiles) || !Array.isArray(journal.temporaries)) {
    throw failure('Unsupported import recovery record.')
  }
  if (!Array.isArray(journal.workers) || journal.workers.length > 10_000
    || journal.workers.some(worker => !Number.isSafeInteger(worker?.pid) || worker.pid < 1 || !/^[a-f0-9]{32}$/.test(worker.token))) {
    throw failure('Invalid import dependency process record.')
  }
  for (const { pid, token } of journal.workers) {
    try { process.kill(pid, 0) } catch (error) {
      if (error.code === 'ESRCH') continue
      throw failure('Cannot verify that the import dependency process has stopped.')
    }
    const processInfo = queryProcess(pid)
    if (processInfo && !processInfo.commandLine.includes(token)) continue // PID reused by an unrelated process.
    if (!processInfo) {
      try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') continue }
      throw failure('Cannot verify import dependency process identity.')
    }
    throw Object.assign(failure('The interrupted import is still finishing a dependency operation. Retry recovery after it exits.'), { code: 'DSH_DATA_IMPORT_WORKER_ACTIVE' })
  }
  await assertImportProfilesIdle(layout, journal.entries.map(entry => entry.path))
  const backupRoot = journal.backupRoot
  if (backupRoot !== null && !/^data\/backups\/before-import-[^/]+$/.test(checkedPath(backupRoot))) {
    throw failure('Unsafe import recovery directory.')
  }
  const entries = []
  const keys = new Set()
  for (const entry of journal.entries) {
    const relative = checkedPath(entry.path)
    if (!['file', 'generated'].includes(entry.kind) || relative.startsWith('data/runtime/')
      || relative.startsWith('data/backups/')) throw failure('Unsafe import recovery target.')
    const key = `${entry.kind}:${process.platform === 'win32' ? relative.toLowerCase() : relative}`
    if (keys.has(key)) throw failure('Duplicate import recovery target.')
    keys.add(key)
    const target = await safeDataTarget(layout.stateRoot, relative, { leaf: entry.kind === 'generated' ? 'any' : 'file' })
    let backup = null
    if (entry.backup !== null) {
      if (!backupRoot) throw failure('Missing import recovery directory.')
      backup = await safeDataTarget(layout.stateRoot, checkedPath(entry.backup, `${backupRoot}/`), { leaf: 'any' })
    }
    entries.push({ ...entry, target, backup })
  }
  const profiles = []
  for (const name of journal.createdProfiles) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(name) || ['.', '..'].includes(name)) throw failure('Unsafe recovery profile.')
    profiles.push(await safeDataTarget(layout.stateRoot, `data/dsh-home/profiles/${name}`, { leaf: 'any' }))
  }
  const temporaries = []
  for (const relative of journal.temporaries) {
    checkedPath(relative)
    if (!/^\.dsh-data-[a-f0-9]{32}\.tmp$/.test(path.posix.basename(relative))
      || !journal.entries.some(entry => path.posix.dirname(entry.path) === path.posix.dirname(relative))) {
      throw failure('Unsafe import recovery temporary file.')
    }
    temporaries.push(await safeDataTarget(layout.stateRoot, relative))
  }
  if (journal.phase === 'committed') {
    await clearImportJournal(layout)
    return { status: 'committed' }
  }
  // Validate ALL backups before deleting anything, including a previously
  // consumed backup whose exact filesystem entry must now be at the target.
  for (const entry of entries) {
    if (!entry.backup) {
      if (entry.kind === 'file' && await lstatIfPresent(entry.target)) {
        const identity = await importEntryIdentity(entry.target)
        if (identity.hash !== entry.writtenHash) throw failure('Imported file changed after the interrupted operation.')
      }
      continue
    }
    if (await lstatIfPresent(entry.backup)) {
      if (!await hasIdentity(entry.backup, entry.identity)) throw failure('Import recovery backup changed.')
      if (entry.kind === 'file' && await lstatIfPresent(entry.target)) {
        const targetIdentity = await importEntryIdentity(entry.target)
        if (targetIdentity.hash !== entry.writtenHash && targetIdentity.hash !== entry.identity.hash) {
          throw failure('Imported file changed after the interrupted operation. Keep both versions for manual recovery.')
        }
      }
    } else if (!await hasIdentity(entry.target, entry.identity)) {
      throw Object.assign(failure('An import recovery backup is missing.'), { code: 'DSH_DATA_IMPORT_BACKUP_MISSING' })
    }
  }
  trace('interrupted-import-recovery-begin', { entries: entries.length })
  for (const kind of ['generated', 'file']) {
    for (const entry of entries.filter(item => item.kind === kind).reverse()) {
      if (entry.backup && !await lstatIfPresent(entry.backup)) continue
      await rm(entry.target, { recursive: kind === 'generated', force: true })
      if (entry.backup) await rename(entry.backup, entry.target)
    }
  }
  for (const temporary of temporaries) await rm(temporary, { force: true })
  for (const directory of profiles) await rm(directory, { recursive: true, force: true })
  // Remove the journal before optional backup-directory cleanup: a crash in
  // cleanup must not replay a completed rollback against absent backups.
  await clearImportJournal(layout)
  if (backupRoot) {
    const directory = await safeDataTarget(layout.stateRoot, backupRoot, { leaf: 'any' })
    if ((await lstatIfPresent(directory))?.isSymbolicLink()) throw failure('Unsafe recovery directory.')
    await rm(directory, { recursive: true, force: true })
  }
  trace('interrupted-import-recovery-complete')
  return { status: 'recovered', entries: entries.length }
}
