import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { acquireRuntimeLease } from '../../launcher/runtime-capsule.mjs'
import { cleanWebViewCaches } from '../../launcher/webview-cache.mjs'
const digest = value => createHash('sha256').update(value).digest('hex')

export async function verifyRetiredWebViewCleanup({ root, output }) {
  const manifest = JSON.parse(await readFile(path.join(root, 'runtime/webview2/runtime-capsule.json'), 'utf8'))
  const base = path.join(root, 'acceptance-webview-cache')
  const retired = path.join(base, 'managed-v1', manifest.sha256)
  await access(path.join(retired, 'app/msedgewebview2.exe'))
  const nextProduct = await mkdtemp(path.join(output, 'next-generation-'))
  const legacy = await mkdtemp(path.join(base, 'legacy-fixture-'))
  const instance = (await readFile(path.join(root, 'data/portable-instance.id'), 'ascii')).trim()
  assert.match(instance, /^[a-f0-9]{32}$/)
  const location = createHash('sha256').update(path.resolve(root).toUpperCase()).digest('hex').slice(0, 32)
  const userData = path.join(process.env.LOCALAPPDATA, 'DSH-Portable/webview2', instance, location, 'EBWebView/Default')
  const snapshot = async () => {
    const files = {}
    const walk = async folder => {
      for (const entry of await readdir(folder, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) await walk(file)
        else if (entry.isFile()) files[path.relative(userData, file)] = createHash('sha256').update(await readFile(file)).digest('hex')
      }
    }
    for (const name of ['Network', 'Local Storage', 'IndexedDB']) await walk(path.join(userData, name))
    assert.ok(Object.keys(files).length > 0, 'actual WebView persistent profile data was not found')
    return files
  }
  try {
    await writeFile(path.join(legacy, 'keep'), 'legacy')
    await mkdir(path.join(nextProduct, 'runtime/webview2'), { recursive: true })
    await writeFile(path.join(nextProduct, 'runtime/webview2/runtime-capsule.json'), JSON.stringify({ ...manifest, sha256: randomBytes(32).toString('hex') }))
    let before
    const profileDeadline = Date.now() + 15000
    while (!before) {
      try { before = await snapshot() }
      catch (error) {
        if (error.code !== 'EBUSY' || Date.now() >= profileDeadline) throw error
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
    let result
    const deadline = Date.now() + 15000
    do {
      result = await cleanWebViewCaches(nextProduct, { env: { ...process.env, DSH_PORTABLE_WEBVIEW_CACHE: base }, measure: false })
      if (result.removed.some(item => item.hash === manifest.sha256)) break
      await new Promise(resolve => setTimeout(resolve, 200))
    } while (Date.now() < deadline)
    assert.ok(result.removed.some(item => item.hash === manifest.sha256), 'retired real runtime still protected or failed to delete after browser exit')
    await assert.rejects(access(retired), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(legacy, 'keep'), 'utf8'), 'legacy')
    assert.deepEqual(await snapshot(), before, 'cleanup altered persistent browser data')
    await writeFile(path.join(output, 'webview-after-exit.json'), JSON.stringify({ passed: true, realCapsule: manifest.sha256, retiredRuntimeRemoved: true, legacyPreserved: true, persistentProfileFilesUnchanged: Object.keys(before).length }))
  } finally {
    await rm(nextProduct, { recursive: true, force: true })
    await rm(legacy, { recursive: true, force: true })
  }
}

async function verifyStorageCleanup({ root, evaluate, until, click, output, nativePid, verifyWebView }) {
  const logs = path.join(root, 'data/dsh-home/profiles/web/.plugin-manager/logs')
  const cache = path.join(root, 'acceptance-runtime-cache')
  await mkdir(logs, { recursive: true })
  await mkdir(cache, { recursive: true })
  const oldLog = await mkdtemp(path.join(logs, 'operation-'))
  const recentLog = await mkdtemp(path.join(logs, 'operation-'))
  const oldRuntime = path.join(cache, randomBytes(32).toString('hex'))
  const activeRuntime = path.join(cache, randomBytes(32).toString('hex'))
  const webviewCache = path.join(root, 'acceptance-webview-cache/managed-v1')
  const webviewOld = path.join(webviewCache, randomBytes(32).toString('hex'))
  const webviewManifest = path.join(root, 'runtime/webview2/runtime-capsule.json')
  let originalManifest, protectedWebview, nativeLeases = [], browserLeases = []
  let release
  try {
    await mkdir(oldRuntime)
    await mkdir(activeRuntime)
    for (const directory of [oldRuntime, activeRuntime]) await writeFile(path.join(directory, 'sentinel'), 'owned acceptance fixture')
    release = await acquireRuntimeLease(activeRuntime)
    for (const directory of [oldLog, recentLog]) await writeFile(path.join(directory, 'pnpm.log'), 'owned acceptance fixture')
    const age = new Date(Date.now() - 30 * 86400000)
    await utimes(path.join(oldLog, 'pnpm.log'), age, age)
    if (verifyWebView) {
      originalManifest = await readFile(webviewManifest)
      const manifest = JSON.parse(originalManifest)
      protectedWebview = path.join(webviewCache, manifest.sha256)
      const records = []
      for (const file of await readdir(webviewCache)) {
        if (!file.startsWith(manifest.sha256 + '.lease.')) continue
        const record = JSON.parse(await readFile(path.join(webviewCache, file), 'utf8'))
        try { process.kill(record.pid, 0) } catch { continue }
        records.push(record)
        if (record.pid === nativePid) nativeLeases.push({ file: path.join(webviewCache, file), bytes: await readFile(path.join(webviewCache, file)) })
        else browserLeases.push({ file: path.join(webviewCache, file), bytes: await readFile(path.join(webviewCache, file)) })
      }
      assert.ok(nativeLeases.length, 'real native PID lease is missing')
      assert.ok(records.some(record => record.pid !== nativePid), 'real browser PID lease is missing')
      await mkdir(webviewOld)
      const oldHash = path.basename(webviewOld)
      await writeFile(path.join(webviewOld, '.webview-managed-v1.json'), JSON.stringify({ schemaVersion: 1, sha256: oldHash }))
      await writeFile(path.join(webviewOld, '.dsh-runtime-ready.json'), JSON.stringify({ schemaVersion: 1, sha256: oldHash }))
      // Simulate a superseded capsule while its real browser remains running.
      // Remove only the fixture's host leases to test browser-only protection.
      await writeFile(webviewManifest, JSON.stringify({ ...manifest, sha256: randomBytes(32).toString('hex') }))
      for (const lease of nativeLeases) await rm(lease.file)
    }
    await until(click(['More', '更多']), Boolean, 'cleanup menu')
    await until(click(['Clean old runtimes and logs', '清理旧运行时和日志']), Boolean, 'explicit cleanup action')
    await until(`document.body.innerText.includes('recovery backups are retained') || document.body.innerText.includes('登录信息和恢复备份均保留')`, Boolean, 'cleanup result')
    await assert.rejects(access(oldRuntime), { code: 'ENOENT' })
    await assert.rejects(access(oldLog), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(activeRuntime, 'sentinel'), 'utf8'), 'owned acceptance fixture')
    await access(path.join(recentLog, 'pnpm.log'))
    if (verifyWebView) {
      await assert.rejects(access(webviewOld), { code: 'ENOENT' })
      await access(path.join(protectedWebview, 'app/msedgewebview2.exe'))
      // Model native death during the handoff before any browser lease exists.
      // The real browser keeps running; the locked OS process guard must retain it.
      for (const lease of browserLeases) await rm(lease.file)
      const guarded = await evaluate(`fetch('/dsh-portable/storage-clean', {method:'POST'}).then(async r => ({status:r.status,body:await r.json()}))`)
      assert.equal(guarded.status, 200)
      assert.equal(guarded.body.webviews, 0)
      assert.ok(guarded.body.deferred > 0)
      await access(path.join(protectedWebview, 'app/msedgewebview2.exe'))
    }
    await writeFile(path.join(output, 'storage-cleanup.json'), JSON.stringify({ passed: true, oldRuntimeRemoved: true, activeRuntimeProtected: true, expiredLogRemoved: true, recentLogProtected: true,
      ...(verifyWebView ? { managedWebviewRemoved: true, actualBrowserOnlyLeaseProtected: true, actualBrowserWithoutLeaseProtected: true } : {}) }))
  } finally {
    if (originalManifest) await writeFile(webviewManifest, originalManifest)
    for (const lease of nativeLeases) await writeFile(lease.file, lease.bytes)
    for (const lease of browserLeases) await writeFile(lease.file, lease.bytes)
    await release?.()
    for (const directory of [oldLog, recentLog, oldRuntime, activeRuntime]) await rm(directory, { recursive: true, force: true })
    if (verifyWebView) await rm(webviewOld, { recursive: true, force: true })
  }
}

// Shared hidden-host harness; exercise actual official settings and the real
// same-origin storage route, without mutating plugins or opening native dialogs.
export async function verifyMaintenance({ root, evaluate, until, click, send, output, sample, soak, nativePid, verifyWebView, verifyPluginCache }) {
  const navigate = async () => {
    await until(click(['Desktop & data', '桌面与数据', 'Portable']), Boolean, 'Portable maintenance')
    await until(`document.body.innerText.includes('Check and repair') || document.body.innerText.includes('检查与修复')`, Boolean, 'maintenance loaded')
  }
  const scan = async () => {
    await until(click(['More', '更多']), Boolean, 'maintenance menu')
    await until(click(['View storage usage', '查看存储占用']), Boolean, 'storage action')
    await until(`document.body.innerText.includes('Backups are not caches') || document.body.innerText.includes('备份不是缓存')`, Boolean, 'storage result and retention explanation')
  }
  await sample('maintenance-ready')
  await navigate()
  await verifyStorageCleanup({ root, evaluate, until, click, output, nativePid, verifyWebView })
  if (verifyPluginCache) {
    const profile = path.join(root, 'data/dsh-home/profiles/web')
    const protectedFiles = ['package.json', 'pnpm-lock.yaml', 'node_modules/.modules.yaml']
    const before = await Promise.all(protectedFiles.map(async name => digest(await readFile(path.join(profile, name)))))
    await evaluate(`(() => {
      const original = window.fetch; window.__portableStoreResult = null;
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (args[0] === '/dsh-portable/plugin-cache-clean') {
          window.__portableStoreResult = {status:response.status,body:await response.clone().json()}; window.fetch = original;
        }
        return response;
      };
    })()`)
    await until(click(['More', '更多']), Boolean, 'dependency menu')
    await until(click(['Clean plugin dependency cache', '整理插件依赖缓存']), Boolean, 'dependency cleanup action')
    const response = await until('window.__portableStoreResult', Boolean, 'dependency cleanup response')
    assert.equal(response.status, 200, JSON.stringify(response))
    assert.equal(response.body.complete, true)
    assert.ok(response.body.references > 0)
    assert.deepEqual(await Promise.all(protectedFiles.map(async name => digest(await readFile(path.join(profile, name))))), before)
    await until(`document.body.innerText.includes('离线重建检查') || document.body.innerText.includes('offline rebuild checks')`, Boolean, 'dependency completion feedback')
    await writeFile(path.join(output, 'dependency-cleanup.json'), JSON.stringify({ passed: true, ...response, unchanged: protectedFiles }))
    await writeFile(path.join(output, 'dependency-cleanup.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
  }
  await scan()
  const report = await evaluate(`fetch('/dsh-portable/storage', {cache:'no-store'}).then(async r => ({status:r.status, body:await r.json()}))`)
  assert.equal(report.status, 200)
  assert.deepEqual(report.body.categories.map(item => item.id), ['pnpm-store', 'backups', 'recovery', 'logs'])
  for (const item of report.body.categories) assert.ok(Number.isFinite(item.bytes) && item.bytes >= 0)
  await writeFile(path.join(output, 'storage-report.json'), JSON.stringify(report, null, 2))
  for (const [theme, labels] of [['light', ['Light', '浅色']], ['dark', ['Dark', '深色']]]) {
    await until(click(['General', 'General settings', '通用设置']), Boolean, 'theme settings')
    await until(click(labels), Boolean, `${theme} theme`)
    await navigate()
    await scan()
    await evaluate(`document.querySelector('section[aria-label="Maintenance"],section[aria-label="维护"]')?.scrollIntoView({block:'center'})`)
    await writeFile(path.join(output, `storage-${theme}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
    await until(click(['More', '更多']), Boolean, `${theme} cleanup menu`)
    await writeFile(path.join(output, `storage-menu-${theme}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
    await until(click(['Clean old runtimes and logs', '清理旧运行时和日志']), Boolean, `${theme} cleanup action`)
    await until(`document.body.innerText.includes('recovery backups are retained') || document.body.innerText.includes('登录信息和恢复备份均保留')`, Boolean, `${theme} cleanup feedback`)
    await writeFile(path.join(output, `storage-clean-${theme}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
  }
  const cycles = soak ? 100 : 3
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await until(click(['Updates', '更新']), Boolean, 'updates navigation')
    await until(`Boolean(document.querySelector('button[aria-label="Update channel"],button[aria-label="更新通道"]'))`, Boolean, 'updates mounted')
    await navigate()
    if (cycle % 20 === 0) { await scan(); await sample(`maintenance-cycle-${cycle}`) }
  }
  await writeFile(path.join(output, 'maintenance-checks.json'), JSON.stringify({ passed: true, cycles, storageRoute: true, storageAction: true, cleanupAction: true, themes: ['light', 'dark'] }, null, 2))
  // Restore the fixture's standard theme for later isolated acceptance.
  await until(click(['General', 'General settings', '通用设置']), Boolean, 'restore theme settings')
  await until(click(['Light', '浅色']), Boolean, 'restore light theme')
  await navigate()
  if (soak) { await new Promise(resolve => setTimeout(resolve, 10000)); await sample('maintenance-settled') }
}
