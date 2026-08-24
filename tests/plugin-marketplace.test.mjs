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

test('the 0.4 product line pins one live visual catalog and no curated extension cards', async () => {
  const [product, app, lock, patch, chinese, english] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('app/package.json').then(JSON.parse),
    read('app/package-lock.json').then(JSON.parse),
    read('desktop-bridge/cordis.patch.yml'),
    read('README.md'),
    read('README.en.md'),
  ])

  assert.match(product.version, /^0\.4\.\d+(?:-rc\.[1-9]\d*)?$/)
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
  assert.match(section, /href=\{p\.url\}/)
  assert.doesNotMatch(section, /className=\{css\.nameLink\}\s+href=\{p\.page/)
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

test('market provenance is explicit in the distribution notice without occupying product UI', async () => {
  const notice = await read('NOTICE.md')
  assert.match(notice, /https:\/\/github\.com\/dsh-market\/dsh-market/)
  assert.match(notice, /https:\/\/github\.com\/deepseek-ai\/awesome-dsh-plugin/)
})

test('the screenshot lightbox owns its portal container instead of sharing document.body with the host root', async () => {
  const [section, builtClient] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx'),
    read('app/vendor/dsh-portable-plugin-market/client/client.js'),
  ])
  assert.match(section, /data-dsh-market-portal/)
  assert.match(section, /marketPortalHost\(\)/)
  assert.doesNotMatch(section, /createPortal\([\s\S]{0,1800}document\.body/)
  assert.match(builtClient, /data-dsh-market-portal/)
})

test('the Portable market carries applicable upstream safety fixes as independently tested contracts', async () => {
  const [{ classifyPnpmFailure }, verify, backup, patchSource, compatibilitySource] = await Promise.all([
    import('../app/vendor/dsh-portable-plugin-market/src/pnpm-compat.ts'),
    import('../app/vendor/dsh-portable-plugin-market/src/verify.ts'),
    import('../app/vendor/dsh-portable-plugin-market/src/backup.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/patch.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/compatibility.ts'),
  ])

  assert.equal(classifyPnpmFailure('ERR_PNPM_UNEXPECTED_STORE Unexpected store location')?.code, 'unexpected-store')
  assert.equal(classifyPnpmFailure('ERR_PNPM_PATCH_FAILED Could not apply patch C:/p/a.patch')?.code, 'patch-failed')

  assert.match(compatibilitySource, /export function introducedDuplicateNames/)
  assert.match(compatibilitySource, /before\.duplicateNames[\s\S]+after\.duplicateNames\.filter/)

  const root = await mkdtemp(path.join(os.tmpdir(), 'dshm-safety-'))
  try {
    assert.match(patchSource, /export function carrierDisableIds/)
    assert.match(patchSource, /disabled === true/)

    const profile = path.join(root, 'profile')
    const client = path.join(profile, 'node_modules', 'broken-client')
    await mkdir(client, { recursive: true })
    await writeFile(path.join(client, 'package.json'), JSON.stringify({ name: 'broken-client', dsh: { client: {} }, exports: { './client': './client.js' } }))
    await writeFile(path.join(client, 'client.js'), 'function {')
    assert.equal(verify.checkClientBundle('web', 'broken-client', profile).ok, false)

    const files = path.join(root, 'backup-source')
    await mkdir(files, { recursive: true })
    await writeFile(path.join(files, 'package.json'), JSON.stringify({ name: 'profile' }))
    await writeFile(path.join(files, 'keep.txt'), 'ok')
    await writeFile(path.join(files, 'package.json.bak-asm'), 'stale')
    const archive = backup.createProfileBackup('web', files)
    assert.ok(archive.files.some((file) => file.path === 'keep.txt'))
    assert.equal(archive.files.some((file) => /\.bak\b/.test(file.path)), false)

    assert.deepEqual(backup.unportableDeps({
      portable: '^1.0.0',
      absoluteFile: 'file:C:\\work\\plugin',
      absoluteLink: 'link:/opt/plugin',
      relativeFile: 'file:../plugin',
    }), [
      { name: 'absoluteFile', spec: 'file:C:\\work\\plugin' },
      { name: 'absoluteLink', spec: 'link:/opt/plugin' },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('all activation cleanups run on uninstall and unpublished host peers get one scoped retry', async () => {
  const [routes, install] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/routes.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/install.ts'),
  ])
  assert.match(routes, /const unmounted = await hotUnmount\(name\)[\s\S]{0,240}await themes\.setEntryDisabled\(name, true\)/)
  assert.match(install, /AUTO_INSTALL_PEERS_OFF\s*=\s*'--config\.auto-install-peers=false'/)
  assert.match(install, /isUnpublishedHostPeer/)
})

test('the host-peer retry is scoped to DSH runtime peers and runs at most once', async () => {
  const { withHoistRecovery, AUTO_INSTALL_PEERS_OFF } = await import('../app/vendor/dsh-portable-plugin-market/src/install.ts')
  const profile = await mkdtemp(path.join(os.tmpdir(), 'dshm-host-peer-'))
  try {
    await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    const calls = []
    const run = async (_profile, args) => {
      calls.push(args)
      if (calls.length === 1) {
        return {
          exitCode: 1, timedOut: false, cancelled: false, stdout: '',
          stderr: 'ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/@deepseek-ai%2Fdsh-runtime: Not Found - 404\nThis error happened while installing a direct dependency',
        }
      }
      return { exitCode: 0, timedOut: false, cancelled: false, stdout: 'ok', stderr: '' }
    }
    const result = await withHoistRecovery(run, 'web', ['add', 'demo'], profile)
    assert.equal(result.exitCode, 0)
    assert.deepEqual(calls, [
      ['add', 'demo'],
      ['add', AUTO_INSTALL_PEERS_OFF, 'demo'],
    ])

    calls.length = 0
    const ordinary = async (_profile, args) => {
      calls.push(args)
      return {
        exitCode: 1, timedOut: false, cancelled: false, stdout: '',
        stderr: 'ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/ordinary-missing: Not Found - 404',
      }
    }
    await withHoistRecovery(ordinary, 'web', ['add', 'ordinary-missing'], profile)
    assert.deepEqual(calls.filter((args) => args[0] === 'add'), [['add', 'ordinary-missing']])
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
})

test('opening the market revalidates installed-plugin updates instead of serving the 30-minute cache', async () => {
  const [section, builtClient] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx'),
    read('app/vendor/dsh-portable-plugin-market/client/client.js'),
  ])
  const initialEffect = section.match(/useEffect\(\(\) => \{\s*void loadCatalog\(\)[\s\S]*?\n\s*\}, \[refreshInstalled, loadCatalog\]\)/)?.[0] ?? ''

  assert.match(initialEffect, /refreshInstalled\(true\)/)
  assert.doesNotMatch(initialEffect, /refreshInstalled\(\)\s*$/m)
  assert.match(builtClient, /refreshInstalled\(true\)/)
})

test('plugin updates remain visible in the market activity panel', async () => {
  const section = await read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx')
  const updateFlow = section.slice(section.indexOf('const doUpdate ='), section.indexOf('const doUseSkin ='))
  assert.match(updateFlow, /kind:\s*'update'/)
  assert.match(updateFlow, /state:\s*'running'/)
  assert.match(updateFlow, /state:\s*'done'/)
  assert.match(updateFlow, /state:\s*'failed'/)
  assert.match(updateFlow, /drop\(list, updateRecordId\)/)
})

test('a newly published plugin asks for confirmation before pnpm mutates the profile', async () => {
  const [routes, builtRoutes] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/routes.ts'),
    read('app/vendor/dsh-portable-plugin-market/lib/routes.js'),
  ])
  const updateRoute = routes.slice(routes.indexOf("path: '/dsh-market/update'"), routes.indexOf("path: '/dsh-market/setup-pnpm'"))
  const confirmation = updateRoute.indexOf('confirmationRequired: true')
  const mutation = updateRoute.indexOf('await runPlugin(config.profile, addArgs)')

  assert.ok(confirmation >= 0, 'fresh releases must produce an explicit confirmation response')
  assert.ok(mutation >= 0, 'test fixture must include the real plugin mutation boundary')
  assert.ok(confirmation < mutation, 'confirmation must happen before pnpm changes the profile')
  assert.match(updateRoute, /if \(!force && !isGit[\s\S]*latestPublishedRecently\(name\)/)
  assert.match(updateRoute, /staleReason:\s*'release-age'/)
  assert.match(updateRoute, /force:[\s\S]*RELEASE_AGE_OVERRIDE/)
  assert.match(builtRoutes, /confirmationRequired:\s*true/)

  const client = await read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx')
  assert.match(client, /body\.confirmationRequired === true[\s\S]*setFreshReleaseConfirmation/)
})

test('fresh-release confirmation is a plugin-scoped warning rather than a global error', async () => {
  const [client, locales, styles] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/locales.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/client/Market.module.css'),
  ])

  assert.match(client, /freshReleaseConfirmation/)
  assert.match(client, /confirmationRequired === true[\s\S]*setFreshReleaseConfirmation/)
  assert.match(client, /className=\{css\.banner\}[\s\S]*freshReleaseConfirmation[\s\S]*doUpdate\(freshReleaseConfirmation\.name, true\)/)
  assert.match(locales, /freshUpdateConfirm:/)
  assert.match(styles, /\.banner\s*\{/)
})

test('AI repair prompt does not recommend bundle surgery for peer-range-only warnings', async () => {
  const [diagnostics, promptSource, locales] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/client/Diagnostics.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/ai-fix.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/client/locales.ts'),
  ])

  assert.match(diagnostics, /buildAiFixPrompt\(report, t\)/)
  assert.match(promptSource, /peerRangeOnly/)
  assert.match(promptSource, /peerRangeOnly \? 'aiFixPeerRange' : 'aiFixScope'/)
  assert.match(locales, /aiFixPeerRange:/)

  const { buildAiFixPrompt } = await import('../app/vendor/dsh-portable-plugin-market/src/client/ai-fix.ts')
  const messages = {
    aiFixIntro: 'repair {0}', checkErrors: 'errors', checkWarnings: 'warnings', catOrder: 'order',
    aiFixPeerRange: 'UPDATE THE PLUGIN; DO NOT EDIT THE PROFILE', aiFixScope: 'EDIT BUNDLES', aiFixConservative: 'ONLY THIS ISSUE',
  }
  const prompt = buildAiFixPrompt({
    profile: 'portable/web', duplicates: [], multiVersion: [], orderConflicts: [],
    peerMismatches: [{ satisfied: false }, { satisfied: true }, { satisfied: null }],
    summary: { errors: [], warnings: ['plugin peer range does not match host'] },
  }, key => messages[key])
  assert.match(prompt, /UPDATE THE PLUGIN/)
  assert.doesNotMatch(prompt, /EDIT BUNDLES/)
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
  assert.match(smoke, /plugin\.screenshots/)
  assert.match(browserSmoke, /Plugin Market/)
  assert.match(browserSmoke, /Search plugins/)
  assert.match(browserSmoke, /installButtons/)
  assert.match(browserSmoke, /screenshots/)
  assert.match(browserSmoke, /projectHref/)
  assert.match(browserSmoke, /projectHref:\s*plugin\.url/)
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
