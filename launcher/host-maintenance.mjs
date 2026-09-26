import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { cleanUnusedRuntimeCaches } from './runtime-capsule.mjs'
import { maintainPluginLogs } from './plugin-log-maintenance.mjs'
import { appendStartupTrace } from './startup-trace.mjs'

export function scheduleHostMaintenance({ root, runtimeRoot, stateRoot, trace }, {
  delayMs = 60000, intervalMs = 6 * 60 * 60000,
  cleanRuntime = cleanUnusedRuntimeCaches,
  cleanLogs = async () => {
    const requireRuntime = createRequire(path.join(runtimeRoot || root, 'app', 'package.json'))
    const { withFileLock } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-atomic-write')).href)
    return maintainPluginLogs(path.join(stateRoot || root, 'data', 'dsh-home'), withFileLock)
  },
  record = (component, phase, fields) => appendStartupTrace(trace, component, phase, fields),
} = {}) {
  let stopped = false
  let running = false
  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      try {
        const result = await cleanRuntime(root)
        const failed = result.retained.filter(entry => entry.reason === 'cleanup-failed')
        if (result.removed.length || failed.length) record('runtime-cache', 'maintenance-complete', {
          removed: result.removed.length,
          removedIncomplete: result.removed.filter(entry => entry.incomplete).length,
          reclaimedBytes: result.removed.reduce((sum, entry) => sum + entry.bytes, 0),
          retained: result.retained.length, failureCount: failed.length,
          failures: failed.slice(0, 8).map(({ hash, code }) => ({ hash, code })),
        })
      } catch (error) { record('runtime-cache', 'maintenance-failed', { code: error?.code || 'unknown' }) }
      if (stopped) return
      try {
        const result = await cleanLogs()
        if (result.removed || result.deferred || result.limited) record('plugin-logs', 'maintenance-complete', result)
      } catch (error) { record('plugin-logs', 'maintenance-deferred', { code: error?.code || 'unsupported' }) }
    } finally { running = false }
  }
  const first = setTimeout(run, delayMs)
  const periodic = setInterval(run, intervalMs)
  first.unref()
  periodic.unref()
  return () => { stopped = true; clearTimeout(first); clearInterval(periodic) }
}
