import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeDataFileAtomic } from '../launcher/data-paths.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-atomic-order-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'actual')
  await mkdir(directory)
  return { root, directory }
}

test('concurrent atomic writes through parent aliases share the physical target queue', async t => {
  const { root, directory } = await fixture(t)
  const alias = path.join(root, 'alias')
  await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const payloads = Array.from({ length: 24 }, (_, index) => JSON.stringify({ index, text: 'x'.repeat(8192) }))
  await Promise.all(payloads.map((bytes, index) => writeDataFileAtomic(path.join(index % 2 ? alias : directory, 'state.json'), bytes)))
  assert.ok(payloads.includes(await readFile(path.join(directory, 'state.json'), 'utf8')))
  assert.deepEqual(await readdir(directory), ['state.json'])
})

test('failed writes report each error, clean their staging files and do not poison a later write', async t => {
  const { directory } = await fixture(t)
  const target = path.join(directory, 'blocked')
  await mkdir(target)
  const results = await Promise.allSettled([
    writeDataFileAtomic(target, 'first'),
    writeDataFileAtomic(target, 'second'),
    writeDataFileAtomic(path.join(directory, 'independent'), 'other target'),
  ])
  assert.equal(results[0].status, 'rejected')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[2].status, 'fulfilled')
  await rm(target, { recursive: true })
  await writeDataFileAtomic(target, 'recovered')
  assert.equal(await readFile(target, 'utf8'), 'recovered')
  assert.equal(await readFile(path.join(directory, 'independent'), 'utf8'), 'other target')
  assert.equal((await readdir(directory)).some(name => name.startsWith('.dsh-data-')), false)
})
