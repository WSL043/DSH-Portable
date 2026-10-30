import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assertMaintenanceReadOnly } from '../scripts/smoke-windows-market-categories.mjs'

const vendor = path => new URL(`../app/vendor/dsh-portable-plugin-market/${path}`, import.meta.url)

test('the Portable market reports whether the official market bundle is on in the active profile', async () => {
  const routes = await readFile(vendor('src/routes.ts'), 'utf8')
  const at = routes.indexOf("path: '/dsh-market/official-market'")
  assert.ok(at !== -1)
  const route = routes.slice(at, at + 900)
  assert.ok(route.includes("allow: 'GET'"))
  assert.ok(route.includes('readProfileBundles(activeProfileDir).includes(OFFICIAL_MARKET_BUNDLE)'))
  assert.ok(route.includes('active: false'), 'an unreadable profile is not claimed as an active official market')
  assert.ok(routes.includes("const OFFICIAL_MARKET_BUNDLE = '@deepseek-ai/dsh-experimental-plugin-market-bundle'"))
})

test('the shipped server bundle serves the official-market route', async () => {
  const bundle = await readFile(vendor('lib/index.js'), 'utf8')
  assert.ok(bundle.includes('/dsh-market/official-market'), 'rebuild the market server bundle')
  const client = await readFile(vendor('client/client.js'), 'utf8')
  assert.ok(!client.includes('/dsh-market/official-market'), 'current manager availability must not be inferred from official market activation')
})

test('official management has no Advanced tab and More only imports legacy plugin configuration', async () => {
  const [entry, action, maintenance, locales] = await Promise.all([
    readFile(vendor('src/client/index.ts'), 'utf8'),
    readFile(vendor('src/client/MarketAction.tsx'), 'utf8'),
    readFile(vendor('src/client/Maintenance.tsx'), 'utf8'),
    readFile(vendor('src/client/locales.ts'), 'utf8'),
  ])
  assert.doesNotMatch(entry, /dsh-portable-plugin-advanced|navAdvanced/)
  assert.match(entry, /official:\s*\(\) => \(\) => \{\}/)
  assert.match(action, /return\s*(?:\(\s*)?<MarketErrorBoundary\s+view=(['"])installed\1\s*>\s*<PluginUpdateStatus\b/)
  assert.doesNotMatch(action, /useOfficialMarket|MarketSection|<Modal|<Button/)
  assert.doesNotMatch(action, /navAdvanced/)
  assert.match(entry, /typeof primitives\.MenuItemButton !== 'function'[\s\S]+spec\?\.kind !== 'list' \|\| spec\.scope !== 'root'/)
  assert.match(entry, /inject\('shell\.overlay',[\s\S]+inject\('sidebar\.panellist\.actions'/)
  assert.match(entry, /id: 'dsh-portable-plugin-maintenance-overlay'/)
  assert.match(maintenance, /<MenuItemButton onSelect=\{\(\) => \{ props\.onDismiss\(\); props\.controller\.show\(\) \}\}>/)
  assert.doesNotMatch(maintenance, /Diagnostics|ActivationSnapshot|DisclosureRow|StateDot|\/dsh-market\/(?:backup|installed|check)/)
  assert.match(maintenance, /if \(!file \|\| !confirming \|\| running\.current\) return/)
  assert.match(maintenance, /file\.size > 2 \* 1024 \* 1024/)
  assert.match(maintenance, /JSON\.parse\(await file\.text\(\)\)[\s\S]+fetch\('\/dsh-market\/restore', \{\s+method: 'POST'/)
  assert.match(maintenance, /if \(running\.current\) return\s+setConfirming\(false\)\s+setFile\(null\)\s+if \(fileInput\.current\) fileInput\.current\.value = ''/)
  assert.match(locales, /maintenanceTitle:\s*(['"])旧插件配置恢复\1/)
  assert.match(locales, /maintenanceTitle:\s*(['"])Legacy plugin recovery\1/)
  assert.match(locales, /新备份请使用 设置 → 桌面与数据 → 迁移与备份/)
  assert.match(locales, /For new backups, use Settings → Desktop & data → Migration & backup/)

})

test('every chunk the shipped server bundle imports exists, and no stale chunk is left behind', async () => {
  const { readdir } = await import('node:fs/promises')
  const lib = vendor('lib/')
  const files = (await readdir(lib)).filter(name => name.endsWith('.js'))
  const referenced = new Set(['index.js'])
  for (const name of files) {
    const source = await readFile(new URL(name, lib), 'utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["']\.\/([^"']+\.js)["']/gu)) {
      assert.ok(files.includes(match[1]), `${name} imports ./${match[1]}, which is not in the shipped lib directory; copy the whole build output, not only index.js`)
      referenced.add(match[1])
    }
  }
  for (const name of files) {
    if (name === 'import-preflight.js') continue
    assert.ok(referenced.has(name), `${name} is not imported by any shipped chunk (stale build output)`)
  }
})

test('the shipped server bundle carries the update support for index-installed plugins', async () => {
  const { readdir } = await import('node:fs/promises')
  const lib = vendor('lib/')
  let all = ''
  for (const name of (await readdir(lib)).filter(file => file.endsWith('.js'))) all += await readFile(new URL(name, lib), 'utf8')
  assert.ok(all.includes('git+https://github.com/'), 'pinned-commit specs are rebuilt for the next commit')
  assert.ok(all.includes('&path:/'), 'a monorepo sub-directory is kept')
  assert.ok(all.includes('releases'), 'release tarballs are recognised')
  assert.ok(all.includes("kind:`pinned`") || all.includes('kind: "pinned"') || all.includes("kind:'pinned'") || all.includes('pinned'), 'the pinned rollback source exists')
})

test('official-owned fallback skips Portable updates while the legacy installed view still refreshes them', async () => {
  const { stripTypeScriptTypes } = await import('node:module')
  const { runInNewContext } = await import('node:vm')
  const section = (await readFile(vendor('src/client/MarketSection.tsx'), 'utf8')).replaceAll('\r\n', '\n')
  const start = section.indexOf('  const refreshInstalled = useCallback(')
  const end = section.indexOf('\n  /** Lookup set', start)
  assert.ok(start >= 0 && end > start)
  const executable = stripTypeScriptTypes(section.slice(start, end)) + '\nrefreshInstalled'
  for (const officialUpdates of [true, false]) {
    const requests = []
    const context = {
      officialUpdates, useCallback: callback => callback,
      fetch: async url => { requests.push(url); return { json: async () => ({ installed: {} }) } },
      installedRepoIdentities: () => ({}), installedRepoHints: () => ({}),
    }
    for (const setter of ['setInstalled', 'setRepoIdentities', 'setRepoHints', 'setSkins', 'setDisabledNames',
      'setPatchDisabledNames', 'setGroups', 'setGroupOrder', 'setActivations', 'setHostDependencyFindings', 'setUpdates']) context[setter] = () => {}
    runInNewContext(executable, context)(true)
    await new Promise(setImmediate)
    assert.deepEqual(requests, officialUpdates
      ? ['/dsh-market/installed'] : ['/dsh-market/installed', '/dsh-market/updates?force=1'])
  }
  const totalsAt = section.indexOf("fetch('/dsh-market/download-totals'")
  const totalsStart = section.lastIndexOf('  useEffect(() => {', totalsAt)
  const totalsEnd = section.indexOf('\n  // Pending-restart', totalsAt)
  assert.ok(totalsStart >= 0 && totalsEnd > totalsStart)
  const totalsEffect = stripTypeScriptTypes(section.slice(totalsStart, totalsEnd))
  for (const [officialUpdates, view, expected] of [[true, 'installed', []], [false, 'installed', []], [true, 'discover', ['/dsh-market/download-totals']], [false, 'discover', ['/dsh-market/download-totals']]]) {
    const requests = []
    runInNewContext(totalsEffect, {
      officialUpdates, props: { view }, AbortController, useEffect: callback => callback(),
      fetch: async url => { requests.push(url); return { ok: false, json: async () => ({}) } },
      setDownloadTotalsState: () => {},
    })
    await new Promise(setImmediate)
    assert.deepEqual(requests, expected)
  }
  const membersAt = section.indexOf('{members.map(member => (')
  const memberRow = section.slice(membersAt, section.indexOf("{t('groupRemove')}", membersAt))
  assert.match(memberRow, /!officialUpdates && \(/)
  assert.match(memberRow, /officialUpdates && props\.onOfficialManage/)
  assert.ok(memberRow.includes('props.onOfficialManage!(member)'))
})

test('legacy recovery cancellation requires a valid API fixture and rejects writes or compatibility reassessment', () => {
  const reads = [{method:'GET',path:'/dsh-market/backup',status:200},
    {method:'GET',path:'/dsh-market/installed',status:200}]
  const fixture = {originMatched:true,path:'/dsh-market/backup',httpStatus:200,bytes:100,sha256:'a'.repeat(64),
    format:'dsh-profile-backup',version:0.2,packageJson:true,manifestMatches:true}
  assert.deepEqual(assertMaintenanceReadOnly(reads,fixture),{legacyExportApiCompatibility:true,diagnosticGets:0,installedReads:1,restorePosts:0,mutationRequests:0})
  for(const path of ['/dsh-market/restore','/dsh-market/groups','/dsh-market/use-skin','/dsh-market/install','/dsh-market/uninstall','/dsh-market/bundle-order'])
    assert.throws(()=>assertMaintenanceReadOnly([...reads,{method:'POST',path}],fixture),/must not mutate the profile/)
  assert.throws(()=>assertMaintenanceReadOnly([...reads,{method:'GET',path:'/dsh-market/check',status:200}],fixture),/second compatibility assessment/)
  assert.throws(()=>assertMaintenanceReadOnly(reads.slice(1),fixture),/actual legacy export API GET/)
  for(const invalid of [undefined,{...fixture,httpStatus:500},{...fixture,format:'other'},{...fixture,version:0.1},
    {...fixture,packageJson:false},{...fixture,manifestMatches:false},{...fixture,originMatched:false},
    {...fixture,bytes:0},{...fixture,bytes:2*1024*1024+1},{...fixture,sha256:'invalid'}])
    assert.throws(()=>assertMaintenanceReadOnly(reads,invalid),/valid owned profile fixture/)
})
