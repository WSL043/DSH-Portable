// Native timestamps survive navigation; performance.now() starts over for each
// document. The post-deadline observation window never extends the ready budget.
export function assessStartupHandoff({ samples, trace, pid, deadline }) {
  const ready = trace.find(entry => entry.pid === pid && entry.phase === 'interactive-ready')
  if (!ready) return { reason: 'native-handoff-missing' }
  const readyAt = Date.parse(ready.timestamp)
  if (!Number.isFinite(readyAt)) return { reason: 'native-ready-timestamp-invalid', ready }
  if (readyAt > deadline) return { reason: 'native-startup-budget-exceeded', ready, overdueMs: readyAt - deadline }
  const usable = sample => sample.observedAt >= readyAt && !sample.bootVisible
    && sample.bodyText.length > 0 && sample.visibleControls >= 2
  let consecutive = 0
  let revealSample
  for (const sample of samples) {
    if (!usable(sample)) { consecutive = 0; revealSample = undefined; continue }
    revealSample ??= sample
    if (++consecutive >= 8) return { reason: 'ready', ready, revealSample, workspaceSample: sample }
  }
  return { reason: 'workspace-not-stable-after-handoff', ready }
}
