import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, lstat, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const core = await import(process.env.ISSUE132_CORE
  ? pathToFileURL(path.resolve(process.env.ISSUE132_CORE))
  : '../launcher/portable-core.mjs')

for (const component of ['desktop-bridge', 'plugin-market']) {
  for (const mode of ['materialized', 'empty', 'unknown', 'file']) {
    test(`${component} recovery preserves content: ${mode}`, async () => {
      const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-132-test-'))
      try {
        const root = path.join(parent, 'original')
        const layout = core.layoutForRoot(root)
        const profile = path.join(layout.dshHome, 'profiles', 'web', 'package.json')
        await mkdir(path.dirname(profile), { recursive: true })
        await writeFile(profile, 'user profile must remain byte-identical')
        for (const name of ['desktop-bridge', 'plugin-market']) {
          const target = path.join(layout.appDir, 'node_modules', '@wsl043', `dsh-portable-${name}`)
          await mkdir(target, { recursive: true })
          await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: `@wsl043/dsh-portable-${name}` }))
        }
        const fallback = component === 'desktop-bridge' ? layout.desktopBridgeFallback : layout.pluginMarketFallback
        const target = component === 'desktop-bridge' ? path.dirname(layout.desktopBridgePatch) : layout.pluginMarketRoot
        await mkdir(path.dirname(fallback), { recursive: true })
        if (mode === 'file') await writeFile(fallback, 'keep unchanged')
        else {
          await mkdir(fallback)
          if (mode !== 'empty') {
            await writeFile(path.join(fallback, 'package.json'), JSON.stringify({
              name: mode === 'materialized' ? `@wsl043/dsh-portable-${component}` : 'unknown',
            }))
            await writeFile(path.join(fallback, 'sentinel'), 'preserve all original bytes')
          }
        }
        if (mode === 'unknown' || mode === 'file') {
          await assert.rejects(core.ensureDesktopBridgeFallback(layout), /preserved unchanged/)
          assert.equal((await lstat(fallback)).isSymbolicLink(), false)
          assert.equal(await readFile(mode === 'file' ? fallback : path.join(fallback, 'sentinel'), 'utf8'),
            mode === 'file' ? 'keep unchanged' : 'preserve all original bytes')
          return
        }
        assert.equal(await core.ensureDesktopBridgeFallback(layout), true)
        assert.equal(await readFile(profile, 'utf8'), 'user profile must remain byte-identical')
        assert.equal(await realpath(fallback), await realpath(target))
        const recovery = path.join(layout.dataDir, 'recovery', 'managed-packages')
        const entries = await readdir(recovery)
        assert.equal(entries.length, 1)
        const record = JSON.parse(await readFile(path.join(recovery, entries[0], 'recovery.json'), 'utf8'))
        assert.equal(record.fallback, fallback)
        if (mode === 'materialized') {
          assert.equal(await readFile(path.join(record.backup, 'sentinel'), 'utf8'), 'preserve all original bytes')
        }
        assert.equal(await core.ensureDesktopBridgeFallback(layout), false)
        assert.equal((await readdir(recovery)).length, 1)
        const moved = path.join(parent, 'moved')
        await rename(root, moved)
        const movedLayout = core.layoutForRoot(moved)
        await core.ensureDesktopBridgeFallback(movedLayout)
        assert.equal(await realpath(movedLayout.desktopBridgeFallback), await realpath(path.dirname(movedLayout.desktopBridgePatch)))
        assert.equal(await realpath(movedLayout.pluginMarketFallback), await realpath(movedLayout.pluginMarketRoot))
      } finally {
        // Only this test's freshly allocated temporary parent is removed.
        await rm(parent, { recursive: true, force: true })
      }
    })
  }
}
