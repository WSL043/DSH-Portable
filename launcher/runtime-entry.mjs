import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireRuntimeLease, cleanUnusedRuntimeCaches, ensureRuntimeCapsule, runtimePreparationDiagnostic } from './runtime-capsule.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [entryName, ...forwarded] = process.argv.slice(2)
if (!entryName || path.basename(entryName) !== entryName || !entryName.endsWith('.mjs')) {
  throw new Error('Runtime entry requires one launcher module name.')
}

const preparationStarted = performance.now()
const prepared = await ensureRuntimeCapsule(root)
const preparationElapsed = performance.now() - preparationStarted
const stateRoot = process.env.DSH_PORTABLE_STATE_ROOT
const logDirectory = stateRoot
  ? path.join(path.resolve(stateRoot), 'data', 'logs')
  : path.join(root, 'data', 'logs')
try {
  await mkdir(logDirectory, { recursive: true })
  await appendFile(
    path.join(logDirectory, 'launcher.log'),
    `${new Date().toISOString()} [runtime-capsule] ${runtimePreparationDiagnostic(prepared, preparationElapsed)}\n`,
    'utf8',
  )
} catch { /* diagnostics must never prevent the product from starting */ }
process.env.DSH_PORTABLE_RUNTIME_ROOT = prepared.runtimeRoot
process.argv = [process.execPath, path.join(root, 'launcher', entryName), ...forwarded]
const release = prepared.mode === 'capsule' ? await acquireRuntimeLease(prepared.runtimeRoot) : async () => {}
if (prepared.mode === 'capsule' && entryName === 'portable-host.mjs') {
  // Cleanup is delayed until the desktop has had ample time to become usable.
  // Current and live old runtimes are protected by their leases.
  setTimeout(() => { cleanUnusedRuntimeCaches(root).catch(() => {}) }, 60_000).unref()
}
try {
  await import(pathToFileURL(process.argv[1]).href)
} finally {
  await release()
}
