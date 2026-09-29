import { cleanUnusedRuntimeCaches } from './runtime-capsule.mjs'
import { cleanProfileLogs } from './storage-maintenance.mjs'
import { appendStartupTrace } from './startup-trace.mjs'

export function scheduleHostMaintenance({ root, runtimeRoot, stateRoot, trace }, {
  delayMs = 60000, intervalMs = 6 * 60 * 60000,
  cleanRuntime = cleanUnusedRuntimeCaches,
  cleanUpdateOperations = async () => ({ removed: [], deferred: false }),
  cleanLogs = options => cleanProfileLogs({ root, runtimeRoot, stateRoot }, options),
  record = (component, phase, fields) => appendStartupTrace(trace, component, phase, fields),
} = {}) {
  let stopped = false
  let running = false
  const controller = new AbortController()
  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      try {
        const result = await cleanRuntime(root, { signal: controller.signal, budgetMs: 1000, maxEntries: 100000, measure: false })
        const failed = result.retained.filter(entry => entry.reason === 'cleanup-failed')
        if (result.removed.length || failed.length || result.limited) record('runtime-cache', 'maintenance-complete', {
          removed: result.removed.length,
          removedIncomplete: result.removed.filter(entry => entry.incomplete).length,
          reclaimedBytes: result.removed.every(entry => Number.isFinite(entry.bytes))
            ? result.removed.reduce((sum, entry) => sum + entry.bytes, 0) : null,
          retained: result.retained.length, failureCount: failed.length,
          ...(result.limited ? { limited: true } : {}),
          failures: failed.slice(0, 8).map(({ hash, code }) => ({ hash, code })),
        })
      } catch (error) { record('runtime-cache', 'maintenance-failed', { code: error?.code || 'unknown' }) }
      if (stopped) return
      try {
        const result = await cleanUpdateOperations({ signal: controller.signal })
        if (result.removed?.length || result.deferred) record('update-operations', 'maintenance-complete', {
          removed: result.removed?.length || 0,
          ...(result.deferred ? { deferred: true, reason: result.reason || 'busy-or-unsafe' } : {}),
        })
      } catch (error) { record('update-operations', 'maintenance-deferred', { code: error?.code || 'unknown' }) }
      if (stopped) return
      try {
        const result = await cleanLogs({ signal: controller.signal })
        if (result.removed || result.deferred || result.limited) record('plugin-logs', 'maintenance-complete', result)
      } catch (error) { record('plugin-logs', 'maintenance-deferred', { code: error?.code || 'unsupported' }) }
    } finally { running = false }
  }
  const first = setTimeout(run, delayMs)
  const periodic = setInterval(run, intervalMs)
  first.unref()
  periodic.unref()
  return () => { stopped = true; controller.abort(); clearTimeout(first); clearInterval(periodic) }
}
