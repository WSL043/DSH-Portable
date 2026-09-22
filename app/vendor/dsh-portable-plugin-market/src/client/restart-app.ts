/** Shared by plugin cards and the catalog. A restart is complete only after a new boot. */
export async function restartApp(previousBoot?: string | null): Promise<void> {
  const pause = () => new Promise(resolve => setTimeout(resolve, 1500))
  const status = async () => {
    const response = await fetch('/dsh-market/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  previousBoot ??= (await status()).boot
  if (typeof previousBoot !== 'string' || !previousBoot) throw new Error('Cannot confirm the current application boot')
  try { sessionStorage.removeItem('dsh-portable-settings-view') } catch { /* storage unavailable */ }
  const portableRestart = window.__DSH_PORTABLE_HOST__?.restart
  if (typeof portableRestart === 'function') {
    try { await portableRestart() }
    catch (error) {
      if ((error as { code?: unknown })?.code !== 'DSH_PORTABLE_RESTART_UNCONFIRMED') throw error
      // The native host may close the old transport before its acknowledgement arrives.
    }
  } else {
    for (let attempt = 0; ; attempt++) {
      let response: Response
      try {
        response = await fetch('/dsh-market/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) })
      } catch { break } // Verify the new boot if the process exited mid-response.
      if (response.status === 409 && attempt < 10) { await pause(); continue }
      const body = await response.json()
      if (response.status !== 202 || body.ok !== true) throw new Error(body.error || `HTTP ${response.status}`)
      break
    }
  }
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    let next
    try { next = await status() } catch { /* restarting */ }
    if (typeof next?.boot === 'string' && next.boot !== previousBoot) {
      try { sessionStorage.removeItem('dsh-portable-settings-view') } catch { /* storage unavailable */ }
      location.reload()
      return
    }
    await pause()
  }
  throw new Error('Restart timed out; the new application boot could not be confirmed')
}
