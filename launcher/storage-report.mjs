import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'

// On-demand only. Never follow links or scan sessions/workspaces; bounded work
// avoids turning a storage button into a startup or filesystem-wide scan.
export async function inspectStorage(stateRoot, { maxEntries = 100000, timeoutMs = 5000 } = {}) {
  const root = path.resolve(stateRoot)
  const deadline = Date.now() + timeoutMs
  let visited = 0
  const categories = []
  for (const id of ['pnpm-store', 'backups', 'recovery', 'logs']) {
    const result = { id, bytes: 0, files: 0, complete: true }
    categories.push(result)
    const visit = async filename => {
      if (++visited > maxEntries || Date.now() >= deadline) { result.complete = false; return }
      let info
      try { info = await lstat(filename) } catch (error) {
        if (error.code !== 'ENOENT') result.complete = false
        return
      }
      if (info.isSymbolicLink()) { result.complete = false; return }
      if (info.isFile()) { result.bytes += info.size; result.files++; return }
      if (!info.isDirectory()) return
      try {
        // Stream large stores rather than allocating the entire directory listing.
        const directory = await opendir(filename)
        for await (const entry of directory) {
          if (visited >= maxEntries || Date.now() >= deadline) { result.complete = false; break }
          await visit(path.join(filename, entry.name))
        }
      } catch { result.complete = false }
    }
    const data = path.join(root, 'data')
    try {
      const info = await lstat(data)
      if (!info.isDirectory() || info.isSymbolicLink()) { result.complete = false; continue }
    } catch (error) {
      if (error.code !== 'ENOENT') result.complete = false
      continue
    }
    await visit(path.join(data, id))
  }
  return { schemaVersion: 1, complete: categories.every(item => item.complete), categories }
}
