import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  classifyPortableError,
  portablePublicError,
  recordPortableDiagnostic,
  redactDiagnosticText,
} from '../launcher/diagnostic-policy.mjs'

test('diagnostic policy redacts credential-like keys and loopback authentication URLs', () => {
  const source = [
    'controlToken=control-secret',
    '{"workspaceAuthToken":"workspace-secret","cookie":"cookie-secret"}',
    'Authorization: Bearer bearer-secret',
    'dsh web: http://127.0.0.1:3080/?token=url-secret&view=home',
    'normal diagnostic',
  ].join('\n')
  const redacted = redactDiagnosticText(source)
  assert.match(redacted, /normal diagnostic/)
  assert.doesNotMatch(redacted, /control-secret|workspace-secret|cookie-secret|bearer-secret|url-secret/)
  assert.match(redacted, /\[REDACTED\]/)
})

test('rolled-back update failures have a stable machine-readable code', () => {
  assert.equal(classifyPortableError(new Error('Update failed and was rolled back: boot failed\nThe previous version was restored and restarted.')), 'UPDATE_ROLLED_BACK')
  assert.equal(classifyPortableError(new Error('The previous version was restored but could not restart: boot failed')), 'UPDATE_RECOVERY_FAILED')
  assert.equal(classifyPortableError(new Error('Another portable launcher is already starting or stopping DSH.')), 'LAUNCH_IN_PROGRESS')
  assert.equal(classifyPortableError(new Error('Close the other Portable environment before changing shared components: research.')), 'SHARED_COMPONENTS_BUSY')
  const incompatible = Object.assign(new Error('profile web failed'), { code: 'DSH_PROFILE_PREFLIGHT_FAILED' })
  assert.equal(classifyPortableError(incompatible), 'DSH_PROFILE_COMPATIBILITY_FAILED')
  assert.match(portablePublicError(incompatible).message, /installed version was not changed/i)
  const importFailure = Object.assign(new Error('profile web failed'), { code: 'DSH_DATA_IMPORT_PROFILE_FAILED' })
  assert.equal(classifyPortableError(importFailure), 'DATA_IMPORT_ROLLED_BACK')
  assert.match(portablePublicError(importFailure).message, /data package was not applied.*previous data was restored/i)
})

test('full diagnostics are stored redacted and bounded outside the user-facing error', async (t) => {
  const logsDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-diagnostic-policy-'))
  t.after(() => rm(logsDir, { recursive: true, force: true }))
  await recordPortableDiagnostic(logsDir, {
    operation: 'update',
    error: new Error('failed http://127.0.0.1:3080/?token=private-token'),
  })
  const source = await readFile(path.join(logsDir, 'portable-errors.jsonl'), 'utf8')
  assert.match(source, /UPDATE_FAILED|update/)
  assert.doesNotMatch(source, /private-token/)
  assert.ok(Buffer.byteLength(source) < 256 * 1024)
})
