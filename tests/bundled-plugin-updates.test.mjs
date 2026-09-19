import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bundledUpdateTarget } from '../app/vendor/dsh-portable-plugin-market/src/bundled-updates.ts'

test('reviewed default beta is offered over old stable without opting unrelated plugins into betas', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bundled-update-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'licenses'))
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ defaultPlugins: [
    { package: 'dsh-chat-manager', version: '1.4.0-beta.1' },
    { package: 'dsh-image-viewer', version: '0.1.2-beta.1' },
    { package: 'unrelated-plugin', version: '9.0.0-beta.1' },
  ] }))
  assert.equal(bundledUpdateTarget('dsh-chat-manager', '1.3.5', root), '1.4.0-beta.1')
  assert.equal(bundledUpdateTarget('dsh-image-viewer', '0.1.1', root), '0.1.2-beta.1')
  assert.equal(bundledUpdateTarget('dsh-chat-manager', '1.4.0-beta.1', root), null)
  assert.equal(bundledUpdateTarget('dsh-chat-manager', '1.5.0', root), null)
  assert.equal(bundledUpdateTarget('unrelated-plugin', '1.0.0', root), null)
  assert.equal(bundledUpdateTarget('dsh-chat-manager', null, root), null)
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), '{broken')
  assert.equal(bundledUpdateTarget('dsh-chat-manager', '1.3.5', root), null)
})
