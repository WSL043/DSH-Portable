import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { screenshotTarget, writeSmokeScreenshot } from '../scripts/lib/smoke-screenshot.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-screenshot-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // macOS exposes its temporary directory through /var -> /private/var.
  // The normal-write fixture must use its actual directory; link rejection is tested separately.
  return realpath(root)
}

test('screenshot file names reject traversal, absolute paths, streams and device names', async t => {
  const root = await fixture(t)
  for (const name of ['../escape.png', '/absolute.png', 'C:\\absolute.png', 'nested/pic.png', 'image.png:stream', 'NUL.png', 'pic.txt', 'pic\0.png']) {
    assert.throws(() => screenshotTarget(root, name), /unsafe screenshot/)
  }
  await assert.rejects(writeSmokeScreenshot(path.join(root, 'nested') + '/../escape.png', Buffer.from('image')), /unsafe screenshot/)
  assert.deepEqual(await readdir(root), [])
})

test('screenshot writes preserve explicit absolute output paths and use complete atomic files', async t => {
  const root = await fixture(t)
  const output = path.join(root, 'nested', '诊断.png')
  await writeSmokeScreenshot(output, Buffer.from('first'))
  await writeSmokeScreenshot(output, Buffer.from('second'))
  assert.equal(await readFile(output, 'utf8'), 'second')
  assert.deepEqual(await readdir(path.dirname(output)), ['诊断.png'])
})

test('screenshot writes reject a parent junction without touching the external destination', async t => {
  const root = await fixture(t)
  const outside = path.join(root, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'diagnostic.png'), 'sentinel')
  await symlink(outside, path.join(root, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(writeSmokeScreenshot(path.join(root, 'redirect', 'diagnostic.png'), Buffer.from('replacement')), /unsafe screenshot directory/)
  assert.equal(await readFile(path.join(outside, 'diagnostic.png'), 'utf8'), 'sentinel')
})
