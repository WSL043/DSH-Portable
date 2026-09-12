import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('./plugin/lib/client.js', import.meta.url), 'utf8')
let exports
vm.runInNewContext(source, { window: { __ModuleLoader__: { load(definition) { exports = definition.factory(() => ({})) } } }, File })
const limits = { mediaTypes: ['image/png'], maxImagesPerMessage: 2, maxImageBytes: 20, maxMessageImageBytes: 30 }
test('image limits are enforced before drafts are created', () => {
  let created = 0
  const service = { createDrafts() { created++; return [] }, releaseDraftAttachments() {}, resolveDraftAttachments() { return [] } }
  assert.throws(() => exports.addFilesToDraft(service, 's', { addAttachments() {} }, { phase: 'idle', attachmentIds: [] }, limits, [new File(['x'.repeat(21)], 'a.png', { type: 'image/png' })]), /limits/)
  assert.equal(created, 0)
})
test('failed admission releases every newly registered draft and does not submit', () => {
  const released = []
  const service = { createDrafts(id, files) { return files.map(file => ({ id: 'draft', file })) }, releaseDraftAttachments(items) { released.push(...items) }, resolveDraftAttachments() { return [] } }
  assert.throws(() => exports.addFilesToDraft(service, 's', { addAttachments() { return false }, submit() { throw Error('must not submit') } }, { phase: 'idle', attachmentIds: [] }, limits, [new File(['x'], 'a.png', { type: 'image/png' })]), /accept/)
  assert.equal(released.length, 1)
})
test('text-only attachment does not require image capability and never sends', () => {
  const service = { createDrafts(id) { assert.equal(id, 's'); return [{ id: 'draft' }] }, releaseDraftAttachments() { assert.fail('unexpected release') }, resolveDraftAttachments() { return [] } }
  let added
  exports.addFilesToDraft(service, 's', { addAttachments(ids) { added = [...ids]; return true } }, { phase: 'idle', attachmentIds: [] }, undefined, [new File(['text'], 'a.txt', { type: 'text/plain' })])
  assert.deepEqual(added, ['draft'])
})
