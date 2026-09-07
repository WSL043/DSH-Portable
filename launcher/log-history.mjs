import { appendFileSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

const STARTUP_ID = /^[0-9a-f]{32}$/i
const HISTORY_DIR = 'history'
const HISTORY_FILENAMES = new Set(['startup.jsonl', 'runtime-health.jsonl', 'desktop-health.jsonl'])
const MAX_FILE_BYTES = 128 * 1024
const MAX_LINE_BYTES = 16 * 1024
const DEFAULT_MAX_RUNS = 30
const DEFAULT_MAX_AGE_MS = 14 * 86400000
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

function validStartupId(value) {
  return typeof value === 'string' && STARTUP_ID.test(value)
}

function historyDirectory(logDirectory, create) {
  if (typeof logDirectory !== 'string' || logDirectory.length === 0) return null
  let directory
  try { directory = path.resolve(logDirectory, HISTORY_DIR) } catch { return null }
  try {
    const info = lstatSync(directory)
    return info.isDirectory() && !info.isSymbolicLink() ? directory : null
  } catch (error) {
    if (error?.code !== 'ENOENT' || !create) return null
    try { mkdirSync(directory, { recursive: true }) } catch { return null }
    try {
      const info = lstatSync(directory)
      return info.isDirectory() && !info.isSymbolicLink() ? directory : null
    } catch { return null }
  }
}

function runDirectory(history, startupId, create) {
  const directory = path.join(history, startupId)
  if (create) {
    try { mkdirSync(directory, { recursive: true }) } catch { return null }
  }
  try {
    const info = lstatSync(directory)
    return info.isDirectory() && !info.isSymbolicLink() ? directory : null
  } catch { return null }
}

function inspectRun(directory, directoryMtime = 0) {
  const allowed = new Set()
  for (const filename of HISTORY_FILENAMES) {
    allowed.add(filename)
    allowed.add(`${filename}.previous`)
  }

  let entries
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch {
    return { unknown: true, unsafe: true, bytes: 0, runTime: directoryMtime }
  }

  let unknown = false
  let unsafe = false
  let bytes = 0
  let runTime = -Infinity
  for (const entry of entries) {
    if (!allowed.has(entry.name)) {
      // Unknown content is deliberately not inspected. Its run cannot be
      // removed, and it contributes no bytes to history accounting.
      unknown = true
      continue
    }
    let info
    try { info = lstatSync(path.join(directory, entry.name)) } catch {
      unsafe = true
      continue
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      // Allowed names still must be regular files: never follow a link while
      // calculating size or deleting the containing run.
      unsafe = true
      continue
    }
    bytes += info.size
    if (Number.isFinite(info.mtimeMs)) runTime = Math.max(runTime, info.mtimeMs)
  }
  if (!Number.isFinite(runTime)) runTime = Number.isFinite(directoryMtime) ? directoryMtime : 0
  return { unknown, unsafe, bytes, runTime }
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function sameStartupId(left, right) {
  return validStartupId(left) && validStartupId(right) && left.toLowerCase() === right.toLowerCase()
}

function directRealRun(history, run) {
  let historyPath
  let runPath
  try {
    historyPath = path.resolve(history)
    runPath = path.resolve(run.path)
  } catch { return false }
  if (path.dirname(runPath) !== historyPath || path.basename(runPath) !== run.name) return false
  try {
    const info = lstatSync(runPath)
    if (!info.isDirectory() || info.isSymbolicLink()) return false
    const inspected = inspectRun(runPath, info.mtimeMs)
    return !inspected.unknown && !inspected.unsafe
  } catch { return false }
}

/** Append one bounded JSONL line to a per-startup history file. */
export function appendHistoryLog(logDirectory, startupId, filename, line) {
  if (!validStartupId(startupId) || !HISTORY_FILENAMES.has(filename) || typeof line !== 'string') return false
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return false

  try {
    const history = historyDirectory(logDirectory, true)
    if (history === null) return false
    const directory = runDirectory(history, startupId, true)
    if (directory === null) return false

    const current = path.join(directory, filename)
    let currentInfo = null
    try {
      currentInfo = lstatSync(current)
      if (currentInfo.isSymbolicLink() || !currentInfo.isFile()) return false
    } catch (error) {
      if (error?.code !== 'ENOENT') return false
    }

    const data = `${line}\n`
    const dataBytes = Buffer.byteLength(data, 'utf8')
    if (currentInfo !== null && (currentInfo.size > MAX_FILE_BYTES || currentInfo.size + dataBytes > MAX_FILE_BYTES)) {
      const previous = `${current}.previous`
      try {
        const previousInfo = lstatSync(previous)
        if (!previousInfo.isSymbolicLink() && !previousInfo.isFile()) return false
        rmSync(previous, { force: true })
      } catch (error) {
        if (error?.code !== 'ENOENT') return false
      }
      renameSync(current, previous)
    }

    appendFileSync(current, data, { encoding: 'utf8', mode: 0o600 })
    return true
  } catch {
    return false
  }
}

/** Prune bounded per-startup history without traversing arbitrary content. */
export function pruneLogHistory(logDirectory, {
  currentStartupId,
  now = Date.now(),
  maxRuns = DEFAULT_MAX_RUNS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const empty = { removed: 0, retained: 0, bytes: 0 }
  const history = historyDirectory(logDirectory, false)
  if (history === null) return empty

  let entries
  try { entries = readdirSync(history, { withFileTypes: true }) } catch { return empty }
  const runs = []
  for (const entry of entries) {
    if (!STARTUP_ID.test(entry.name)) continue
    const directory = path.join(history, entry.name)
    let info
    try { info = lstatSync(directory) } catch { continue }
    if (!info.isDirectory() || info.isSymbolicLink()) continue
    const inspected = inspectRun(directory, info.mtimeMs)
    runs.push({
      name: entry.name,
      path: directory,
      current: sameStartupId(entry.name, currentStartupId),
      ...inspected,
    })
  }

  runs.sort((left, right) => left.runTime - right.runTime || left.name.localeCompare(right.name))
  let retained = runs.length
  let bytes = runs.reduce((total, run) => total + run.bytes, 0)
  const remove = new Set()
  const eligible = run => !run.current && !run.unknown && !run.unsafe && !remove.has(run.name)
  const mark = (run) => {
    if (!eligible(run)) return false
    remove.add(run.name)
    retained -= 1
    bytes -= run.bytes
    return true
  }

  const timestamp = Number(now)
  const cutoff = (Number.isFinite(timestamp) ? timestamp : Date.now()) - nonNegativeNumber(maxAgeMs, DEFAULT_MAX_AGE_MS)
  for (const run of runs) {
    if (run.runTime < cutoff) mark(run)
  }

  const runLimit = Math.floor(nonNegativeNumber(maxRuns, DEFAULT_MAX_RUNS))
  for (const run of runs) {
    if (retained <= runLimit) break
    mark(run)
  }

  const byteLimit = nonNegativeNumber(maxBytes, DEFAULT_MAX_BYTES)
  for (const run of runs) {
    if (bytes <= byteLimit) break
    mark(run)
  }

  let removed = 0
  const removedNames = new Set()
  for (const run of runs) {
    if (!remove.has(run.name) || !directRealRun(history, run)) continue
    try {
      rmSync(run.path, { recursive: true, force: true })
      removed += 1
      removedNames.add(run.name)
    } catch {
      continue
    }
  }

  // Recompute from successful deletions so a filesystem error never makes
  // the returned accounting claim that data was removed.
  retained = runs.length - removed
  bytes = runs.reduce((total, run) => removedNames.has(run.name) ? total : total + run.bytes, 0)
  return { removed, retained, bytes }
}
