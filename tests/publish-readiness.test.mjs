import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assertPublishReadiness } from '../scripts/assert-publish-readiness.mjs'
import { descriptorV2PatchIdentity } from '../scripts/patch-historical-descriptor.mjs'

const commit = 'a'.repeat(40)
const integrity = 'sha512-' + 'a'.repeat(86) + '=='
const previewLock = { dsh: { version: '0.1.7-rc.1', reviewedCommit: commit, npmIntegrity: integrity } }
const stableLock = { dsh: { version: '0.1.7-alpha.1', reviewedCommit: commit, integrity }, defaultPlugins: {
  imageViewer: { package: 'dsh-image-viewer', version: '0.1.2', releaseChannel: 'stable' },
  chatManager: { package: 'dsh-chat-manager', version: '1.5.1', releaseChannel: 'stable' },
} }
const passed = {
  schemaVersion: 1,
  dshReviewedCommit: commit,
  dshNpmIntegrity: integrity,
  historicalSessionMigration: { status: 'passed', evidence: 'documented historical-data acceptance', compatibilityPatch: descriptorV2PatchIdentity },
}

test('1.0.0 alpha cannot use Native publication even with passing core acceptance', () => {
  for (const productVersion of ['1.0.0-alpha.1', '1.0.0-alpha.199']) {
    assert.throws(() => assertPublishReadiness({ productVersion, previewLock, readiness: passed }), /separate clean-install qualification/)
  }
})

test('candidate publication requires historical-session evidence for its exact DSH commit', () => {
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5-alpha.1', previewLock, readiness: {
    ...passed,
    historicalSessionMigration: { status: 'blocked', evidence: null, reason: 'known upstream refusal' },
  } }), /historical-session migration/)
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5-alpha.1', previewLock, readiness: {
    ...passed,
    dshReviewedCommit: 'b'.repeat(40),
  } }), /exact reviewed core commit/)
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5-alpha.1', previewLock, readiness: {
    ...passed,
    dshNpmIntegrity: 'sha512-' + 'b'.repeat(86) + '==',
  } }), /exact reviewed core commit and package/)
  assert.doesNotThrow(() => assertPublishReadiness({ productVersion: '0.7.5-alpha.1', previewLock, readiness: passed }))
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5', stableLock, readiness: null }), /historical-session migration/)
  assert.doesNotThrow(() => assertPublishReadiness({ productVersion: '0.7.5', stableLock, readiness: passed }))
})

test('stable Portable never publishes a beta default plugin', () => {
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5', stableLock: {
    defaultPlugins: { ...stableLock.defaultPlugins, imageViewer: { package: 'dsh-image-viewer', version: '0.1.3-beta.3', releaseChannel: 'prerelease' } },
  } }), /reviewed stable versions/)
  assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5', stableLock: { defaultPlugins: {} } }), /reviewed stable versions/)
})

test('stable migration evidence cannot hide a missing or altered compatibility patch', () => {
  for (const compatibilityPatch of [undefined, { ...descriptorV2PatchIdentity, patchedSha256: '0'.repeat(64) }]) {
    assert.throws(() => assertPublishReadiness({ productVersion: '0.7.5', stableLock, readiness: {
      ...passed, historicalSessionMigration: { ...passed.historicalSessionMigration, compatibilityPatch },
    } }), /exact reviewed compatibility patch/)
  }
})

test('publish workflow checks candidate readiness before creating a release', async () => {
  const workflow = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
  assert.ok(workflow.indexOf('scripts/assert-publish-readiness.mjs') > workflow.indexOf('scripts/version-policy.mjs'))
  assert.ok(workflow.indexOf('scripts/assert-publish-readiness.mjs') < workflow.indexOf('gh release create'))
})
