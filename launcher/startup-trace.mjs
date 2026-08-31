import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

const STARTUP_ID = /^[0-9a-f]{32}$/i
const BLOCKED_FIELD = /token|password|secret|authorization|cookie/i

function validContext(trace) {
  return trace
    && STARTUP_ID.test(String(trace.startupId || ''))
    && Number.isFinite(Number(trace.startedAt))
    && Number(trace.startedAt) > 0
    && typeof trace.filename === 'string'
    && path.isAbsolute(trace.filename)
}

function safeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {})
    .filter(([key, value]) => !BLOCKED_FIELD.test(key) && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, typeof value === 'string'
      ? value.replace(/[\r\n]+/g, ' ').slice(0, 512)
      : value]))
}

export function traceFromEnvironment(logDirectory, env = process.env) {
  const startupId = String(env.DSH_PORTABLE_STARTUP_ID || '')
  const startedAt = Number(env.DSH_PORTABLE_STARTUP_STARTED_AT)
  if (!STARTUP_ID.test(startupId) || !Number.isFinite(startedAt) || startedAt <= 0) return null
  return { filename: path.join(logDirectory, 'startup-latest.jsonl'), startupId, startedAt }
}

export function appendStartupTrace(trace, component, phase, fields = {}) {
  if (!validContext(trace) || !component || !phase) return false
  try {
    mkdirSync(path.dirname(trace.filename), { recursive: true })
    appendFileSync(trace.filename, `${JSON.stringify({
      ...safeFields(fields),
      timestamp: new Date().toISOString(),
      startupId: trace.startupId,
      elapsedMs: Math.max(0, Date.now() - Number(trace.startedAt)),
      component: String(component).slice(0, 80),
      phase: String(phase).slice(0, 160),
    })}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

export function beginStartupTrace(logDirectory, {
  startupId,
  startedAt,
  component = 'runtime-entry',
  phase = 'process-start',
  fields = {},
} = {}) {
  const trace = {
    filename: path.join(String(logDirectory || ''), 'startup-latest.jsonl'),
    startupId,
    startedAt,
  }
  if (!validContext(trace)) return null
  try {
    mkdirSync(logDirectory, { recursive: true })
    const previous = path.join(logDirectory, 'startup-previous.jsonl')
    rmSync(previous, { force: true })
    if (existsSync(trace.filename)) renameSync(trace.filename, previous)
  } catch {
    return null
  }
  return appendStartupTrace(trace, component, phase, fields) ? trace : null
}
