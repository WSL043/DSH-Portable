import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { acquireRuntimeLease } from '../../launcher/runtime-capsule.mjs'

async function verifyStorageCleanup({ root, until, click, output }) {
  const logs = path.join(root, 'data/dsh-home/profiles/web/.plugin-manager/logs')
  const cache = path.join(root, 'acceptance-runtime-cache')
  await mkdir(logs, { recursive: true })
  await mkdir(cache, { recursive: true })
  const oldLog = await mkdtemp(path.join(logs, 'operation-'))
  const recentLog = await mkdtemp(path.join(logs, 'operation-'))
  const oldRuntime = path.join(cache, randomBytes(32).toString('hex'))
  const activeRuntime = path.join(cache, randomBytes(32).toString('hex'))
  let release
  try {
    await mkdir(oldRuntime)
    await mkdir(activeRuntime)
    for (const directory of [oldRuntime, activeRuntime]) await writeFile(path.join(directory, 'sentinel'), 'owned acceptance fixture')
    release = await acquireRuntimeLease(activeRuntime)
    for (const directory of [oldLog, recentLog]) await writeFile(path.join(directory, 'pnpm.log'), 'owned acceptance fixture')
    const age = new Date(Date.now() - 30 * 86400000)
    await utimes(path.join(oldLog, 'pnpm.log'), age, age)
    await until(click(['More', '更多']), Boolean, 'cleanup menu')
    await until(click(['Clean old runtimes and logs', '清理旧运行时和日志']), Boolean, 'explicit cleanup action')
    await until(`document.body.innerText.includes('recovery backups are retained') || document.body.innerText.includes('登录信息和恢复备份均保留')`, Boolean, 'cleanup result')
    await assert.rejects(access(oldRuntime), { code: 'ENOENT' })
    await assert.rejects(access(oldLog), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(activeRuntime, 'sentinel'), 'utf8'), 'owned acceptance fixture')
    await access(path.join(recentLog, 'pnpm.log'))
    await writeFile(path.join(output, 'storage-cleanup.json'), JSON.stringify({ passed: true, oldRuntimeRemoved: true, activeRuntimeProtected: true, expiredLogRemoved: true, recentLogProtected: true }))
  } finally {
    await release?.()
    for (const directory of [oldLog, recentLog, oldRuntime, activeRuntime]) await rm(directory, { recursive: true, force: true })
  }
}

// Shared hidden-host harness; exercise actual official settings and the real
// same-origin storage route, without mutating plugins or opening native dialogs.
export async function verifyMaintenance({ root, evaluate, until, click, send, output, sample, soak }) {
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
  await verifyStorageCleanup({ root, until, click, output })
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
