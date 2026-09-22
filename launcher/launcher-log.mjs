import { appendFileSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

// Match the native shell's retention: current log plus one previous generation.
// Logging is best effort; a locked file must never prevent startup or recovery.
export function appendLauncherLog(directory, line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > 16 * 1024) return false
  try {
    mkdirSync(directory, { recursive: true })
    if (lstatSync(directory).isSymbolicLink()) return false
    const current = path.join(directory, 'launcher.log')
    const previous = `${current}.previous`
    const inspect = filename => {
      try {
        const info = lstatSync(filename)
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Not a regular log file')
        return info
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    }
    const info = inspect(current)
    if (info && info.size + Buffer.byteLength(line) > 1024 * 1024) {
      inspect(previous)
      rmSync(previous, { force: true })
      renameSync(current, previous)
    }
    appendFileSync(current, line, { encoding: 'utf8', mode: 0o600 })
    return true
  } catch { return false }
}
