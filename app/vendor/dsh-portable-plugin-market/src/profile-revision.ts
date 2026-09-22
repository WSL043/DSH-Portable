import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Bind a deferred rollback to exactly the profile state it was offered for. */
export function profileRevision(dir: string): string {
  const hash = createHash('sha256')
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', '.dsh-market/state.json']) {
    hash.update(name + '\0')
    try { const bytes = readFileSync(join(dir, name)); hash.update(`present:${bytes.length}\0`); hash.update(bytes) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; hash.update('missing\0') }
  }
  return hash.digest('hex')
}
