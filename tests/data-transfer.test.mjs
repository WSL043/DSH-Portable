import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDataArchive, inspectDataArchive, restoreDataArchive } from '../launcher/data-transfer.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-data-transfer-'))
  const layout = layoutForRoot(root, process.platform)
  await mkdir(path.join(layout.dshHome, 'sessions', 'workspace-a', 'session-one'), { recursive: true })
  await mkdir(path.join(layout.dshHome, 'profiles', 'web', 'node_modules', 'ignored'), { recursive: true })
  await mkdir(path.join(layout.dataDir, 'webview2'), { recursive: true })
  await mkdir(layout.workspace, { recursive: true })
  await writeFile(path.join(layout.dataDir, 'launcher-settings.json'), '{"updateCheck":false}\n')
  await writeFile(path.join(layout.dshHome, 'settings.yaml'), 'locale: zh-CN\n')
  await writeFile(path.join(layout.dshHome, '.credentials.yaml'), 'secret: test-only\n')
  await writeFile(path.join(layout.dshHome, 'sessions', 'workspace-a', 'session-one', 'session.jsonl.zstd'), 'session-one')
  await writeFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json'), '{"dependencies":{"plugin-a":"1.0.0"}}\n')
  await writeFile(path.join(layout.dshHome, 'profiles', 'web', 'cordis.patch.yml'), 'plugins: []\n')
  await writeFile(path.join(layout.dshHome, 'profiles', 'web', 'node_modules', 'ignored', 'large.js'), 'ignore')
  await writeFile(path.join(layout.dataDir, 'webview2', 'cache.bin'), 'ignore')
  await writeFile(path.join(layout.workspace, 'project.txt'), 'workspace')
  return { root, layout }
}

test('data archive defaults to durable settings, sessions and reproducible plugin metadata', async () => {
  const { layout } = await fixture()
  const output = path.join(layout.root, 'backup.dshdata')
  const created = await createDataArchive(layout, output)
  const inspected = await inspectDataArchive(output)

  assert.deepEqual(created.categories, ['settings', 'sessions', 'plugins'])
  assert.equal(inspected.encrypted, false)
  assert.ok(inspected.files.includes('data/dsh-home/settings.yaml'))
  assert.ok(inspected.files.includes('data/dsh-home/sessions/workspace-a/session-one/session.jsonl.zstd'))
  assert.ok(inspected.files.includes('data/dsh-home/profiles/web/package.json'))
  assert.ok(!inspected.files.some(file => file.includes('node_modules')))
  assert.ok(!inspected.files.some(file => file.includes('webview2')))
  assert.ok(!inspected.files.includes('data/dsh-home/.credentials.yaml'))
  assert.ok(!inspected.files.includes('workspace/project.txt'))
})

test('credential export requires authenticated encryption and rejects a wrong password', async () => {
  const { layout } = await fixture()
  const output = path.join(layout.root, 'private.dshdata')
  await assert.rejects(createDataArchive(layout, output, { categories: ['credentials'] }), /password/i)
  await createDataArchive(layout, output, { categories: ['credentials'], password: 'correct horse battery staple' })
  const inspected = await inspectDataArchive(output, { password: 'correct horse battery staple' })
  assert.equal(inspected.encrypted, true)
  assert.ok(inspected.files.includes('data/dsh-home/.credentials.yaml'))
  await assert.rejects(inspectDataArchive(output, { password: 'wrong password' }), /password|decrypt|authentic/i)
})

test('plain and encrypted migration packages can carry the same user data', async () => {
  const sample = await fixture()
  const categories = ['settings', 'sessions', 'plugins', 'credentials']
  const plain = path.join(sample.layout.root, 'plain.dshdata')
  const encrypted = path.join(sample.layout.root, 'encrypted.dshdata')
  await createDataArchive(sample.layout, plain, { categories, allowUnencryptedCredentials: true })
  await createDataArchive(sample.layout, encrypted, { categories, password: 'correct horse battery staple' })
  const plainInfo = await inspectDataArchive(plain)
  const encryptedInfo = await inspectDataArchive(encrypted, { password: 'correct horse battery staple' })
  assert.equal(plainInfo.encrypted, false)
  assert.equal(encryptedInfo.encrypted, true)
  assert.deepEqual(plainInfo.files, encryptedInfo.files)
})

test('all encrypted data packages enforce the product password floor', async () => {
  const sample = await fixture()
  await assert.rejects(
    createDataArchive(sample.layout, path.join(sample.root, 'weak.dshdata'), { password: 'short' }),
    /at least 8 characters/,
  )
})

test('restore keeps target conflicts by default and imports missing data', async () => {
  const source = await fixture()
  const output = path.join(source.layout.root, 'backup.dshdata')
  await createDataArchive(source.layout, output)

  const target = await fixture()
  await writeFile(path.join(target.layout.dshHome, 'settings.yaml'), 'locale: en-US\n')
  await mkdir(path.join(target.layout.dshHome, 'sessions', 'workspace-b', 'session-two'), { recursive: true })
  await writeFile(path.join(target.layout.dshHome, 'sessions', 'workspace-b', 'session-two', 'session.jsonl.zstd'), 'target')

  const result = await restoreDataArchive(target.layout, output)
  assert.equal(await readFile(path.join(target.layout.dshHome, 'settings.yaml'), 'utf8'), 'locale: en-US\n')
  assert.equal(await readFile(path.join(target.layout.dshHome, 'sessions', 'workspace-a', 'session-one', 'session.jsonl.zstd'), 'utf8'), 'session-one')
  assert.ok(result.conflicts.includes('data/dsh-home/settings.yaml'))
  assert.equal(await readFile(path.join(target.layout.dshHome, 'sessions', 'workspace-b', 'session-two', 'session.jsonl.zstd'), 'utf8'), 'target')
})

test('restore can explicitly replace conflicts after creating a rollback snapshot', async () => {
  const source = await fixture()
  const output = path.join(source.layout.root, 'backup.dshdata')
  await createDataArchive(source.layout, output)
  const target = await fixture()
  await writeFile(path.join(target.layout.dshHome, 'settings.yaml'), 'locale: en-US\n')

  const result = await restoreDataArchive(target.layout, output, { conflict: 'replace' })
  assert.equal(await readFile(path.join(target.layout.dshHome, 'settings.yaml'), 'utf8'), 'locale: zh-CN\n')
  assert.ok(result.rollbackDirectory)
  assert.equal(await readFile(path.join(result.rollbackDirectory, 'data', 'dsh-home', 'settings.yaml'), 'utf8'), 'locale: en-US\n')
})

test('restore rejects archive entries outside their durable data category', async () => {
  const { layout } = await fixture()
  const output = path.join(layout.root, 'backup.dshdata')
  await createDataArchive(layout, output)
  const bytes = await readFile(output)
  const { gunzipSync, gzipSync } = await import('node:zlib')
  const document = JSON.parse(gunzipSync(bytes.subarray(8)).toString('utf8'))
  document.files[0].path = 'launcher/portable-cli.mjs'
  const tampered = Buffer.concat([bytes.subarray(0, 8), gzipSync(Buffer.from(JSON.stringify(document)))])
  await writeFile(output, tampered)
  await assert.rejects(inspectDataArchive(output), /does not belong/i)
})
