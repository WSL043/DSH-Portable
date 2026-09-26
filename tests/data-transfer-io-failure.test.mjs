import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDataArchive, restoreDataArchiveAllowingPluginFailure } from '../launcher/data-transfer.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-import-io-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = layoutForRoot(path.join(root, 'source'), process.platform)
  const target = layoutForRoot(path.join(root, 'target'), process.platform)
  for (const [layout, locale] of [[source, 'zh-CN'], [target, 'en-US']]) {
    await fs.mkdir(layout.dshHome, { recursive: true })
    await fs.writeFile(path.join(layout.dataDir, 'launcher-settings.json'), JSON.stringify({ locale }))
    await fs.writeFile(path.join(layout.dshHome, 'settings.yaml'), `locale: ${locale}\n`)
  }
  const archive = path.join(root, 'settings.dshdata')
  await createDataArchive(source, archive, { categories: ['settings'] })
  return { source, target, archive }
}

for (const code of ['ENOSPC', 'EIO']) test(`partial import write ${code} restores earlier replacements without another data write`, async t => {
  const { target, archive } = await fixture(t)
  const phases = []
  const originalOpen = fs.open
  let injected = 0
  t.mock.method(fs, 'open', async (filename, ...args) => {
    const handle = await originalOpen(filename, ...args)
    if (path.dirname(filename) === target.dshHome && path.basename(filename).startsWith('.dsh-data-')) {
      const write = handle.writeFile.bind(handle)
      handle.writeFile = async bytes => {
        await write(bytes.subarray(0, 3))
        injected++
        throw Object.assign(new Error('injected partial write'), { code })
      }
    }
    return handle
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(restoreDataArchiveAllowingPluginFailure(target, archive, {
      conflict: 'replace', trace: (phase, detail) => phases.push({ phase, detail }),
    }), error => error.code === code)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
  assert.equal(injected, 1)
  assert.equal(phases.find(item => item.phase === 'rollback-begin').detail.changed, 1)
  assert.ok(phases.some(item => item.phase === 'rollback-complete'))
  assert.equal(await fs.readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: en-US\n')
  assert.equal(await fs.readFile(path.join(target.dataDir, 'launcher-settings.json'), 'utf8'), '{"locale":"en-US"}')
  const files = await fs.readdir(target.dataDir, { recursive: true })
  assert.equal(files.some(name => name.endsWith('.tmp')), false)
  assert.equal(files.some(name => name.includes('before-import-')), false)
})

test('failure to remove a newly imported file is a rollback failure, not a successful recovery', async t => {
  const { target, archive } = await fixture(t)
  const settings = path.join(target.dshHome, 'settings.yaml')
  await fs.rm(settings)
  const phases = []
  let failure
  await assert.rejects(restoreDataArchiveAllowingPluginFailure(target, archive, {
    conflict: 'replace', trace: phase => phases.push(phase),
    validate: async () => {
      // A real filesystem obstruction, without intercepting rollback operations.
      await fs.rm(settings)
      await fs.mkdir(settings)
      throw Object.assign(new Error('validation failed'), { code: 'DSH_DATA_IMPORT_PROFILE_FAILED' })
    },
  }), error => { failure = error; return error.code === 'DSH_DATA_IMPORT_ROLLBACK_FAILED' })
  assert.ok(phases.includes('rollback-failed'))
  assert.equal(phases.includes('rollback-complete'), false)
  assert.equal(phases.includes('complete'), false)
  assert.equal(await fs.readFile(path.join(failure.rollbackDirectory, 'data/launcher-settings.json'), 'utf8'), '{"locale":"en-US"}')
})

test('a busy generated directory retains recovery material and prevents plugin-free retry', async t => {
  const { target, archive } = await fixture(t)
  const generated = path.join(target.dshHome, 'generated-test')
  let validationCalls = 0
  const originalRm = fs.rm
  let failure
  try {
    await assert.rejects(restoreDataArchiveAllowingPluginFailure(target, archive, {
      conflict: 'replace',
      validate: async ({ transaction }) => {
        validationCalls++
        await transaction.prepareGeneratedPath(generated)
        await fs.mkdir(generated)
        await fs.writeFile(path.join(generated, 'partial'), 'incomplete generated output')
        t.mock.method(fs, 'rm', async (filename, ...args) => {
          if (filename === generated) throw Object.assign(new Error('file is busy'), { code: 'EBUSY' })
          return originalRm(filename, ...args)
        })
        syncBuiltinESMExports()
        throw Object.assign(new Error('validation failed'), { code: 'DSH_DATA_IMPORT_PROFILE_FAILED' })
      },
    }), error => { failure = error; return error.code === 'DSH_DATA_IMPORT_ROLLBACK_FAILED' })
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
  assert.equal(validationCalls, 1)
  assert.equal(failure.rollbackError.code, 'EBUSY')
  assert.equal(await fs.readFile(path.join(failure.rollbackDirectory, 'data/dsh-home/settings.yaml'), 'utf8'), 'locale: en-US\n')
})

test('a missing rollback backup does not delete the current file or report successful recovery', async t => {
  const { target, archive } = await fixture(t)
  let failure
  const phases = []
  await assert.rejects(restoreDataArchiveAllowingPluginFailure(target, archive, {
    conflict: 'replace', trace: phase => phases.push(phase),
    validate: async () => {
      const backups = path.join(target.dataDir, 'backups')
      const name = (await fs.readdir(backups)).find(name => name.startsWith('before-import-'))
      await fs.rm(path.join(backups, name, 'data/dsh-home/settings.yaml'))
      throw new Error('validation failed')
    },
  }), error => { failure = error; return error.code === 'DSH_DATA_IMPORT_ROLLBACK_FAILED' })
  assert.equal(failure.rollbackError.code, 'DSH_DATA_IMPORT_BACKUP_MISSING')
  assert.equal(phases.includes('rollback-complete'), false)
  assert.equal(await fs.readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: zh-CN\n')
  assert.equal(await fs.readFile(path.join(failure.rollbackDirectory, 'data/launcher-settings.json'), 'utf8'), '{"locale":"en-US"}')
})
