import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assertPublishReadiness } from '../scripts/assert-publish-readiness.mjs'

const commit = 'a'.repeat(40)
const previewLock = { dsh: { version: '0.1.7-rc.1', reviewedCommit: commit } }
const passed = {
  schemaVersion: 1,
  dshReviewedCommit: commit,
  historicalSessionMigration: { status: 'passed', evidence: 'documented historical-data acceptance' },
}

test('candidate publication requires historical-session evidence for its exact DSH commit', () => {
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5-alpha.1', previewLock, readiness: {
    ...passed,
    historicalSessionMigration: { status: 'blocked', evidence: null, reason: 'known upstream refusal' },
  } }), /historical-session migration/)
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5-alpha.1', previewLock, readiness: {
    ...passed,
    dshReviewedCommit: 'b'.repeat(40),
  } }), /exact reviewed core commit/)
  assert.doesNotThrow(() => assertPublishReadiness({ productVersion: '0.7.5-alpha.1', previewLock, readiness: passed }))
  assert.doesNotThrow(() => assertPublishReadiness({ productVersion: '0.7.5', previewLock, readiness: null }))
})

test('publish workflow checks candidate readiness before creating a release', async () => {
  const workflow = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
  assert.ok(workflow.indexOf('scripts/assert-publish-readiness.mjs') > workflow.indexOf('scripts/version-policy.mjs'))
  assert.ok(workflow.indexOf('scripts/assert-publish-readiness.mjs') < workflow.indexOf('gh release create'))
})
