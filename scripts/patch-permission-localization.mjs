import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifiedPackageFile } from './verified-package-file.mjs'

const includesAll = (source, needles) => needles.every(needle => source.includes(needle))
const compactCalls = source => source.replace(/,\s*(?=[\w{])/gu, ',')
const permissionLabel = [
  'function permissionLabel(value,name,t)',
  'permissionLabel(option.value,option.name,t)',
]

// Keep this entry point for core qualification. Supported cores localize the
// official controls themselves, either inline or through the presets slot.
export function verifyPermissionLocalization(settings, conversation) {
  settings = compactCalls(settings)
  conversation = compactCalls(conversation)
  assert.ok(includesAll(settings, [
    '"preset.readOnly":',
    '"preset.workspaceWrite":',
    '"preset.fullAccess":',
    'function displayPermissionPreset(value,name,t)',
    'displayPermissionPreset(option.id,option.label,t)',
  ]), 'Official permission settings localization is missing')

  const inline = includesAll(conversation, [
    '"access.preset.readOnly":',
    '"access.preset.workspaceWrite":',
    '"access.preset.fullAccess":',
    ...permissionLabel,
  ])
  const slot = includesAll(settings, permissionLabel)
    && /ctx\.slots\.inject\((["`])conversation\.input\.permission\1/u.test(settings)
    && /renderSlot\((["`])conversation\.input\.permission\1,\{\s*locked\s*\}\)/u.test(conversation)
    && !conversation.includes('function optionLabel(')
  assert.ok(inline || slot, 'Official conversation permission localization is missing')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node patch-permission-localization.mjs <staged-app-directory>')
  const root = path.resolve(process.argv[2])
  const readClient = async name => readFile(await verifiedPackageFile(root, 'node_modules', '@deepseek-ai', name, 'lib', 'client.js'), 'utf8')
  verifyPermissionLocalization(await readClient('dsh-client-ui-permission-presets'), await readClient('dsh-client-ui-conversation'))
}
