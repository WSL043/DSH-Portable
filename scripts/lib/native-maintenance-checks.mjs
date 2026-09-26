import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

// Shared hidden-host harness; exercise actual official settings and the real
// same-origin storage route, without mutating plugins or opening native dialogs.
export async function verifyMaintenance({ evaluate, until, click, send, output, sample, soak }) {
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
  }
  const cycles = soak ? 100 : 3
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await until(click(['Updates', '更新']), Boolean, 'updates navigation')
    await until(`Boolean(document.querySelector('button[aria-label="Update channel"],button[aria-label="更新通道"]'))`, Boolean, 'updates mounted')
    await navigate()
    if (cycle % 20 === 0) { await scan(); await sample(`maintenance-cycle-${cycle}`) }
  }
  await writeFile(path.join(output, 'maintenance-checks.json'), JSON.stringify({ passed: true, cycles, storageRoute: true, storageAction: true, themes: ['light', 'dark'] }, null, 2))
  // Restore the fixture's standard theme for later isolated acceptance.
  await until(click(['General', 'General settings', '通用设置']), Boolean, 'restore theme settings')
  await until(click(['Light', '浅色']), Boolean, 'restore light theme')
  await navigate()
  if (soak) { await new Promise(resolve => setTimeout(resolve, 10000)); await sample('maintenance-settled') }
}
