import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'dsh-portable-permission-locale-v1'

function replaceRequired(source, needle, replacement, label, expected = 1) {
  const matches = source.split(needle).length - 1
  if (matches !== expected) {
    throw new Error(`${label}: expected ${expected} match${expected === 1 ? '' : 'es'}, found ${matches}`)
  }
  return source.replaceAll(needle, replacement)
}

export function patchPermissionSettings(input) {
  if (input.includes(MARKER)) return input

  if (input.includes('\t\tfunction displayPermissionPreset(value, name) {')) {
    let output = replaceRequired(
      input,
      '\t\tfunction PermissionRow({ load, select, usePermission, t }) {',
      `\t\t/* ${MARKER} */\n` +
        '\t\tconst permissionPresetLocaleKeys = {\n' +
        '\t\t\t"read-only": "preset.readOnly",\n' +
        '\t\t\t"workspace-write": "preset.workspaceWrite",\n' +
        '\t\t\t"danger-full-access": "preset.fullAccess"\n' +
        '\t\t};\n' +
        '\t\tfunction permissionPresetLabel(value, fallback, t) {\n' +
        '\t\t\tconst key = permissionPresetLocaleKeys[value];\n' +
        '\t\t\treturn key === void 0 ? fallback : t(key);\n' +
        '\t\t}\n' +
        '\t\tfunction PermissionRow({ load, select, usePermission, t }) {',
      'permission settings compatibility check failed (alpha presentation seam)',
    )
    output = replaceRequired(output, '\t\t\tconst label = selected?.label ?? (busy ? t("loading") : t("unavailable"));', '\t\t\tconst label = selected === void 0 ? busy ? t("loading") : t("unavailable") : permissionPresetLabel(selected.id, selected.label, t);', 'permission settings compatibility check failed (alpha selected label)')
    output = replaceRequired(output, '\t\t\t\t\t\tlabel: option.label', '\t\t\t\t\t\tlabel: permissionPresetLabel(option.id, option.label, t)', 'permission settings compatibility check failed (alpha settings menu label)')
    output = replaceRequired(output, 'label: displayPermissionPreset(option.value, option.name),', 'label: permissionPresetLabel(option.value, displayPermissionPreset(option.value, option.name), t),', 'permission settings compatibility check failed (alpha command menu label)')
    output = replaceRequired(output, '\t\t\t"unavailable": "不可用",', '\t\t\t"unavailable": "不可用",\n\t\t\t"preset.readOnly": "只读",\n\t\t\t"preset.workspaceWrite": "工作区写入",\n\t\t\t"preset.fullAccess": "完全访问",', 'permission settings compatibility check failed (alpha Chinese labels)')
    output = replaceRequired(output, '\t\t\t"unavailable": "Unavailable",', '\t\t\t"unavailable": "Unavailable",\n\t\t\t"preset.readOnly": "Read only",\n\t\t\t"preset.workspaceWrite": "Workspace write",\n\t\t\t"preset.fullAccess": "Full access",', 'permission settings compatibility check failed (alpha English labels)')
    output = replaceRequired(output, '"confirm.title": "确认启用 Full access？"', '"confirm.title": "确认启用完全访问？"', 'permission settings compatibility check failed (alpha Chinese confirmation title)', 2)
    output = replaceRequired(output, '"confirm.description": "启用 Full access 后', '"confirm.description": "启用完全访问后', 'permission settings compatibility check failed (alpha Chinese confirmation description)', 2)
    output = replaceRequired(output, '"confirm.enable": "启用 Full access"', '"confirm.enable": "启用完全访问"', 'permission settings compatibility check failed (alpha Chinese confirmation action)', 2)
    return output
  }

  let output = replaceRequired(
    input,
    '\t\tfunction PermissionRow({ load, select, usePermission, t }) {',
    `\t\t/* ${MARKER} */\n` +
      '\t\tconst permissionPresetLocaleKeys = {\n' +
      '\t\t\t"read-only": "preset.readOnly",\n' +
      '\t\t\t"workspace-write": "preset.workspaceWrite",\n' +
      '\t\t\t"danger-full-access": "preset.fullAccess"\n' +
      '\t\t};\n' +
      '\t\tfunction permissionPresetLabel(value, fallback, t) {\n' +
      '\t\t\tconst key = permissionPresetLocaleKeys[value];\n' +
      '\t\t\treturn key === void 0 ? fallback : t(key);\n' +
      '\t\t}\n' +
      '\t\tfunction PermissionRow({ load, select, usePermission, t }) {',
    'permission settings compatibility check failed (row seam)',
  )
  output = replaceRequired(
    output,
    '\t\t\tconst label = selected?.label ?? (busy ? t("loading") : t("unavailable"));',
    '\t\t\tconst label = selected === void 0 ? busy ? t("loading") : t("unavailable") : permissionPresetLabel(selected.id, selected.label, t);',
    'permission settings compatibility check failed (selected label)',
  )
  output = replaceRequired(
    output,
    '\t\t\t\t\t\tlabel: option.label',
    '\t\t\t\t\t\tlabel: permissionPresetLabel(option.id, option.label, t)',
    'permission settings compatibility check failed (menu label)',
  )
  output = replaceRequired(
    output,
    '\t\t\t"unavailable": "不可用",',
    '\t\t\t"unavailable": "不可用",\n' +
      '\t\t\t"preset.readOnly": "只读",\n' +
      '\t\t\t"preset.workspaceWrite": "工作区写入",\n' +
      '\t\t\t"preset.fullAccess": "完全访问",',
    'permission settings compatibility check failed (Chinese labels)',
  )
  output = replaceRequired(
    output,
    '\t\t\t"unavailable": "Unavailable",',
    '\t\t\t"unavailable": "Unavailable",\n' +
      '\t\t\t"preset.readOnly": "Read only",\n' +
      '\t\t\t"preset.workspaceWrite": "Workspace write",\n' +
      '\t\t\t"preset.fullAccess": "Full access",',
    'permission settings compatibility check failed (English labels)',
  )
  output = replaceRequired(
    output,
    '"confirm.title": "确认启用 Full access？"',
    '"confirm.title": "确认启用完全访问？"',
    'permission settings compatibility check failed (Chinese confirmation title)',
    2,
  )
  output = replaceRequired(
    output,
    '"confirm.description": "启用 Full access 后',
    '"confirm.description": "启用完全访问后',
    'permission settings compatibility check failed (Chinese confirmation description)',
    2,
  )
  output = replaceRequired(
    output,
    '"confirm.enable": "启用 Full access"',
    '"confirm.enable": "启用完全访问"',
    'permission settings compatibility check failed (Chinese confirmation action)',
    2,
  )
  return output
}

export function patchConversationPermissions(input) {
  if (input.includes(MARKER)) return input

  if (input.includes('\t\tfunction optionLabel(option, t) {')) {
    let output = replaceRequired(
      input,
      '\t\tfunction optionLabel(option, t) {\n\t\t\treturn option.value === FULL_ACCESS ? t("access.fullLabel") : displayName(option.name);\n\t\t}',
      `\t\t/* ${MARKER} */\n` +
        '\t\tconst permissionModeLocaleKeys = {\n' +
        '\t\t\t"read-only": "access.mode.readOnly",\n' +
        '\t\t\t"workspace-write": "access.mode.workspaceWrite",\n' +
        '\t\t\t"danger-full-access": "access.mode.fullAccess"\n' +
        '\t\t};\n' +
        '\t\tfunction optionLabel(option, t) {\n' +
        '\t\t\tconst key = permissionModeLocaleKeys[option.value];\n' +
        '\t\t\treturn key === void 0 ? displayName(option.name) : t(key);\n' +
        '\t\t}',
      'conversation permission compatibility check failed (alpha label seam)',
    )
    output = replaceRequired(output, 'current === void 0 ? displayName(currentValue) : optionLabel(current, t)', 'optionLabel(current ?? { value: currentValue, name: currentValue }, t)', 'conversation permission compatibility check failed (alpha current label)', 2)
    output = replaceRequired(output, '\t\t\t"access.confirm.enable": "启用 Full access",\n\t\t\t"access.fullLabel": "Full access",', '\t\t\t"access.confirm.enable": "启用完全访问",\n\t\t\t"access.mode.readOnly": "只读",\n\t\t\t"access.mode.workspaceWrite": "工作区写入",\n\t\t\t"access.mode.fullAccess": "完全访问",\n\t\t\t"access.fullLabel": "完全访问",', 'conversation permission compatibility check failed (alpha Chinese labels)')
    output = replaceRequired(output, '\t\t\t"access.confirm.enable": "Enable Full access",\n\t\t\t"access.fullLabel": "Full access",', '\t\t\t"access.confirm.enable": "Enable Full access",\n\t\t\t"access.mode.readOnly": "Read only",\n\t\t\t"access.mode.workspaceWrite": "Workspace write",\n\t\t\t"access.mode.fullAccess": "Full access",\n\t\t\t"access.fullLabel": "Full access",', 'conversation permission compatibility check failed (alpha English labels)')
    output = replaceRequired(output, '"access.confirm.title": "确认启用 Full access？"', '"access.confirm.title": "确认启用完全访问？"', 'conversation permission compatibility check failed (alpha Chinese confirmation title)')
    output = replaceRequired(output, '"access.confirm.description": "启用 Full access 后', '"access.confirm.description": "启用完全访问后', 'conversation permission compatibility check failed (alpha Chinese confirmation description)')
    return output
  }

  let output = replaceRequired(
    input,
    '\t\tfunction optionLabel(option) {\n\t\t\treturn option.value === FULL_ACCESS ? "Full access" : displayName(option.name);\n\t\t}',
    `\t\t/* ${MARKER} */\n` +
      '\t\tconst permissionModeLocaleKeys = {\n' +
      '\t\t\t"read-only": "access.mode.readOnly",\n' +
      '\t\t\t"workspace-write": "access.mode.workspaceWrite",\n' +
      '\t\t\t"danger-full-access": "access.mode.fullAccess"\n' +
      '\t\t};\n' +
      '\t\tfunction optionLabel(option, t) {\n' +
      '\t\t\tconst key = permissionModeLocaleKeys[option.value];\n' +
      '\t\t\treturn key === void 0 ? displayName(option.name) : t(key);\n' +
      '\t\t}',
    'conversation permission compatibility check failed (label seam)',
  )
  output = replaceRequired(
    output,
    'label: optionLabel(option),',
    'label: optionLabel(option, t),',
    'conversation permission compatibility check failed (menu label)',
  )
  output = replaceRequired(
    output,
    'current === void 0 ? displayName(currentValue) : optionLabel(current)',
    'optionLabel(current ?? { value: currentValue, name: currentValue }, t)',
    'conversation permission compatibility check failed (current label)',
    2,
  )
  output = replaceRequired(
    output,
    '\t\t\t"access.confirm.title": "确认启用 Full access？",',
    '\t\t\t"access.mode.readOnly": "只读",\n' +
      '\t\t\t"access.mode.workspaceWrite": "工作区写入",\n' +
      '\t\t\t"access.mode.fullAccess": "完全访问",\n' +
      '\t\t\t"access.confirm.title": "确认启用完全访问？",',
    'conversation permission compatibility check failed (Chinese labels)',
  )
  output = replaceRequired(
    output,
    '"access.confirm.description": "启用 Full access 后',
    '"access.confirm.description": "启用完全访问后',
    'conversation permission compatibility check failed (Chinese confirmation description)',
  )
  output = replaceRequired(
    output,
    '"access.confirm.enable": "启用 Full access"',
    '"access.confirm.enable": "启用完全访问"',
    'conversation permission compatibility check failed (Chinese confirmation action)',
  )
  output = replaceRequired(
    output,
    '\t\t\t"access.confirm.title": "Enable Full access?",',
    '\t\t\t"access.mode.readOnly": "Read only",\n' +
      '\t\t\t"access.mode.workspaceWrite": "Workspace write",\n' +
      '\t\t\t"access.mode.fullAccess": "Full access",\n' +
      '\t\t\t"access.confirm.title": "Enable Full access?",',
    'conversation permission compatibility check failed (English labels)',
  )
  return output
}

export async function patchInstalledPermissionLocales(appRoot) {
  const settingsTarget = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-permission-presets', 'lib', 'client.js')
  const conversationTarget = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
  const settingsSource = await readFile(settingsTarget, 'utf8')
  const conversationSource = await readFile(conversationTarget, 'utf8')
  const settingsOutput = patchPermissionSettings(settingsSource)
  const conversationOutput = patchConversationPermissions(conversationSource)
  if (settingsOutput !== settingsSource) await writeFile(settingsTarget, settingsOutput, 'utf8')
  if (conversationOutput !== conversationSource) await writeFile(conversationTarget, conversationOutput, 'utf8')
  return [settingsTarget, conversationTarget]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appRoot = process.argv[2]
  if (!appRoot) throw new Error('usage: node patch-permission-localization.mjs <staged-app-directory>')
  process.stdout.write(`${(await patchInstalledPermissionLocales(path.resolve(appRoot))).join('\n')}\n`)
}
