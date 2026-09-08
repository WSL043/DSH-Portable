import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeStartupRun } from '../launcher/startup-summary.mjs'

const startupId = 'a'.repeat(32)
const otherStartupId = 'b'.repeat(32)
const line = (event, id = startupId) => JSON.stringify({ startupId: id, ...event })

test('startup summary reduces a successful run to allowlisted evidence', () => {
  const summary = summarizeStartupRun(startupId, {
    'startup.jsonl': [
      line({ timestamp: '2026-09-08T07:00:01.000Z', component: 'runtime-entry', phase: 'runtime-capsule-ready', mode: 'capsule', reused: false, elapsedMsRuntime: 4188 }),
      line({ timestamp: '2026-09-08T07:00:02.000Z', component: 'portable-host', phase: 'official-dsh-entry-ready', durationMs: 1214 }),
      line({ timestamp: '2026-09-08T07:00:03.000Z', component: 'native-host', phase: 'interactive-ready', elapsedMs: 2224 }),
      line({ timestamp: '2026-09-08T07:00:04.000Z', component: 'portable-host', phase: 'process-exit', exitCode: 0 }),
      line({ timestamp: '2026-09-08T07:00:05.000Z', component: 'portable-cli', phase: 'component-versions', portableVersion: '0.6.4', dshVersion: '0.1.2-alpha.5', nodeVersion: '22.14.0', releaseChannel: 'stable' }),
      line({ timestamp: '2026-09-08T07:00:06.000Z', component: 'portable-cli', phase: 'default-plugin-version', name: 'dsh-image-viewer', version: '0.1.0-beta.9' }),
      line({ timestamp: '2026-09-08T07:00:07.000Z', component: 'portable-cli', phase: 'default-plugin-version', name: 'dsh-chat-manager', version: '1.3.1' }),
    ].join('\n') + '\n',
    'runtime-health.jsonl': [
      line({ timestamp: '2026-09-08T07:00:03.500Z', component: 'portable-host', phase: 'official-dsh-import-complete', observation: 'startup-profile', durationMs: 1400, mainHeartbeatAgeMs: 6200, startupProgress: { operation: 'load', elapsedMs: 900 } }),
      line({ timestamp: '2026-09-08T07:00:08.500Z', component: 'native-host', phase: 'running', uiHeartbeatAgeMs: 8400 }),
    ].join('\n') + '\n',
  })

  assert.equal(summary.readinessObserved, true)
  assert.equal(summary.failureObserved, false)
  assert.equal(summary.hostProcessExitCode, 0)
  assert.equal(summary.importDurationMs, 1214)
  assert.equal(summary.capsuleDurationMs, 4188)
  assert.equal(summary.capsuleReused, false)
  assert.equal(summary.interactiveElapsedMs, 2224)
  assert.equal(summary.maxHeartbeatAgeMs, 8400)
  assert.equal(summary.startupProfilePresent, true)
  assert.equal(summary.startupCheckpointPresent, true)
  assert.deepEqual(summary.versions, {
    portableVersion: '0.6.4',
    dshVersion: '0.1.2-alpha.5',
    nodeVersion: '22.14.0',
    releaseChannel: 'stable',
    defaultPlugins: { 'dsh-image-viewer': '0.1.0-beta.9', 'dsh-chat-manager': '1.3.1' },
  })
  assert.equal(summary.lastComponent, 'native-host')
  assert.equal(summary.lastPhase, 'running')
  assert.equal(summary.incompleteEvidence, false)
  assert.deepEqual(Object.keys(summary).sort(), [
    'capsuleDurationMs', 'capsuleReused', 'failureObserved', 'hostProcessExitCode',
    'importDurationMs', 'incompleteEvidence', 'interactiveElapsedMs', 'lastComponent',
    'lastPhase', 'maxHeartbeatAgeMs', 'readinessObserved', 'startupCheckpointPresent',
    'startupProfilePresent', 'versions',
  ].sort())
})

test('startup summary reports observed failure and keeps an unrecorded exit distinct from a crash', () => {
  const summary = summarizeStartupRun(startupId, {
    'startup.jsonl': [
      line({ timestamp: '2026-09-08T07:01:01.000Z', component: 'portable-host', phase: 'official-dsh-import-failed' }),
      line({ timestamp: '2026-09-08T07:01:02.000Z', component: 'native-host', phase: 'startup-failed', exitCode: 9 }),
    ].join('\n'),
  })
  assert.equal(summary.readinessObserved, false)
  assert.equal(summary.failureObserved, true)
  assert.equal(summary.hostProcessExitCode, 'not-recorded')
  assert.equal(summary.startupProfilePresent, false)
})

test('malformed and bounded tails preserve valid observations while marking incomplete evidence', () => {
  const summary = summarizeStartupRun(startupId, {
    'startup.jsonl': {
      value: `${line({ component: 'native-host', phase: 'interactive-ready', elapsedMs: 77 })}\nnot-json\n[earlier log omitted]\n`,
      truncated: true,
    },
  })
  assert.equal(summary.readinessObserved, true)
  assert.equal(summary.interactiveElapsedMs, 77)
  assert.equal(summary.incompleteEvidence, true)
})

test('mixed startup IDs are ignored and rotated streams are reduced in timestamp order', () => {
  const summary = summarizeStartupRun(startupId, {
    // Deliberately enumerate the current stream first. The older stream must
    // not overwrite its later last-known phase or exit code.
    'startup.jsonl': [
      line({ timestamp: '2026-09-08T07:02:03.000Z', component: 'native-host', phase: 'interactive-ready', elapsedMs: 303 }),
      line({ timestamp: '2026-09-08T07:02:04.000Z', component: 'portable-host', phase: 'process-exit', exitCode: 3 }),
    ].join('\n'),
    'startup.jsonl.previous': [
      line({ timestamp: '2026-09-08T07:02:01.000Z', component: 'native-host', phase: 'process-start' }),
      line({ timestamp: '2026-09-08T07:02:05.000Z', component: 'native-host', phase: 'startup-failed' }, otherStartupId),
    ].join('\n'),
  })
  assert.equal(summary.readinessObserved, true)
  assert.equal(summary.failureObserved, false)
  assert.equal(summary.hostProcessExitCode, 3)
  assert.equal(summary.lastComponent, 'portable-host')
  assert.equal(summary.lastPhase, 'process-exit')
})
