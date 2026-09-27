import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { cleanUnusedRuntimeCaches } from './runtime-capsule.mjs'
import { maintainPluginLogs } from './plugin-log-maintenance.mjs'
import { cleanWebViewCaches } from './webview-cache.mjs'

export async function cleanProfileLogs({ root, runtimeRoot, stateRoot }, options) {
  const requireRuntime = createRequire(path.join(runtimeRoot || root, 'app', 'package.json'))
  const { withFileLock } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-atomic-write')).href)
  return maintainPluginLogs(path.join(stateRoot || root, 'data', 'dsh-home'), withFileLock, options)
}

// The explicit user action uses the same age, owner and lock protections as
// background maintenance. Never prune dependencies or delete recovery material.
export async function cleanRetainedStorage(context, {
  signal, cleanRuntime = cleanUnusedRuntimeCaches, cleanLogs = cleanProfileLogs, cleanWebView = cleanWebViewCaches,
} = {}) {
  const result = { schemaVersion: 1, complete: true, runtimes: 0, webviews: 0, logs: 0, deferred: 0, limited: false, failures: [] }
  try {
    const runtime = await cleanRuntime(context.root, { signal, budgetMs: 3000, maxEntries: 100000, measure: false })
    result.runtimes = runtime.removed.length
    result.deferred += runtime.retained.filter(item => ['busy', 'preparing', 'active', 'cleanup-failed', 'incomplete-recent-or-active'].includes(item.reason)).length
    result.limited ||= Boolean(runtime.limited || runtime.cancelled)
    for (const item of runtime.retained.filter(item => item.reason === 'cleanup-failed')) {
      if (result.failures.length < 8) result.failures.push({ component: 'runtime', code: item.code || 'unknown' })
    }
  } catch (error) {
    result.failures.push({ component: 'runtime', code: error?.code || 'unknown' })
  }
  if (signal?.aborted) result.limited = true
  else {
    try {
      const browser = await cleanWebView(context.root, { signal, budgetMs: 3000, maxEntries: 100000, measure: false })
      result.webviews = browser.removed.length
      result.deferred += browser.retained.filter(item => item.reason !== 'current').length
      result.limited ||= Boolean(browser.limited || browser.cancelled)
      for (const item of browser.retained.filter(item => item.reason === 'cleanup-failed').slice(0, 8))
        result.failures.push({ component: 'webview', code: item.code || 'unknown' })
    } catch (error) { result.failures.push({ component: 'webview', code: error?.code || 'unavailable' }) }
  }
  if (!signal?.aborted) {
    try {
      const logs = await cleanLogs(context, { signal, budgetMs: 3000 })
      result.logs = logs.removed
      result.deferred += logs.deferred
      result.limited ||= Boolean(logs.limited || logs.cancelled)
    } catch (error) {
      result.failures.push({ component: 'logs', code: error?.code || 'unavailable' })
    }
  }
  result.complete = !result.limited && result.deferred === 0 && result.failures.length === 0
  return result
}
