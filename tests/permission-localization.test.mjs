import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  patchConversationPermissions,
  patchPermissionSettings,
} from '../scripts/patch-permission-localization.mjs'

const read = filename => readFile(new URL(`../${filename}`, import.meta.url), 'utf8')

const settingsSource = [
  '\t\tfunction PermissionRow({ load, select, usePermission, t }) {',
  '\t\t\tconst selected = state.options.find((option) => option.id === state.currentValue);',
  '\t\t\tconst busy = state.status === "loading" || state.status === "saving" || confirmingFullAccess;',
  '\t\t\tconst label = selected?.label ?? (busy ? t("loading") : t("unavailable"));',
  '\t\t\t\t\t\tlabel: option.label',
  '\t\t\t"unavailable": "不可用",',
  '\t\t\t"confirm.title": "确认启用 Full access？",',
  '\t\t\t"confirm.description": "启用 Full access 后，新会话将减少确认步骤。",',
  '\t\t\t"confirm.enable": "启用 Full access"',
  '\t\t\t"confirm.title": "确认启用 Full access？",',
  '\t\t\t"confirm.description": "启用 Full access 后，agent 将减少确认步骤。",',
  '\t\t\t"confirm.enable": "启用 Full access"',
  '\t\t\t"unavailable": "Unavailable",',
  '\t\t\t"confirm.title": "Enable Full access?",',
].join('\n')

const conversationSource = [
  '\t\tfunction optionLabel(option) {',
  '\t\t\treturn option.value === FULL_ACCESS ? "Full access" : displayName(option.name);',
  '\t\t}',
  '\t\t\t\t\tlabel: optionLabel(option),',
  '\t\t\t\t\t"aria-label": t("input.accessMode", { name: current === void 0 ? displayName(currentValue) : optionLabel(current) }),',
  '\t\t\t\t\t\t\tchildren: current === void 0 ? displayName(currentValue) : optionLabel(current)',
  '\t\t\t"access.confirm.title": "确认启用 Full access？",',
  '\t\t\t"access.confirm.description": "启用 Full access 后，agent 将减少确认步骤。",',
  '\t\t\t"access.confirm.enable": "启用 Full access",',
  '\t\t\t"access.confirm.title": "Enable Full access?",',
].join('\n')

test('known permission modes follow the active Chinese or English locale', () => {
  const settings = patchPermissionSettings(settingsSource)
  const conversation = patchConversationPermissions(conversationSource)

  for (const output of [settings, conversation]) {
    assert.match(output, /只读/)
    assert.match(output, /工作区写入/)
    assert.match(output, /完全访问/)
    assert.match(output, /Read only/)
    assert.match(output, /Workspace write/)
    assert.match(output, /Full access/)
  }
  assert.match(settings, /permissionPresetLabel\(selected\.id, selected\.label, t\)/)
  assert.match(conversation, /optionLabel\(option, t\)/)
  assert.doesNotMatch(settings, /确认启用 Full access/)
  assert.doesNotMatch(conversation, /确认启用 Full access/)
})

test('permission localization is guarded, idempotent, and part of every product build', async () => {
  const settings = patchPermissionSettings(settingsSource)
  const conversation = patchConversationPermissions(conversationSource)
  assert.equal(patchPermissionSettings(settings), settings)
  assert.equal(patchConversationPermissions(conversation), conversation)
  assert.throws(
    () => patchPermissionSettings(settingsSource.replace('label: option.label', 'label: changed.label')),
    /permission settings compatibility check failed/,
  )
  assert.throws(
    () => patchConversationPermissions(conversationSource.replace('label: optionLabel\(option\)', 'label: changedLabel\(option\)')),
    /conversation permission compatibility check failed/,
  )

  const [windows, macos, linux, verify, productSmoke] = await Promise.all([
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
    read('scripts/verify-runtime.mjs'),
    read('scripts/smoke-windows-tray-bridge.mjs'),
  ])
  assert.match(windows, /patch-permission-localization\.mjs/)
  assert.match(macos, /patch-permission-localization\.mjs/)
  assert.match(linux, /patch-permission-localization\.mjs/)
  assert.match(verify, /dsh-portable-permission-locale-v1/)
  assert.match(productSmoke, /permissionLabels/)
})
