// Reuse the same integrity, atomic extraction, and cache locking as the DSH
// runtime. WebView2 has its own cache so DSH core updates cannot evict it.
import path from 'node:path'
import { prepareManagedWebView } from './webview-cache.mjs'
import { appendStartupTrace, traceFromEnvironment } from './startup-trace.mjs'

if (process.platform !== 'win32' || !process.env.LOCALAPPDATA || !process.argv[2]) {
  throw new Error('A Windows Portable root and LOCALAPPDATA are required.')
}
const root = path.resolve(process.argv[2])
const trace = traceFromEnvironment(path.join(process.env.DSH_PORTABLE_STATE_ROOT || root, 'data/logs'))
const started = performance.now()
const ownerPid = Number(process.argv[3])
const prepared = await prepareManagedWebView(root, ownerPid, {
  leaseOnly: process.argv[4] === '--lease-only',
  onProgress: (phase, fields) => appendStartupTrace(trace, 'webview-runtime', phase, fields),
})
appendStartupTrace(trace, 'webview-runtime', 'prepared', {reused:prepared.reused, preparationMs:Math.round(performance.now()-started)})
console.log(JSON.stringify({browserFolder:path.join(prepared.runtimeRoot, 'app'), reused:prepared.reused}))
