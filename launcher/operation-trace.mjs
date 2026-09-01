import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const OPERATION = /^[a-z][a-z0-9-]{0,47}$/
const BLOCKED_FIELD = /token|password|secret|authorization|cookie/i

function safeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {})
    .filter(([key, value]) => !BLOCKED_FIELD.test(key) && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, typeof value === 'string'
      ? value.replace(/[\r\n]+/g, ' ').slice(0, 256)
      : value]))
}

export function beginOperationTrace(logDirectory, operation) {
  if (!OPERATION.test(String(operation || ''))) return null
  const filename = path.join(logDirectory, `${operation}-latest.jsonl`)
  const previous = path.join(logDirectory, `${operation}-previous.jsonl`)
  try {
    mkdirSync(logDirectory, { recursive: true })
    rmSync(previous, { force: true })
    if (existsSync(filename)) renameSync(filename, previous)
    return { filename, operation, operationId: randomUUID().replaceAll('-', ''), startedAt: Date.now() }
  } catch {
    return null
  }
}

export function appendOperationTrace(trace, phase, fields = {}) {
  if (!trace?.filename || !OPERATION.test(String(trace.operation || '')) || !phase) return false
  try {
    appendFileSync(trace.filename, `${JSON.stringify({
      ...safeFields(fields),
      timestamp: new Date().toISOString(),
      operationId: trace.operationId,
      elapsedMs: Math.max(0, Date.now() - trace.startedAt),
      operation: trace.operation,
      phase: String(phase).slice(0, 120),
    })}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
