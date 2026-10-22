import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync, gzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { createDataArchive } from '../launcher/data-transfer.mjs'
import { layoutForRoot, projectKey } from '../launcher/portable-core.mjs'
import { importNativeData } from '../experiments/official-payload/import-native-data.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')

test('Native archive restores history, nested workspace records and settings into fresh desktop data without profiles or credentials', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pure-native-data-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = layoutForRoot(path.join(root, 'old-native'))
  const desktop = path.join(root, 'desktop')
  const files = {
    'data/dsh-home/settings.yaml': 'language: zh-CN\n',
    'data/launcher-settings.json': '{"nativeOnly":true}',
    'data/dsh-home/.credentials.yaml': 'fixture-secret-must-not-import\n',
    'data/dsh-home/profiles/web/package.json': '{"dependencies":{"old-plugin":"1.0.0"}}',
    'workspace/中文.txt': 'portable workspace',
    'data/dsh-home/storages/workspaces/nested.json': JSON.stringify({ cwd: source.workspace, preserve: `text ${source.workspace}` }),
  }
  const log = `data/dsh-home/sessions/${projectKey(source.workspace)}/fixture/session.v4.jsonl.zstd`
  const header = JSON.stringify({ type: 'session', id: 'fixture', version: 4, cwd: source.workspace }) + '\n'
  const event = Buffer.from('{"type":"fixture","text":"historical message stays byte-identical"}\n')
  const session = Buffer.concat([zstdCompressSync(Buffer.from(header)), zstdCompressSync(event)])
  for (const [filename, content] of Object.entries({ ...files, [log]: session })) {
    await mkdir(path.dirname(path.join(source.root, filename)), { recursive: true })
    await writeFile(path.join(source.root, filename), content)
  }
  await mkdir(path.join(desktop, 'data/dsh-home'), { recursive: true })
  const archive = path.join(root, 'native.dshdata')
  await createDataArchive(source, archive, { categories: ['settings', 'sessions', 'workspace', 'plugins', 'credentials'], allowUnencryptedCredentials: true })
  const before = hash(await readFile(archive))
  const result = await importNativeData(archive, desktop, { workspaceRoot: root })
  assert.equal(result.importedFiles, 4, 'discarded Native launcher preferences must not be counted')
  assert.equal(result.archiveSha256, before)
  const finalWorkspace = path.join(desktop, 'data/workspace')
  const relocated = await readFile(path.join(desktop, 'data/dsh-home/sessions', projectKey(finalWorkspace), 'fixture/session.v4.jsonl.zstd'))
  const decoded = zstdDecompressSync(relocated).toString()
  assert.equal(JSON.parse(decoded.split('\n')[0]).cwd, finalWorkspace)
  assert.ok(relocated.subarray(-zstdCompressSync(event).length).equals(zstdCompressSync(event)), 'later compressed event frame must remain byte-identical')
  const storage = JSON.parse(await readFile(path.join(desktop, 'data/dsh-home/storages/workspaces/nested.json')))
  assert.equal(storage.cwd, finalWorkspace)
  assert.equal(storage.preserve, `text ${source.workspace}`, 'historical text must not be broadly replaced')
  assert.equal(await readFile(path.join(finalWorkspace, '中文.txt'), 'utf8'), 'portable workspace')
  assert.equal(await readFile(path.join(desktop, 'data/dsh-home/settings.yaml'), 'utf8'), files['data/dsh-home/settings.yaml'])
  assert.deepEqual((await readdir(path.join(desktop, 'data/dsh-home'))).sort(), ['sessions', 'settings.yaml', 'storages'])
  assert.deepEqual((await readdir(path.join(desktop, 'data'))).sort(), ['dsh-home', 'launcher', 'workspace'])
  assert.equal(hash(await readFile(archive)), before)
  assert.ok((await readFile(path.join(source.root, log))).equals(session))
  assert.equal(await readFile(path.join(source.dshHome, '.credentials.yaml'), 'utf8'), files['data/dsh-home/.credentials.yaml'])
})

test('migration refuses used targets, redirected roots and damaged packages without replacing user files', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pure-native-boundary-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = layoutForRoot(path.join(root, 'source'))
  await mkdir(source.dshHome, { recursive: true })
  await writeFile(path.join(source.dshHome, 'settings.yaml'), 'language: en\n')
  const archive = path.join(root, 'native.dshdata')
  await createDataArchive(source, archive, { categories: ['settings'] })
  const target = path.join(root, 'desktop')
  await mkdir(path.join(target, 'data'), { recursive: true })
  const marker = path.join(target, 'data/existing.txt')
  await writeFile(marker, 'preserve original data')
  await assert.rejects(importNativeData(archive, target, { workspaceRoot: root }), /fresh desktop data/)
  assert.equal(await readFile(marker, 'utf8'), 'preserve original data')
  const link = path.join(root, 'redirected')
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(importNativeData(archive, link, { workspaceRoot: root }), /Redirected/)
  const clean = path.join(root, 'clean')
  await mkdir(clean)
  await writeFile(archive, 'corrupt archive')
  await assert.rejects(importNativeData(archive, clean, { workspaceRoot: root }), /Unsupported/)
  assert.ok((await readdir(clean)).every(value => value.startsWith('.native-import-')), 'a failed migration must leave only isolated diagnostic staging')
  await rm(path.join(source.dshHome, 'settings.yaml'))
  await writeFile(path.join(source.dataDir, 'launcher-settings.json'), '{}')
  await createDataArchive(source, archive, { categories: ['settings'] })
  await assert.rejects(importNativeData(archive, clean, { workspaceRoot: root }), /no supported Native user data/)
  await assert.rejects(readFile(path.join(clean, 'data/launcher/native-import.json')), { code: 'ENOENT' })
  await mkdir(source.workspace)
  await writeFile(path.join(source.workspace, 'note.txt'), 'workspace metadata is necessary')
  await createDataArchive(source, archive, { categories: ['workspace'] })
  const bytes = await readFile(archive)
  const document = JSON.parse(gunzipSync(bytes.subarray(8)))
  delete document.portableWorkspace
  await writeFile(archive, Buffer.concat([bytes.subarray(0, 8), gzipSync(JSON.stringify(document))]))
  await assert.rejects(importNativeData(archive, clean, { workspaceRoot: root }), /workspace metadata is required/)
  await assert.rejects(importNativeData(archive, clean, { workspaceRoot: source.root }), /escapes the selected working directory/)
})
