import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const read = (name) => readFile(path.join(root, name), 'utf8')

test('the marketplace candidate pins one live visual catalog and no curated extension cards', async () => {
  const [product, app, lock, patch, chinese, english] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('app/package.json').then(JSON.parse),
    read('app/package-lock.json').then(JSON.parse),
    read('desktop-bridge/cordis.patch.yml'),
    read('README.md'),
    read('README.en.md'),
  ])

  assert.match(product.version, /^0\.4\.0-rc\.[1-9]\d*$/)
  assert.equal(app.dependencies.dshmarket, '1.16.0')

  const market = lock.packages['node_modules/dshmarket']
  assert.equal(market.version, '1.16.0')
  assert.equal(market.resolved, 'https://registry.npmjs.org/dshmarket/-/dshmarket-1.16.0.tgz')
  assert.equal(market.integrity, 'sha512-WuHVUQzzECcK0gWdf0Q84KVvKNYNLTbF/GEh2TpBZEeekEI9hbZlqRu3kDwfVDciRgb49GtD0ost1sn45BbfMQ==')

  assert.match(patch, /id:\s*dsh-market/)
  assert.match(patch, /name:\s*['"]dshmarket['"]/)
  assert.match(patch, /profile:\s*web/)
  assert.match(patch, /allowRestart:\s*false/)
  assert.doesNotMatch(patch, /session-delete|dsh-codex-subscription|ChatGPT\s*\/\s*Codex/i)
  assert.doesNotMatch(`${chinese}\n${english}`, /dsh-codex-subscription|ChatGPT\s*\/\s*Codex/i)
  assert.match(chinese, /全新安装[\s\S]+永久删除会话/)
  assert.match(english, /fresh install[\s\S]+permanent session deletion/i)
})

test('finished products verify and smoke the visual market through the real DSH host', async () => {
  const [runtime, smoke, browserSmoke, workflow, windows, mac, linux] = await Promise.all([
    read('scripts/verify-runtime.mjs'),
    read('scripts/smoke-plugin-marketplace.mjs'),
    read('scripts/smoke-windows-tray-bridge.mjs'),
    read('.github/workflows/ci.yml'),
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
  ])

  assert.match(runtime, /dshmarket\/package\.json/)
  assert.match(runtime, /dshmarket\/client/)
  assert.match(runtime, /marketManifest\.version[^\n]+1\.16\.0/)
  assert.match(smoke, /\/dsh-market\/status/)
  assert.match(smoke, /\/dsh-market\/installed/)
  assert.match(smoke, /dsh-native-session-delete/)
  assert.match(smoke, /--dump-config/)
  assert.match(smoke, /ui-workspace-session-delete/)
  assert.match(smoke, /ui-workspace[\s\S]+disabled/)
  assert.match(smoke, /\/dsh-market\/registry/)
  assert.match(smoke, /registry[^\n]+plugins/)
  assert.match(smoke, /plugins\.length\s*>=\s*1_000/)
  assert.match(smoke, /canonicalPluginIdentity/)
  assert.match(smoke, /plugin\.page/)
  assert.match(smoke, /plugin\.screenshots/)
  assert.match(browserSmoke, /Plugin Market/)
  assert.match(browserSmoke, /Search plugins/)
  assert.match(browserSmoke, /installButtons/)
  assert.equal((workflow.match(/smoke-plugin-marketplace\.mjs/g) || []).length, 3)

  for (const build of [windows, mac, linux]) {
    assert.match(build, /dsh-market-LICENSE\.txt/)
  }
})

test('the built-in market resolves from the movable profile fallback after a folder move', async () => {
  const core = await import('../launcher/portable-core.mjs')
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-market-fallback-'))
  const first = path.join(parent, 'first')
  const second = path.join(parent, 'second')
  try {
    const marketRoot = path.join(first, 'app', 'node_modules', 'dshmarket')
    const bridgeRoot = path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge')
    await mkdir(marketRoot, { recursive: true })
    await mkdir(bridgeRoot, { recursive: true })
    await writeFile(path.join(marketRoot, 'package.json'), '{"name":"dshmarket"}\n')
    await writeFile(path.join(bridgeRoot, 'package.json'), '{"name":"@wsl043/dsh-portable-desktop-bridge"}\n')

    const layout = core.layoutForRoot(first, process.platform)
    await core.ensureDesktopBridgeFallback(layout)
    assert.equal(await realpath(layout.pluginMarketFallback), await realpath(marketRoot))

    await rename(first, second)
    const moved = core.layoutForRoot(second, process.platform)
    await core.ensureDesktopBridgeFallback(moved)
    assert.equal(await realpath(moved.pluginMarketFallback), await realpath(path.join(second, 'app', 'node_modules', 'dshmarket')))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('release candidates never replace the stable automatic-update channel', async () => {
  const [workflow, policy] = await Promise.all([
    read('.github/workflows/publish.yml'),
    import('../scripts/version-policy.mjs'),
  ])
  assert.equal(policy.classifyProductVersion('0.4.0').updateChannelTag, 'update-channel-stable')
  assert.equal(policy.classifyProductVersion('0.4.0-rc.2').updateChannelTag, 'update-channel-candidate')
  assert.match(workflow, /UPDATE_CHANNEL_TAG:\s*\$\{\{ steps\.version\.outputs\.updateChannelTag \}\}/)
  assert.match(workflow, /if \[ "\$RELEASE_CHANNEL" = stable \]; then[\s\S]+update-channel-candidate/)
})
