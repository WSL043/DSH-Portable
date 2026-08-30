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

const alphaSettingsSource = [
  '\t\tfunction displayPermissionPreset(value, name) {',
  '\t\tfunction PermissionRow({ load, select, usePermission, t }) {',
  '\t\t\tconst label = selected?.label ?? (busy ? t("loading") : t("unavailable"));',
  '\t\t\t\t\t\tlabel: option.label',
  '\t\t\t\tlabel: displayPermissionPreset(option.value, option.name),',
  '\t\t\t"unavailable": "不可用",',
  '\t\t\t"confirm.title": "确认启用 Full access？",',
  '\t\t\t"confirm.description": "启用 Full access 后，新会话",',
  '\t\t\t"confirm.enable": "启用 Full access"',
  '\t\t\t"confirm.title": "确认启用 Full access？",',
  '\t\t\t"confirm.description": "启用 Full access 后，agent",',
  '\t\t\t"confirm.enable": "启用 Full access"',
  '\t\t\t"unavailable": "Unavailable",',
].join('\n')

const alphaConversationSource = [
  '\t\tfunction optionLabel(option, t) {',
  '\t\t\treturn option.value === FULL_ACCESS ? t("access.fullLabel") : displayName(option.name);',
  '\t\t}',
  '\t\t\tcurrent === void 0 ? displayName(currentValue) : optionLabel(current, t)',
  '\t\t\tcurrent === void 0 ? displayName(currentValue) : optionLabel(current, t)',
  '\t\t\t"access.confirm.title": "确认启用 Full access？",',
  '\t\t\t"access.confirm.description": "启用 Full access 后，agent",',
  '\t\t\t"access.confirm.enable": "启用 Full access",',
  '\t\t\t"access.fullLabel": "Full access",',
  '\t\t\t"access.confirm.enable": "Enable Full access",',
  '\t\t\t"access.fullLabel": "Full access",',
].join('\n')

const nativeAlpha2SettingsSource = [
  '\t\t\t"preset.readOnly": "仅可查看",',
  '\t\t\t"preset.workspaceWrite": "可写入工作区",',
  '\t\t\t"preset.fullAccess": "完全权限",',
  '\t\tfunction displayPermissionPreset(value, name, t) {',
  '\t\t\tconst optionLabel = (option) => displayPermissionPreset(option.id, option.label, t);',
].join('\n')

const nativeAlpha2ConversationSource = [
  '\t\t\t"access.preset.readOnly": "仅可查看",',
  '\t\t\t"access.preset.workspaceWrite": "可写入工作区",',
  '\t\t\t"access.preset.fullAccess": "完全权限",',
  '\t\tfunction permissionLabel(value, name, t) {',
  '\t\t\t\tlabel: permissionLabel(option.value, option.name, t),',
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

test('alpha permission presentation seams remain localized and idempotent', () => {
  const settings = patchPermissionSettings(alphaSettingsSource)
  const conversation = patchConversationPermissions(alphaConversationSource)
  for (const output of [settings, conversation]) {
    assert.match(output, /工作区写入/)
    assert.match(output, /Workspace write/)
    assert.doesNotMatch(output, /确认启用 Full access/)
  }
  assert.match(settings, /permissionPresetLabel\(option\.value, displayPermissionPreset/)
  assert.match(conversation, /permissionModeLocaleKeys/)
  assert.equal(patchPermissionSettings(settings), settings)
  assert.equal(patchConversationPermissions(conversation), conversation)
})

test('official Alpha 2 native permission localization needs no Portable adapter', () => {
  assert.equal(patchPermissionSettings(nativeAlpha2SettingsSource), nativeAlpha2SettingsSource)
  assert.equal(patchConversationPermissions(nativeAlpha2ConversationSource), nativeAlpha2ConversationSource)
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
