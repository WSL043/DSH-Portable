import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPermissionLocalization } from '../scripts/patch-permission-localization.mjs'

const settings = [
  '"preset.readOnly":', '"preset.workspaceWrite":', '"preset.fullAccess":',
  'function displayPermissionPreset(value, name, t)',
  'displayPermissionPreset(option.id, option.label, t)',
].join('\n')
const permissionLabels = 'function permissionLabel(value, name, t)\npermissionLabel(option.value, option.name, t)'
const conversation = [
  '"access.preset.readOnly":', '"access.preset.workspaceWrite":', '"access.preset.fullAccess":', permissionLabels,
].join('\n')

test('official permission localization needs translated settings and conversation controls', () => {
  verifyPermissionLocalization(settings, conversation)
  assert.throws(() => verifyPermissionLocalization(settings.replace('option.label, t', 'option.label'), conversation), /settings localization/)
  assert.throws(() => verifyPermissionLocalization(settings, conversation.replace('option.name, t', 'option.name')), /conversation permission localization/)
})

test('official preset slot supplies localization only when both ends are wired', () => {
  const presets = settings + '\n' + permissionLabels + '\nctx.slots.inject("conversation.input.permission"'
  const slot = 'renderSlot("conversation.input.permission", { locked })'
  verifyPermissionLocalization(presets, slot)
  assert.throws(() => verifyPermissionLocalization(settings, slot), /conversation permission localization/)
  assert.throws(() => verifyPermissionLocalization(presets, ''), /conversation permission localization/)
})
