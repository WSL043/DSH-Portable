import path from 'node:path'
import { lstat, readFile, realpath, rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeDataFileAtomic } from './data-paths.mjs'
import { acquireRuntimeLease, ensureRuntimeCapsule, cleanUnusedRuntimeCaches } from './runtime-capsule.mjs'

const marker = '.webview-managed-v1.json'
const execFileAsync = promisify(execFile)
async function inspectWebViewProcesses() {
  if (process.platform !== 'win32') return []
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 4000, maxBuffer: 1024 * 1024 })
  const value = JSON.parse(stdout.trim() || '[]')
  return Array.isArray(value) ? value : [value]
}
export function webViewCacheEnvironment(env = process.env) {
  if (!env.LOCALAPPDATA && !env.DSH_PORTABLE_WEBVIEW_CACHE) throw new Error('WebView cache location is unavailable.')
  // Legacy clients never acquire leases: they must never share this GC domain.
  const base = env.DSH_PORTABLE_WEBVIEW_CACHE || path.join(env.LOCALAPPDATA, 'DSH-Portable', 'webview2-cache')
  return { ...env, DSH_PORTABLE_RUNTIME_CACHE: path.resolve(base, 'managed-v1') }
}

export async function prepareManagedWebView(root, ownerPid, { env = process.env, leaseOnly = false, onProgress } = {}) {
  const source = path.join(root, 'runtime/webview2')
  const manifest = JSON.parse(await readFile(path.join(source, 'runtime-capsule.json'), 'utf8'))
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid WebView capsule identity.')
  const cacheEnv = webViewCacheEnvironment(env)
  const target = path.join(cacheEnv.DSH_PORTABLE_RUNTIME_CACHE, manifest.sha256)
  // Protect before extraction, including the gap before native EnsureCoreWebView.
  // PID reuse can only retain too long; unknown liveness also remains protected.
  const release = await acquireRuntimeLease(target, { ownerPid })
  try {
    if (leaseOnly) {
      const identity = JSON.parse(await readFile(path.join(target, marker), 'utf8'))
      if (identity.sha256 !== manifest.sha256 || identity.schemaVersion !== 1) throw new Error('Unmanaged WebView runtime.')
      return { runtimeRoot: target, reused: true }
    }
    const reservation = target + marker
    await writeDataFileAtomic(reservation, Buffer.from(JSON.stringify({ schemaVersion: 1, sha256: manifest.sha256 })))
    const prepared = await ensureRuntimeCapsule(source, { env: cacheEnv, onProgress })
    // The external reservation survives a crash between extraction and marker
    // commit. Move it inside atomically; a concurrent preparer may do this first.
    try { await rename(reservation, path.join(target, marker)) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      const committed = JSON.parse(await readFile(path.join(target, marker), 'utf8'))
      if (committed.schemaVersion !== 1 || committed.sha256 !== manifest.sha256) throw error
    }
    return prepared
  } catch (error) { await release(); throw error }
  // On success the lease deliberately outlives this short-lived Node helper.
  // Collection reaps it only after the real native/browser PID no longer exists.
}

export async function cleanWebViewCaches(root, { env = process.env, inspectProcesses = inspectWebViewProcesses, ...options } = {}) {
  const source = path.join(root, 'runtime/webview2')
  try { await lstat(path.join(source, 'runtime-capsule.json')) }
  catch (error) { if (error.code === 'ENOENT') return { removed: [], retained: [] }; throw error }
  return cleanUnusedRuntimeCaches(source, {
    ...options, env: webViewCacheEnvironment(env),
    acceptTarget: async (target, identity) => {
      if (identity.incomplete) return true // own extractor PID and grace checks already passed
      try {
        let ownership = path.join(target, marker)
        try { await lstat(ownership) } catch (error) { if (error.code !== 'ENOENT') throw error; ownership = target + marker }
        const info = await lstat(ownership)
        if (!info.isFile() || info.isSymbolicLink()) return false
        const record = JSON.parse(await readFile(ownership, 'utf8'))
        const readyInfo = await lstat(path.join(target, '.dsh-runtime-ready.json'))
        if (!readyInfo.isFile() || readyInfo.isSymbolicLink()) return false
        const ready = JSON.parse(await readFile(path.join(target, '.dsh-runtime-ready.json'), 'utf8'))
        if (record.schemaVersion !== 1 || record.sha256 !== identity.hash || ready.sha256 !== identity.hash) return false
        // Under the GC lock, cover a native crash before browser PID registration.
        // Unreadable process paths make this pass conservative, never destructive.
        const processes = await inspectProcesses()
        if (!Array.isArray(processes)) return false
        const canonical = value => value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').toLowerCase()
        const subtree = canonical(await realpath(target)) + path.sep
        for (const item of processes) {
          if (typeof item?.ExecutablePath !== 'string' || !path.isAbsolute(item.ExecutablePath)) return false
          const executable = canonical(await realpath(item.ExecutablePath))
          if (executable.startsWith(subtree)) return false
        }
        if (ownership !== path.join(target, marker)) await rename(ownership, path.join(target, marker))
        return true
      } catch { return false }
    },
  })
}
