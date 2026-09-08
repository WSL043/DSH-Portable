import { redactDiagnosticText } from './diagnostic-policy.mjs'

const NOT_RECORDED = 'not-recorded'
const MAX_COMPONENT_LENGTH = 80
const MAX_PHASE_LENGTH = 100
const TRUNCATION_MARKER = /\[(?:earlier\s+log\s+omitted|(?:log|history|tail|line)?\s*(?:truncated|partial|incomplete)(?:\s+(?:log|line|tail|history))?)\]/i

function shortText(value, maxLength) {
  if (typeof value !== 'string' || value.length === 0) return ''
  return redactDiagnosticText(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

function sourceValue(source) {
  if (typeof source === 'string') return { value: source, truncated: false }
  if (source && typeof source === 'object' && typeof source.value === 'string') {
    return { value: source.value, truncated: source.truncated === true }
  }
  return { value: '', truncated: false }
}

function timestampValue(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) ? timestamp : null
}

/** Reduce bounded JSONL startup and health tails without performing I/O. */
export function summarizeStartupRun(startupId, logStrings = {}) {
  const expectedId = String(startupId ?? '').toLowerCase()
  const summary = {
    readinessObserved: false,
    failureObserved: false,
    hostProcessExitCode: NOT_RECORDED,
    importDurationMs: NOT_RECORDED,
    capsuleDurationMs: NOT_RECORDED,
    capsuleReused: NOT_RECORDED,
    interactiveElapsedMs: NOT_RECORDED,
    maxHeartbeatAgeMs: NOT_RECORDED,
    versions: {
      portableVersion: NOT_RECORDED,
      dshVersion: NOT_RECORDED,
      nodeVersion: NOT_RECORDED,
      releaseChannel: NOT_RECORDED,
      defaultPlugins: {
        'dsh-image-viewer': NOT_RECORDED,
        'dsh-chat-manager': NOT_RECORDED,
      },
    },
    startupProfilePresent: false,
    startupCheckpointPresent: false,
    lastComponent: NOT_RECORDED,
    lastPhase: NOT_RECORDED,
    incompleteEvidence: false,
  }
  const entries = logStrings && typeof logStrings === 'object' && !Array.isArray(logStrings)
    ? Object.entries(logStrings).sort(([left], [right]) => {
      const leftPrevious = left.endsWith('.previous')
      const rightPrevious = right.endsWith('.previous')
      return Number(rightPrevious) - Number(leftPrevious)
    })
    : []
  const events = []
  let sequence = 0
  for (const [, source] of entries) {
    const { value, truncated } = sourceValue(source)
    if (truncated || TRUNCATION_MARKER.test(value)) summary.incompleteEvidence = true
    if (value === '') continue
    for (const rawLine of value.split(/\r?\n/)) {
      if (rawLine.trim() === '') continue
      const line = rawLine.replace(/^\uFEFF/, '')
      if (TRUNCATION_MARKER.test(line)) {
        summary.incompleteEvidence = true
        continue
      }
      let event
      try { event = JSON.parse(line) } catch {
        summary.incompleteEvidence = true
        continue
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        summary.incompleteEvidence = true
        continue
      }
      if (typeof event.startupId !== 'string' || event.startupId.toLowerCase() !== expectedId) continue
      const timestamp = timestampValue(event.timestamp)
      if (timestamp === null) summary.incompleteEvidence = true
      events.push({ event, sequence: sequence++, timestamp })
    }
  }
  events.sort((left, right) => (left.timestamp ?? -Infinity) - (right.timestamp ?? -Infinity)
    || left.sequence - right.sequence)

  for (const { event } of events) {
    const component = shortText(event.component, MAX_COMPONENT_LENGTH)
    const phase = shortText(event.phase, MAX_PHASE_LENGTH)
    if (component) summary.lastComponent = component
    if (phase) summary.lastPhase = phase
    if (phase === 'interactive-ready') summary.readinessObserved = true
    if (phase === 'startup-failed' || phase === 'official-dsh-import-failed'
      || (phase === 'failed' && component === 'portable-cli')) summary.failureObserved = true
    if (phase === 'component-version-snapshot-incomplete') summary.incompleteEvidence = true
    if (phase === 'process-exit' && component === 'portable-host') {
      const exitCode = numberValue(event.exitCode)
      if (exitCode !== null) summary.hostProcessExitCode = exitCode
    }
    if (phase === 'official-dsh-entry-ready' || phase === 'official-dsh-import-complete') {
      const durationMs = numberValue(event.durationMs)
      if (durationMs !== null && (phase === 'official-dsh-entry-ready' || summary.importDurationMs === NOT_RECORDED)) {
        summary.importDurationMs = durationMs
      }
    }
    if (phase === 'runtime-capsule-ready') {
      if (event.mode === 'capsule' && typeof event.reused === 'boolean') summary.capsuleReused = event.reused
      const durationMs = numberValue(event.elapsedMsRuntime)
      if (durationMs !== null) summary.capsuleDurationMs = durationMs
    }
    if (phase === 'component-versions') {
      for (const field of ['portableVersion', 'dshVersion', 'nodeVersion', 'releaseChannel']) {
        const value = shortText(event[field], 100)
        if (value) summary.versions[field] = value
      }
    }
    if (phase === 'default-plugin-version'
      && (event.name === 'dsh-image-viewer' || event.name === 'dsh-chat-manager')) {
      const value = shortText(event.version, 100)
      if (value) summary.versions.defaultPlugins[event.name] = value
    }
    if (phase === 'interactive-ready') {
      const elapsedMs = numberValue(event.elapsedMs)
      if (elapsedMs !== null) summary.interactiveElapsedMs = elapsedMs
    }
    for (const field of ['mainHeartbeatAgeMs', 'uiHeartbeatAgeMs']) {
      const ageMs = numberValue(event[field])
      if (ageMs !== null) summary.maxHeartbeatAgeMs = summary.maxHeartbeatAgeMs === NOT_RECORDED
        ? ageMs : Math.max(summary.maxHeartbeatAgeMs, ageMs)
    }
    if (event.observation === 'startup-profile') summary.startupProfilePresent = true
    if (event.startupProgress && typeof event.startupProgress === 'object'
      && !Array.isArray(event.startupProgress)) summary.startupCheckpointPresent = true
  }
  return summary
}
