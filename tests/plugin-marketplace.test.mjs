import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  assert.deepEqual(await readdir(path.join(root, 'app/vendor/dsh-portable-plugin-market/lib')), ['index.js'])
  assert.ok((await stat(path.join(root, 'app/vendor/dsh-portable-plugin-market/lib/index.js'))).size < 200_000)
  assert.ok((await stat(path.join(root, 'app/vendor/dsh-portable-plugin-market/client/client.js'))).size < 220_000)
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
  const [processLayer, restartLayer] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/dsh-cli.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/restart.ts'),
  ])

  assert.match(processLayer, /function spawnShim[\s\S]+windowsHide:\s*true/)
  assert.match(processLayer, /spawn\('taskkill',[\s\S]+windowsHide:\s*true/)
  assert.match(restartLayer, /spawn\(nodeExecutable\(\),[\s\S]+windowsHide:\s*true/)
  assert.match(restartLayer, /child = spawn\(file, args, \{[\s\S]+windowsHide: true/)
})

test('the market keeps implementation metadata and support controls out of the primary header', async () => {
  const [section, operations, styles, source] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/OperationsPanel.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/Market.module.css'),
    read('app/vendor/dsh-portable-plugin-market/src/routes.ts'),
  ])

  const header = section.match(/<div className=\{css\.titleRow\}>[\s\S]*?<div className=\{css\.tabs\}>/)?.[0] ?? ''
  assert.doesNotMatch(header, /DSH-Portable|versionHint|doExportLog/)
  assert.doesNotMatch(section, /doExportLog|\/dsh-market\/logs|exportState/)
  assert.doesNotMatch(source, /exportLogs|\/dsh-market\/logs/)
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

    const esmClient = path.join(profile, 'node_modules', 'esm-client')
    await mkdir(esmClient, { recursive: true })
    await writeFile(path.join(esmClient, 'package.json'), JSON.stringify({ name: 'esm-client', dsh: { client: {} }, exports: { './client': './client.js' } }))
    await writeFile(path.join(esmClient, 'client.js'), 'export const ready = true')
    await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: { 'broken-client': '1.0.0', 'esm-client': '1.0.0' } }))

    assert.equal(typeof verify.brokenClientBundles, 'function')
    assert.equal(typeof verify.newlyBrokenBundles, 'function')
    assert.deepEqual(verify.brokenClientBundles('web', profile).map(entry => entry.name), ['broken-client'])
    assert.deepEqual(
      verify.newlyBrokenBundles(
        [{ name: 'already-broken', reason: 'old' }],
        [{ name: 'already-broken', reason: 'old' }, { name: 'newly-broken', reason: 'new' }],
      ),
      [{ name: 'newly-broken', reason: 'new' }],
    )

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

test('uninstall refuses to orphan user-authored patch references', async () => {
  const [patchSource, routes] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/patch.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/routes.ts'),
  ])
  assert.match(patchSource, /export function userPatchPackageReferences/)
  assert.match(patchSource, /row\.group === true && Array\.isArray\(row\.config\)/)
  assert.match(patchSource, /name === packageName \|\| name\.startsWith\(`\$\{packageName\}\/`\)/)
  const uninstall = routes.slice(routes.indexOf("path: '/dsh-market/uninstall'"), routes.indexOf("path: '/dsh-market/rollback'"))
  assert.match(uninstall, /userPatchPackageReferences/)
  assert.match(uninstall, /userPatchReferenced/)
  assert.match(uninstall, /userPatchInspectionFailed/)
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
  const section = await read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx')
  const initialEffect = section.match(/useEffect\(\(\) => \{\s*void loadCatalog\(\)[\s\S]*?\n\s*\}, \[refreshInstalled, loadCatalog\]\)/)?.[0] ?? ''

  assert.match(initialEffect, /refreshInstalled\(true\)/)
  assert.doesNotMatch(initialEffect, /refreshInstalled\(\)\s*$/m)
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
  const routes = await read('app/vendor/dsh-portable-plugin-market/src/routes.ts')
  const updateRoute = routes.slice(routes.indexOf("path: '/dsh-market/update'"), routes.indexOf("path: '/dsh-market/setup-pnpm'"))
  const confirmation = updateRoute.indexOf('confirmationRequired: true')
  const mutation = updateRoute.indexOf('await runPlugin(config.profile, addArgs)')

  assert.ok(confirmation >= 0, 'fresh releases must produce an explicit confirmation response')
  assert.ok(mutation >= 0, 'test fixture must include the real plugin mutation boundary')
  assert.ok(confirmation < mutation, 'confirmation must happen before pnpm changes the profile')
  assert.match(updateRoute, /if \(!force && !isGit[\s\S]*latestPublishedRecently\(name\)/)
  assert.match(updateRoute, /staleReason:\s*'release-age'/)
  assert.match(updateRoute, /force:[\s\S]*RELEASE_AGE_OVERRIDE/)

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

test('catalog release archives are accepted only when bound to the entry repository', async () => {
  const { installTargetFor } = await import('../app/vendor/dsh-portable-plugin-market/src/sources.ts')
  const own = 'https://github.com/example/plugin/releases/download/v1.2.3/plugin-1.2.3.tgz'

  assert.equal(installTargetFor({ url: 'https://github.com/example/plugin', tarball: own }), own)
  assert.equal(
    installTargetFor({
      url: 'https://github.com/example/plugin',
      tarball: 'https://github.com/other/repo/releases/download/v1/plugin.tgz',
    }),
    'github:example/plugin',
  )
  assert.equal(
    installTargetFor({
      url: 'https://github.com/example/plugin',
      tarball: 'https://release-assets.githubusercontent.com/unsafe/plugin.tgz',
    }),
    'github:example/plugin',
  )
})

test('a half-failed uninstall can atomically remove a vanished plugin from both manifest lists', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshm-half-uninstall-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { keep: '1.0.0', ghost: '2.0.0' },
    dsh: { profile: { bundles: ['keep', 'ghost'] } },
  }, null, 2))
  const { dropFromManifest } = await import('../app/vendor/dsh-portable-plugin-market/src/profile.ts')

  assert.equal(dropFromManifest('web', 'ghost', root), true)
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dependencies, { keep: '1.0.0' })
  assert.deepEqual(manifest.dsh.profile.bundles, ['keep'])
  assert.equal(dropFromManifest('web', 'ghost', root), false)
})

test('a failed install restores the exact dependency and bundle state without touching other profile fields', async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'dshm-failed-install-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const manifestFile = path.join(profile, 'package.json')
  await writeFile(manifestFile, JSON.stringify({
    name: 'profile',
    dependencies: { keep: '1.0.0' },
    dsh: { profile: { bundles: ['keep'], preset: 'standard' } },
    portableMarker: { preserve: true },
  }, null, 2))
  const {
    readProfileManifestSnapshot,
    restoreProfileManifest,
  } = await import('../app/vendor/dsh-portable-plugin-market/src/profile.ts')

  const snapshot = readProfileManifestSnapshot('web', profile)
  await writeFile(manifestFile, JSON.stringify({
    name: 'profile',
    dependencies: { keep: '1.0.0', ghost: '2.0.0' },
    dsh: { profile: { bundles: ['keep', 'ghost'], preset: 'standard' } },
    portableMarker: { preserve: true },
  }, null, 2))

  assert.deepEqual(restoreProfileManifest('web', snapshot, profile).sort(), ['ghost'])
  const restored = JSON.parse(await readFile(manifestFile, 'utf8'))
  assert.deepEqual(restored.dependencies, { keep: '1.0.0' })
  assert.deepEqual(restored.dsh.profile, { bundles: ['keep'], preset: 'standard' })
  assert.deepEqual(restored.portableMarker, { preserve: true })
})

test('manifest rollback preserves whether the bundle field existed and its exact order', async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'dshm-bundle-shape-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const manifestFile = path.join(profile, 'package.json')
  const {
    readProfileManifestSnapshot,
    restoreProfileManifest,
  } = await import('../app/vendor/dsh-portable-plugin-market/src/profile.ts')

  await writeFile(manifestFile, JSON.stringify({ dependencies: {}, dsh: { profile: { preset: 'standard' } } }, null, 2))
  const absent = readProfileManifestSnapshot('web', profile)
  await writeFile(manifestFile, JSON.stringify({ dependencies: {}, dsh: { profile: { preset: 'standard', bundles: ['ghost'] } } }, null, 2))
  assert.deepEqual(restoreProfileManifest('web', absent, profile), ['ghost'])
  assert.equal(Object.hasOwn(JSON.parse(await readFile(manifestFile, 'utf8')).dsh.profile, 'bundles'), false)

  await writeFile(manifestFile, JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['b', 'a', 'b'] } } }, null, 2))
  const ordered = readProfileManifestSnapshot('web', profile)
  await writeFile(manifestFile, JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['a', 'b'] } } }, null, 2))
  assert.deepEqual(restoreProfileManifest('web', ordered, profile), ['dsh.profile.bundles'])
  assert.deepEqual(JSON.parse(await readFile(manifestFile, 'utf8')).dsh.profile.bundles, ['b', 'a', 'b'])
})

test('post-operation health detects only newly unresolved profile bundles', async (t) => {
  const { introducedUnresolvedBundles } = await import('../app/vendor/dsh-portable-plugin-market/src/profile.ts')
  assert.deepEqual(introducedUnresolvedBundles(['old'], ['old', 'ghost']), ['ghost'])
  assert.deepEqual(introducedUnresolvedBundles(['old'], ['old']), [])
  assert.deepEqual(introducedUnresolvedBundles(['old'], ['new', 'new']), ['new'])
})

test('install and update routes gate success on post-operation profile health', async () => {
  const routes = await read('app/vendor/dsh-portable-plugin-market/src/routes.ts')
  assert.match(routes, /introducedUnresolvedBundles/)
  assert.match(routes, /installBootBefore/)
  assert.match(routes, /updateBootBefore/)
  assert.match(routes, /profile-health/)
})

test('diagnostics classify peer mismatches before exposing repair actions', async () => {
  const [routes, diagnostics, promptSource, locales] = await Promise.all([
    read('app/vendor/dsh-portable-plugin-market/src/routes.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/client/Diagnostics.tsx'),
    read('app/vendor/dsh-portable-plugin-market/src/client/ai-fix.ts'),
    read('app/vendor/dsh-portable-plugin-market/src/client/locales.ts'),
  ])

  assert.match(routes, /row\.verdict\s*=\s*row\.satisfied === false[\s\S]*classifyPeer/)
  assert.match(diagnostics, /peerRisk/)
  assert.match(diagnostics, /peerWarning/)
  assert.match(diagnostics, /catRisk > 0/)
  assert.match(promptSource, /aiFixDetect/)
  assert.match(promptSource, /aiFixIfSelf/)
  assert.match(locales, /aiFixDetect:/)
  assert.match(locales, /aiFixIfSelf:/)
})

test('workspace and unknown peer protocols never become false incompatibility warnings', async () => {
  const source = await read('app/vendor/dsh-portable-plugin-market/src/check.ts')
  assert.match(source, /const workspaceSemver = \/workspace:/)
  assert.match(source, /normalizedRange = range\.replace\(workspaceSemver/)
  assert.match(source, /if \(parseSemver\(target\) === null\) return null/)
  assert.match(source, /if \(outcomes\.some\(out => out === null\)\) return null/)
})

test('catalog entries remain visible when upstream assigns more than one category', async () => {
  const { visiblePlugins, themePlugins } = await import('../app/vendor/dsh-portable-plugin-market/src/client/market-data.ts')
  const plugin = {
    name: 'multi', owner: 'author', url: 'https://github.com/author/multi',
    category: ['ui', 'theme'], description: { en: 'test' },
  }
  assert.deepEqual(visiblePlugins([plugin], { category: 'ui', query: '', lang: 'en', sort: 'stars-desc' }), [plugin])
  assert.deepEqual(themePlugins([plugin]), [plugin])
})

test('an in-flight install remains visible after the settings page remounts', async () => {
  const section = await read('app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx')
  assert.match(section, /dshm-pending[\s\S]*name:\s*plugin\.name/)
  assert.match(section, /recovered-install:/)
  assert.match(section, /record\.url === busyUrl[\s\S]*state:\s*'done'/)
  assert.match(section, /record\.url === busyUrl[\s\S]*state:\s*'failed'/)
})

test('GitHub plugin update checks use the unmetered git ref advertisement', async () => {
  const source = await read('app/vendor/dsh-portable-plugin-market/src/updates.ts')
  assert.match(source, /export function parseGitHeadAdvertisement/)
  assert.ok(source.includes('return /([0-9a-f]{40}) HEAD/.exec(payload)?.[1] ?? null'))
  assert.match(source, /info\/refs\?service=git-upload-pack/)
  assert.doesNotMatch(source, /api\.github\.com\/repos\/\$\{gh\[1\]\}\/commits\/HEAD/)
})

test('plugin profile transfer is presented as plugin sync, not full Portable backup', async () => {
  const locales = await read('app/vendor/dsh-portable-plugin-market/src/client/locales.ts')
  assert.match(locales, /tabBackup:\s*'插件同步'/)
  assert.match(locales, /tabBackup:\s*'Plugin sync'/)
  assert.match(locales, /会话、通用设置和凭据请使用 Portable/)
  assert.match(locales, /Use Portable Data and migration for sessions, general settings, and credentials/)
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
