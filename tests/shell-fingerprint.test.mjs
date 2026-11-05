import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { computeShellFingerprint } from '../scripts/shell-fingerprint.mjs'

test('Windows source checkout line endings do not reject a compatible core, but code changes do', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-shell-fingerprint-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'launcher/windows'), { recursive: true })
  await writeFile(path.join(root, 'launcher/host.mjs'), 'export const version = 1\n')
  const source = path.join(root, 'launcher/windows/Host.cs')
  const manifest = path.join(root, 'launcher/windows/Host.manifest')
  await writeFile(source, 'class Host {\n  const int Version = 1;\n}\n')
  await writeFile(manifest, '<assembly>\n</assembly>\n')
  await mkdir(path.join(root, 'desktop-bridge'), { recursive: true })
  const locales = path.join(root, 'desktop-bridge/locales.json')
  await writeFile(locales, '{"en": {"native": {"Open": "Open"}}}\n')
  const original = await computeShellFingerprint(root, 'windows')
  await writeFile(locales, '{"en": {"native": {"Open": "Show"}}}\n')
  assert.notEqual(await computeShellFingerprint(root, 'windows'), original)
  await writeFile(locales, '{"en": {"native": {"Open": "Open"}}}\n')
  await writeFile(source, 'class Host {\r\n  const int Version = 1;\n}\r\n')
  await writeFile(manifest, '<assembly>\r\n</assembly>\r\n')
  assert.equal(await computeShellFingerprint(root, 'windows'), original)
  await writeFile(source, 'class Host {\r\n  const int Version = 2;\r\n}\r\n')
  assert.notEqual(await computeShellFingerprint(root, 'windows'), original)
  await writeFile(source, 'class Host {\n  const int Version = 1;\n}\n')
  await writeFile(path.join(root, 'launcher/host.mjs'), 'export const version = 2\n')
  assert.notEqual(await computeShellFingerprint(root, 'windows'), original)
})
