import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, stat, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appendLauncherLog } from '../launcher/launcher-log.mjs'

test('CLI-only logging rotates without a desktop shell and preserves recent evidence', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-launcher-log-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = path.join(root, 'launcher.log')
  await writeFile(filename, 'old\n'.repeat(256 * 1024))
  assert.equal(appendLauncherLog(root, 'new\n'), true)
  assert.equal(await readFile(filename, 'utf8'), 'new\n')
  assert.equal((await stat(`${filename}.previous`)).size, 1024 * 1024)
  for (let i = 0; i < 200; i++) assert.equal(appendLauncherLog(root, 'x'.repeat(16383) + '\n'), true)
  assert.ok((await stat(filename)).size <= 1024 * 1024)
  assert.ok((await stat(`${filename}.previous`)).size <= 1024 * 1024)
  assert.equal(appendLauncherLog(root, 'x'.repeat(16385)), false)
})

test('unsafe rotation target is preserved and logging cannot block recovery', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-launcher-log-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outside = path.join(root, 'keep')
  await mkdir(outside)
  await writeFile(path.join(outside, 'user-data'), 'preserve')
  await symlink(outside, path.join(root, 'launcher.log.previous'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(path.join(root, 'launcher.log'), 'x'.repeat(1024 * 1024))
  assert.equal(appendLauncherLog(root, 'new\n'), false)
  assert.equal(await readFile(path.join(outside, 'user-data'), 'utf8'), 'preserve')
  assert.equal((await stat(path.join(root, 'launcher.log'))).size, 1024 * 1024)
})
