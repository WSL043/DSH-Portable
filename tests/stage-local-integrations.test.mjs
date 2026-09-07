import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stageLocalIntegrations } from '../scripts/stage-local-integrations.mjs'

test('rebuilding local integrations replaces stale code without bundling development dependencies', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-local-packaging-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = path.join(root, 'staged-app')
  for (const [relative, name] of [
    ['desktop-bridge', 'dsh-portable-desktop-bridge'],
    ['app/vendor/dsh-portable-plugin-market', 'dsh-portable-plugin-market'],
  ]) {
    await mkdir(path.join(root, relative, 'node_modules', 'development-only'), { recursive: true })
    await writeFile(path.join(root, relative, 'client.js'), 'current code')
    await writeFile(path.join(root, relative, 'node_modules', 'development-only', 'index.js'), 'do not ship')
    const target = path.join(app, 'node_modules', '@wsl043', name)
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'stale.js'), 'old code')
  }
  await stageLocalIntegrations(app, root)
  for (const name of ['dsh-portable-desktop-bridge', 'dsh-portable-plugin-market']) {
    const target = path.join(app, 'node_modules', '@wsl043', name)
    assert.equal(await readFile(path.join(target, 'client.js'), 'utf8'), 'current code')
    await assert.rejects(access(path.join(target, 'stale.js')), { code: 'ENOENT' })
    await assert.rejects(access(path.join(target, 'node_modules')), { code: 'ENOENT' })
  }
})
