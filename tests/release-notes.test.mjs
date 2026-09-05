import assert from 'node:assert/strict'
import test from 'node:test'
import { renderReleaseNotes, validateReleaseDescriptor } from '../scripts/render-release-notes.mjs'

const locale = { summary: 'A focused maintenance release.', highlights: ['Restore the previous plugin version after an unsuccessful update.'] }
const descriptor = { version: '0.7.0', zh: locale, en: locale }

test('optional release sections render evidence supplied for that release only', () => {
  const value = { ...descriptor, en: { ...locale, knownIssues: ['A documented proxy mode can prevent web requests.'], upgradeNotes: ['Exit the application before moving its data folder.'] } }
  const template = '{{RELEASE_KNOWN_ISSUES_ZH}}\n{{RELEASE_KNOWN_ISSUES_EN}}\n{{RELEASE_UPGRADE_NOTES_EN}}'
  const rendered = renderReleaseNotes(template, 'v0.7.0', '0.1.2-rc.1', value)
  assert.match(rendered, /### Known limitations\n\n- A documented proxy/)
  assert.match(rendered, /### Upgrade notes\n\n- Exit the application/)
  assert.doesNotMatch(rendered, /已知限制|\{\{/)
  assert.equal(renderReleaseNotes(template, 'v0.7.0', '0.1.2-rc.1', descriptor).trim(), '')
})

test('malformed optional release details fail validation instead of disappearing', () => {
  for (const knownIssues of ['not an array', [null], ['']]) {
    assert.throws(() => validateReleaseDescriptor({ ...descriptor, en: { ...locale, knownIssues } }, 'v0.7.0'), /knownIssues/)
  }
})

test('the historical RC to Alpha migration notice does not leak into future Alpha releases', () => {
  const template = '{{CHANNEL_UPGRADE_NOTICE_ZH}}\n{{CHANNEL_UPGRADE_NOTICE_EN}}'
  assert.match(renderReleaseNotes(template, 'v0.6.0-alpha.1', '0.1.2-alpha.5'), /historical RC/i)
  assert.doesNotMatch(renderReleaseNotes(template, 'v0.7.0-alpha.1', '0.1.2-alpha.5'), /0\.6\.0|historical RC|历史 RC/)
})
