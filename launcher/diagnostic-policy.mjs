import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const MAX_DIAGNOSTIC_BYTES = 256 * 1024
const MAX_ERROR_DETAIL_CHARS = 32 * 1024

export function redactDiagnosticText(source) {
  let value = String(source ?? '')
  value = value.replace(/(["'](?:[^"']*(?:token|password|secret|authorization|cookie|api[_-]?key)[^"']*)["']\s*:\s*)["'][^"']*["']/gi, '$1"[REDACTED]"')
  value = value.replace(/\b(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
  value = value.replace(/\b([A-Za-z0-9_.-]*(?:token|password|secret|authorization|cookie|api[_-]?key)[A-Za-z0-9_.-]*)\b\s*[:=]\s*([^\s,;}&]+)/gi, '$1=[REDACTED]')
  value = value.replace(/([?&](?:token|access_token|auth|authorization)=)[^&#\s]+/gi, '$1[REDACTED]')
  value = value.replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
  const home = os.homedir()
  if (home) value = value.replaceAll(home, '<USER_HOME>')
  return value
}

export function classifyPortableError(error) {
  const source = String(error?.stack ?? error?.message ?? error ?? '')
  if (/restored but could not restart|previous version could not be restarted/i.test(source)) return 'UPDATE_RECOVERY_FAILED'
  if (/rolled back[\s\S]*previous version was restored and restarted/i.test(source)) return 'UPDATE_ROLLED_BACK'
  if (/Another portable launcher is already starting or stopping DSH/i.test(source)) return 'LAUNCH_IN_PROGRESS'
  if (/Close the other Portable environment/i.test(source)) return 'SHARED_COMPONENTS_BUSY'
  if (/EADDRINUSE|address already in use/i.test(source)) return 'PORT_IN_USE'
  if (/DeepSeek Harness failed to start|DSH runtime did not pass|workspace did not become ready/i.test(source)) return 'DSH_START_FAILED'
  if (/\bupdate\b/i.test(source)) return 'UPDATE_FAILED'
  return 'PORTABLE_COMMAND_FAILED'
}

export function portablePublicError(error) {
  const code = classifyPortableError(error)
  const messages = {
    UPDATE_ROLLED_BACK: 'The update did not pass startup validation. The previous version was restored and restarted. Details were saved to the support log.',
    UPDATE_RECOVERY_FAILED: 'The update failed and the previous version could not be restarted. Reopen DSH-Portable and export a support report.',
    PORT_IN_USE: 'The local DSH service port is already in use. Close the other DSH instance and try again.',
    DSH_START_FAILED: 'DeepSeek Harness did not become ready. Reopen DSH-Portable and export a support report.',
    LAUNCH_IN_PROGRESS: 'DSH-Portable is already starting or stopping. Try again in a moment.',
    SHARED_COMPONENTS_BUSY: 'Close the other running DSH-Portable environments before changing shared components.',
    UPDATE_FAILED: 'The update could not be completed. The installation was left in a recoverable state; export a support report for details.',
    PORTABLE_COMMAND_FAILED: 'DSH-Portable could not complete the requested operation. Export a support report for details.',
  }
  return { code, message: messages[code] }
}

export async function recordPortableDiagnostic(logsDir, { operation = 'unknown', error } = {}) {
  if (!logsDir) return null
  try {
    await mkdir(logsDir, { recursive: true })
    const filename = path.join(logsDir, 'portable-errors.jsonl')
    const previous = `${filename}.previous`
    let existing = Buffer.alloc(0)
    try { existing = await readFile(filename) } catch (readError) {
      if (readError?.code !== 'ENOENT') throw readError
    }
    const detail = redactDiagnosticText(error?.stack ?? error?.message ?? error ?? '').slice(0, MAX_ERROR_DETAIL_CHARS)
    const entry = Buffer.from(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      operation,
      code: classifyPortableError(error),
      detail,
    })}\n`, 'utf8')
    if (existing.length + entry.length > MAX_DIAGNOSTIC_BYTES) {
      await rm(previous, { force: true })
      if (existing.length) await rename(filename, previous)
      existing = Buffer.alloc(0)
    }
    const next = existing.length ? Buffer.concat([existing, entry]) : entry
    await writeFile(filename, next, { mode: 0o600 })
    return filename
  } catch {
    return null
  }
}
