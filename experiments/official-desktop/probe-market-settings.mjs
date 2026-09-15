// Real published settings/cordis modules, synthetic in-memory persistence only.
import { createRequire } from 'node:module'
import { copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const root = resolve(process.argv[2] || 'build/alpha016-settings')
const require = createRequire(join(root, 'package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')))
const { SettingsProvider } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-settings')))
await copyFile('app/vendor/dsh-portable-plugin-market/src/settings.ts', join(root, 'market-settings.ts'))
const { installMarketSettings } = await import(pathToFileURL(join(root, 'market-settings.ts')))
let persisted
class MemorySettings extends SettingsProvider {
  writable = true
  async load() { return {} }
  async persist(document) { persisted = document }
}
const ctx = new Context()
const settings = ctx.plugin(MemorySettings)
await settings.await()
const config = { allowRestart: true, channel: 'beta' }
const consumer = ctx.plugin(owner => installMarketSettings(owner, config))
await consumer.await()
try {
  await ctx.settings.update('dsh-market', { allowRestart: false })
  assert.equal(config.allowRestart, false)
  assert.equal(config.channel, 'beta')
  await ctx.settings.update('dsh-market', { allowRestart: true })
  assert.equal(config.allowRestart, true)
  assert.equal(config.channel, 'beta')
  assert.ok(persisted)
  await writeFile(join(root, 'result.json'), JSON.stringify({ settingsVersion: require('@deepseek-ai/dsh-settings/package.json').version,
    toggleRoundTrip: true, unrelatedChannelPreserved: true, scope: 'Published settings service and Cordis, memory persistence; not complete market or UI qualification' }, null, 2))
  console.log('Published settings service: toggle round trip and channel preservation passed')
} finally { await consumer.dispose(); await settings.dispose() }
