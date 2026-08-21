import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const read = (name) => readFile(path.join(root, name), 'utf8')

test('the bundled market explicitly declares each verified official DSH preview train', async () => {
  const [manifest, upstream] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/package.json').then(JSON.parse),
    read('upstream.lock.json').then(JSON.parse),
  ])
  const ranges = manifest.peerDependencies['@deepseek-ai/dsh-settings'].split(/\s*\|\|\s*/)
  assert.equal(new Set(ranges).size, ranges.length)
  assert.ok(ranges.every(range => /^\^\d+\.\d+\.\d+-rc\.\d+$/.test(range)))
  assert.ok(ranges.includes(`^${upstream.dsh.version}`))
})

test('the 0.4 market release pins one live visual catalog and no curated extension cards', async () => {
  const [product, app, lock, patch, chinese, english] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('app/package.json').then(JSON.parse),
    read('app/package-lock.json').then(JSON.parse),
    read('desktop-bridge/cordis.patch.yml'),
    read('README.md'),
    read('README.en.md'),
  ])

  assert.match(product.version, /^0\.4\.0(?:-rc\.[1-9]\d*)?$/)
  assert.equal(app.dependencies['@wsl043/dsh-portable-plugin-market'], 'file:vendor/dsh-portable-plugin-market')
  assert.equal(app.dependencies.dshmarket, undefined)

  const market = lock.packages['node_modules/@wsl043/dsh-portable-plugin-market']
  assert.equal(market.resolved, 'vendor/dsh-portable-plugin-market')
  assert.equal(market.link, true)
  assert.match(lock.packages['vendor/dsh-portable-plugin-market'].version, /^0\.1\.0-beta\.\d+$/)

  assert.match(patch, /id:\s*dsh-portable-plugin-market/)
  assert.match(patch, /name:\s*['"]@wsl043\/dsh-portable-plugin-market['"]/)
  assert.match(patch, /profile:\s*web/)
  assert.match(patch, /allowRestart:\s*false/)
  assert.doesNotMatch(patch, /session-delete|dsh-codex-subscription|ChatGPT\s*\/\s*Codex/i)
  assert.doesNotMatch(`${chinese}\n${english}`, /dsh-codex-subscription|ChatGPT\s*\/\s*Codex/i)
  assert.match(chinese, /全新安装[\s\S]+永久删除会话/)
  assert.match(english, /fresh install[\s\S]+permanent session deletion/i)
})

test('the packaged market ships runtime artifacts only', async () => {
  const manifest = JSON.parse(await read('app/vendor/dsh-portable-plugin-market/package.json'))
  assert.deepEqual(manifest.files, [
    'lib/*.js',
    'client/client.js',
    'cordis.patch.yml',
    'LICENSE',
    'NOTICE.md',
  ])
  assert.equal(manifest.files.some((entry) => entry === 'src' || entry.includes('*.map') || entry.includes('types')), false)
})

test('the Portable market is a native Plugins tab with readable cards and direct project links', async () => {
  const [app, market, registration, section, styles, clientBundle] = await Promise.all([
    read('app/package.json').then(JSON.parse),
    read('app/vendor/dsh-portable-plugin-market/package.json').then(JSON.parse),
    read('app/vendor/dsh-portable-plugin-market/src/client/index.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/Market.module.css'),
    read('app/vendor/dsh-portable-plugin-market/client/client.js'),
  ])

  assert.equal(app.dependencies['@wsl043/dsh-portable-plugin-market'], 'file:vendor/dsh-portable-plugin-market')
  assert.equal(market.name, '@wsl043/dsh-portable-plugin-market')
  assert.match(market.version, /^0\.1\.0-beta\.\d+$/)
  assert.match(registration, /ctx\.slots\.inject\('settings\.plugins\.tab'/)
  assert.match(registration, /name:\s*'settings\.plugins\.tab'/)
  assert.doesNotMatch(registration, /ctx\.slots\.inject\('settings\.section'/)
  assert.match(styles, /\.grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s)
  assert.doesNotMatch(styles, /\.grid\s*\{[^}]*repeat\(2/s)
  assert.match(styles, /\.cardShot\s*\{[^}]*width:\s*240px[^}]*height:\s*150px/s)
  assert.match(section, /dshm-market-view/)
  assert.match(section, /localStorage\.setItem\('dshm-market-view'/)
  assert.match(section, /aria-pressed=\{marketView === 'cards'\}/)
  assert.match(section, /aria-pressed=\{marketView === 'compact'\}/)
  assert.match(styles, /\.compactGrid\s*\{/)
  assert.match(styles, /\.compactCard\s+\.cardShots\s*\{[^}]*display:\s*none/s)
  assert.match(section, /href=\{p\.page\s*\|\|\s*p\.url\}/)
  assert.match(section, /className=\{css\.nameLink\}/)
  assert.match(section, /FishLogo/)
  assert.doesNotMatch(section, /function MarketLogo[\s\S]{0,500}<svg/)
  assert.match(styles, /\.logoMark\s*\{[^}]*color:\s*var\(--dsw-alias-label-primary/s)
  assert.doesNotMatch(styles, /\.logoPlug|@keyframes\s+dshmPlug\b/)
  assert.doesNotMatch(section, /https:\/\/github\.com\/dsh-market\/dsh-market/)
  assert.match(clientBundle, /^window\.__ModuleLoader__\.load\(\{\s*id:\s*"@wsl043\/dsh-portable-plugin-market"/)
})

test('the Portable market never flashes a console window for background commands on Windows', async () => {
  const [processLayer, restartLayer, builtProcessLayer, builtRestartLayer] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/dsh-cli.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/restart.ts'),
    read('app/vendor/dsh-portable-plugin-market/lib/dsh-cli.js'),
    read('app/vendor/dsh-portable-plugin-market/lib/restart.js'),
  ])

  for (const text of [processLayer, builtProcessLayer]) {
    assert.match(text, /function spawnShim[\s\S]+windowsHide:\s*true/)
    assert.match(text, /spawn\('taskkill',[\s\S]+windowsHide:\s*true/)
  }
  for (const text of [restartLayer, builtRestartLayer]) {
    assert.match(text, /spawn\(nodeExecutable\(\),[\s\S]+windowsHide:\s*true/)
    assert.match(text, /child = spawn\(file, args, \{[\s\S]+windowsHide: true/)
  }
})

test('the market keeps implementation metadata and support controls out of the primary header', async () => {
  const [section, operations, styles, source, builtRoutes] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/OperationsPanel.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/Market.module.css'),
    read('app/vendor/dsh-portable-plugin-market/src/routes.ts'),
    read('app/vendor/dsh-portable-plugin-market/lib/routes.js'),
  ])

  const header = section.match(/<div className=\{css\.titleRow\}>[\s\S]*?<div className=\{css\.tabs\}>/)?.[0] ?? ''
  assert.doesNotMatch(header, /DSH-Portable|versionHint|doExportLog/)
  assert.doesNotMatch(section, /doExportLog|\/dsh-market\/logs|exportState/)
  assert.doesNotMatch(source, /exportLogs|\/dsh-market\/logs/)
  assert.doesNotMatch(builtRoutes, /exportLogs|\/dsh-market\/logs/)
  assert.match(operations, /if \(records\.length === 0\) return null/)
  assert.doesNotMatch(operations, /opEntryQuiet/)
  assert.doesNotMatch(styles, /\.repoLink|\.version|\.opEntryQuiet/)
  assert.doesNotMatch(header, /marketUpdate|dshmarket|dsh-market/)
})

test('the Plugins page owns the title and the market starts directly at its tabs', async () => {
  const [section, styles, locales] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/Market.module.css'),
    read('app/vendor/dsh-portable-plugin-market/src/client/locales.ts'),
  ])

  assert.doesNotMatch(section, /className=\{css\.head\}|className=\{css\.titleRow\}|t\('subtitle'\)|t\('submitPlugin'\)/)
  assert.doesNotMatch(styles, /^\.(head|title|sub|submitLink)\b/m)
  assert.doesNotMatch(locales, /^\s*(subtitle|submitPlugin):/m)
  assert.match(section, /<div className=\{css\.root\}>\s*<div className=\{css\.tabs\}>/)
})

test('the Portable-owned market consumes Awesome directly without plugin-specific trust labels', async () => {
  const [registry, locales, routes, notice, manifest] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/registry.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/client/locales.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/routes.ts'),
    read('app/vendor/dsh-portable-plugin-market/NOTICE.md'),
    read('app/vendor/dsh-portable-plugin-market/package.json').then(JSON.parse),
  ])

  assert.match(registry, /https:\/\/awesome-dsh-plugin\.com\/plugins\.json/)
  assert.doesNotMatch(`${registry}\n${locales}\n${routes}`, /dsh-codex-subscription/i)
  assert.doesNotMatch(await read('app/vendor/dsh-portable-plugin-market/src/client/market-data.ts'), /looksTerminal|\bcli\b[^\n]+终端/i)
  assert.doesNotMatch(locales, /危险|恶意|dangerous|malicious|unsafe/i)
  assert.match(routes, /这个版本刚发布|newly published/i)
  assert.match(routes, /force/)
  assert.match(notice, /dsh-market/i)
  assert.match(notice, /MIT/i)
  assert.equal(manifest.homepage, 'https://github.com/WSL043/DSH-Portable')
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

  assert.match(runtime, /@wsl043\/dsh-portable-plugin-market\/package\.json/)
  assert.match(runtime, /@wsl043\/dsh-portable-plugin-market\/client/)
  assert.match(runtime, /assert\.match\(marketManifest\.version,\s*\/\^0\\\.1\\\.0-beta/s)
  assert.match(smoke, /\/dsh-market\/status/)
  assert.match(smoke, /\/dsh-market\/installed/)
  assert.match(smoke, /dsh-native-session-delete/)
  assert.match(smoke, /DEFAULT_PLUGINS/)
  assert.doesNotMatch(smoke, /['"]1\.0\.4['"]|['"]1\.0\.6['"]/) // version is read from the finished product
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
  assert.match(browserSmoke, /screenshots/)
  assert.match(browserSmoke, /projectHref/)
  assert.match(browserSmoke, /cardShot/)
  assert.match(browserSmoke, /persisted compact market view/)
  assert.match(browserSmoke, /localStorage\.getItem\('dshm-market-view'\)/)
  assert.equal((workflow.match(/smoke-plugin-marketplace\.mjs/g) || []).length, 3)

  for (const build of [windows, mac, linux]) {
    assert.match(build, /dsh-market-LICENSE\.txt/)
    assert.match(build, /app[\\/]vendor/)
  }
})

test('the built-in market resolves from the movable profile fallback after a folder move', async () => {
  const core = await import('../launcher/portable-core.mjs')
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-market-fallback-'))
  const first = path.join(parent, 'first')
  const second = path.join(parent, 'second')
  try {
    const marketRoot = path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-plugin-market')
    const bridgeRoot = path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge')
    await mkdir(marketRoot, { recursive: true })
    await mkdir(bridgeRoot, { recursive: true })
    await writeFile(path.join(marketRoot, 'package.json'), '{"name":"@wsl043/dsh-portable-plugin-market"}\n')
    await writeFile(path.join(bridgeRoot, 'package.json'), '{"name":"@wsl043/dsh-portable-desktop-bridge"}\n')

    const layout = core.layoutForRoot(first, process.platform)
    await core.ensureDesktopBridgeFallback(layout)
    assert.equal(await realpath(layout.pluginMarketFallback), await realpath(marketRoot))

    await rename(first, second)
    const moved = core.layoutForRoot(second, process.platform)
    await core.ensureDesktopBridgeFallback(moved)
    assert.equal(await realpath(moved.pluginMarketFallback), await realpath(path.join(second, 'app', 'node_modules', '@wsl043', 'dsh-portable-plugin-market')))
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
