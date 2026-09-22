import test from 'node:test'
import assert from 'node:assert/strict'
import { updateCompletion, updateCompletionLabel } from '../app/vendor/dsh-portable-plugin-market/src/client/update-completion.ts'

test('update completion follows server activation and does not invent a restart requirement', () => {
  for (const action of ['restart', 'refresh', 'none']) {
    assert.equal(updateCompletion({ activationAction: action }), action)
  }
  for (const action of [undefined, null, 'future-action', true]) {
    assert.equal(updateCompletion({ activationAction: action }), 'unknown')
  }
  assert.equal(updateCompletionLabel('none', true), '已更新')
  assert.equal(updateCompletionLabel('refresh', false), 'Reload page to apply')
  assert.equal(updateCompletionLabel('unknown', true), '已安装，生效状态待确认')
})
