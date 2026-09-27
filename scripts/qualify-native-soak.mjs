import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const [rootArg, driverArg, outputArg, mode] = process.argv.slice(2)
assert.ok(rootArg && driverArg && outputArg && ['--probe', '--qualify'].includes(mode),
  'Expected disposable product, Playwright package.json, evidence directory, --probe or --qualify')
const root = path.resolve(rootArg), output = path.resolve(outputArg)
assert.ok(root.includes(`${path.sep}build${path.sep}`), 'use an isolated build fixture')
await mkdir(output, { recursive: true })
const { chromium } = createRequire(path.resolve(driverArg))('playwright')
const exec = promisify(execFile), delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const result = { passed: false, qualifiesRelease: false, requestedMode: mode, sourceOverlay: false,
  startedAt: new Date().toISOString(), navigation: 0, images: 0, pluginCycles: 0,
  model: { requests: 0, completed: 0, cancelled: 0 }, exceptions: [], samples: [] }
const persist = () => writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
const gateway = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/messages') { response.writeHead(404).end(); return }
  let body = ''
  for await (const chunk of request) { body += chunk; if (body.length > 1024 * 1024) { response.writeHead(413).end(); return } }
  const call = JSON.parse(body)
  result.model.requests++
  const slow = JSON.stringify(call.messages.at(-1)).includes('SOAK_CANCEL')
  let finished = false, closed = false
  response.on('close', () => { closed = true; if (!finished) result.model.cancelled++ })
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  // The shipped alpha.1 adapter uses Messages SSE, not chat/completions.
  const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  send({ type: 'message_start', message: { id: `soak-${result.model.requests}`, type: 'message',
    role: 'assistant', model: call.model, content: [], usage: { input_tokens: 1, output_tokens: 0 } } })
  send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (let i = 0; i < (slow ? 300 : 4); i++) {
    if (closed) return
    send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i === 0 ? `LOCAL_SOAK_OK_${result.model.requests} ` : 'fixture ' } })
    await delay(100)
  }
  if (closed) return
  send({ type: 'content_block_stop', index: 0 })
  send({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
  send({ type: 'message_stop' })
  finished = true; result.model.completed++; response.end()
})
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`
const debugListener = createServer()
await new Promise(resolve => debugListener.listen(0, '127.0.0.1', resolve))
const debugPort = debugListener.address().port
await new Promise(resolve => debugListener.close(resolve))
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/API_KEY|TOKEN|SECRET|DSH_HOME|DSH_PORTABLE|DEEPSEEK|OPENAI|ANTHROPIC/i.test(name)))
Object.assign(env, { DSH_PORTABLE_ROOT: root, DSH_PORTABLE_STATE_ROOT: root,
  DSH_PORTABLE_BASE_STATE_ROOT: root, DSH_PORTABLE_ENVIRONMENT: 'default',
  DSH_HOME: path.join(root, 'data/dsh-home'), DSH_PORTABLE_RUNTIME_CACHE: path.join(root, 'acceptance-runtime-cache'),
  DSH_PORTABLE_WEBVIEW_CACHE: path.join(root, 'acceptance-webview-cache'),
  DSH_PORTABLE_TEST_HIDDEN: '1', DSH_PORTABLE_TEST_AUTOMATION: '1',
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1', DSH_TELEMETRY_MODE: 'DISABLED',
  DEEPSEEK_API_KEY: 'local-soak-not-a-real-key', DEEPSEEK_BASE_URL: gatewayUrl,
  DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}` })
await mkdir(env.DSH_HOME, { recursive: true })
// Synthetic fixture only: explicit local route plus a fake key. Never copy user settings.
await writeFile(path.join(env.DSH_HOME, 'settings.yaml'), JSON.stringify({ 'llm-deepseek': { baseURL: gatewayUrl } }))
const cli = (...args) => exec(path.join(root, 'runtime/node/node.exe'),
  [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', ...args, '--json'],
  { cwd: root, env, windowsHide: true, timeout: 120000 })
assert.equal(JSON.parse((await cli('status')).stdout).status, 'stopped')
const capsule = JSON.parse(await readFile(path.join(root, 'runtime-capsule.json'), 'utf8'))
result.capsuleSha256 = capsule.sha256
let host, browser, page, sampleTimer, samplingError
let sampling = Promise.resolve()
async function sample(phase) {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.resolve('scripts/sample-portable-processes.ps1'), '-Root', root], { windowsHide: true, timeout: 15000 })
  const snapshot = JSON.parse(stdout)
  if (phase !== 'exited') {
    assert.equal(host.exitCode, null, 'Native host must remain alive throughout the soak')
    assert.ok(browser.isConnected() && !page.isClosed(), 'Native page must remain connected')
    assert.ok(snapshot.processes.some(p => p.pid === host.pid), 'sampler must include the live Native host')
  }
  result.samples.push({ phase, monotonicMs: performance.now(), ...snapshot }); await persist()
}
async function dismissOnboarding() {
  for (let i = 0; i < 20; i++) {
    for (const name of [/^(Continue|继续)$/, /^(Configure later|稍后配置)$/]) {
      const button = page.getByRole('button', { name }).first()
      if (await button.isVisible() && await button.isEnabled()) await button.click()
    }
    await delay(200)
  }
}
const composer = () => page.locator('[contenteditable="true"][role="textbox"]').first()
async function navigation() {
  await page.getByRole('button', { name: /^(Settings|设置)$/ }).first().click()
  await page.getByRole('button', { name: /^(Desktop & data|桌面与数据)$/ }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('button', { name: /^(Close|关闭)$/ }).click()
  await composer().waitFor({ state: 'visible' }); result.navigation++
}
async function pluginCycle() {
  await page.getByRole('button', { name: /^(Plugins|插件)$/ }).first().click()
  for (const name of ['dsh-image-viewer', 'dsh-chat-manager']) {
    const toggle = page.locator(`[data-plugin-package="${name}"]`).getByRole('switch')
    await toggle.waitFor()
    if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click()
    await page.waitForFunction(name => document.querySelector(`[data-plugin-package="${name}"] [role="switch"]`)?.getAttribute('aria-checked') === 'true', name)
    await toggle.click()
    await page.waitForFunction(name => document.querySelector(`[data-plugin-package="${name}"] [role="switch"]`)?.getAttribute('aria-checked') === 'false', name)
    await toggle.click()
    await page.waitForFunction(name => document.querySelector(`[data-plugin-package="${name}"] [role="switch"]`)?.getAttribute('aria-checked') === 'true', name)
  }
  await page.getByRole('button', { name: /^(New session|新会话)$/i }).first().click()
  await composer().waitFor({ state: 'visible' }); result.pluginCycles++
}
async function imageCycle() {
  const transfer = await page.evaluateHandle(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240
    const context = canvas.getContext('2d'); context.fillStyle = '#2377aa'; context.fillRect(0, 0, 320, 240)
    const png = canvas.toDataURL('image/png').split(',')[1], data = new DataTransfer()
    data.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'soak.png', { type: 'image/png' }))
    return data
  })
  await composer().fill('SOAK_IMAGE_DRAFT')
  await composer().evaluate((element, clipboardData) => element.dispatchEvent(new ClipboardEvent('paste', {
    bubbles: true, cancelable: true, clipboardData,
  })), transfer)
  await transfer.dispose()
  const thumbnails = page.locator('[role="group"] button[title]').filter({ has: page.locator(':scope > img') })
  await thumbnails.first().click()
  const viewer = page.locator('.niv-root'); await viewer.waitFor()
  await viewer.getByRole('button', { name: /^(Mark region|标记区域)$/ }).click()
  await viewer.locator('.niv-image').click()
  const note = `SOAK_NOTE_${result.images}`
  await viewer.locator('textarea').fill(note)
  await viewer.locator('.niv-close-floating').click()
  await viewer.waitFor({ state: 'hidden' })
  await page.waitForFunction(note => document.querySelector('[contenteditable="true"][role="textbox"]')?.textContent.includes(note), note)
  assert.ok(await thumbnails.count() >= 2)
  // Remove fixture attachments before any model request; no Files API is exercised.
  const remove = page.getByRole('button', { name: /^(Remove image|Remove attachment|删除图片|移除图片|删除附件|移除附件)/ })
  while (await remove.count()) await remove.first().click()
  assert.equal(await thumbnails.count(), 0, 'fixture attachments must be removed before model requests')
  await composer().fill(''); result.images++
}
async function modelCycle(cancel) {
  const before = result.model.requests, finished = result.model.completed, aborted = result.model.cancelled
  await composer().fill(cancel ? 'SOAK_CANCEL' : 'SOAK_STREAM')
  await composer().press('Enter')
  const deadline = Date.now() + 30000
  while (result.model.requests === before && Date.now() < deadline) await delay(100)
  assert.ok(result.model.requests > before, 'request must reach the local deterministic gateway')
  const responseMarker = `LOCAL_SOAK_OK_${result.model.requests}`
  const stop = page.getByRole('button', { name: /^(Stop|Stop generation|Stop generating|停止|停止生成)$/ }).first()
  if (cancel) await stop.click()
  while ((cancel ? result.model.cancelled === aborted : result.model.completed === finished) && Date.now() < deadline) await delay(100)
  assert.ok(cancel ? result.model.cancelled > aborted : result.model.completed > finished)
  await stop.waitFor({ state: 'hidden' })
  if (!cancel) await page.getByText(new RegExp(responseMarker)).last().waitFor({ state: 'visible' })
  await composer().waitFor({ state: 'visible' })
}
try {
  host = spawn(path.join(root, 'DeepSeek-Herness.exe'), [], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
  const deadline = Date.now() + 120000
  while (!browser && Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 }) } catch { await delay(200) }
  }
  assert.ok(browser)
  while (!page && Date.now() < deadline) { page = browser.contexts().flatMap(c => c.pages())[0]; if (!page) await delay(100) }
  assert.ok(page); page.setDefaultTimeout(30000)
  page.on('pageerror', error => result.exceptions.push(error.message))
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/)
  await page.waitForFunction(() => !document.querySelector('[data-dsh-boot]'))
  const windowProbe = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.resolve('scripts/inspect-hidden-native-window.ps1'), '-HostPid', String(host.pid)],
  { windowsHide: true, timeout: 15000 })
  result.nativeWindows = JSON.parse(windowProbe.stdout)
  assert.ok(result.nativeWindows.length > 0)
  assert.ok(result.nativeWindows.every(w => w.noActivate && !w.foreground && w.left < -20000 && w.top < -20000))
  await dismissOnboarding()
  await pluginCycle(); await navigation(); await imageCycle(); await modelCycle(false); await modelCycle(true)
  result.warmup = { navigation: result.navigation, images: result.images, pluginCycles: result.pluginCycles }
  result.navigation = 0; result.images = 0; result.pluginCycles = 0
  const start = performance.now()
  if (mode === '--qualify') {
    const queueSample = () => {
      const elapsedMinute = Math.floor((performance.now() - start) / 60000)
      const phase = elapsedMinute < 10 ? 'baseline' : elapsedMinute < 110 ? 'active' : 'idle'
      sampling = sampling.then(() => sample(phase)).catch(error => { samplingError ??= error })
    }
    queueSample()
    sampleTimer = setInterval(queueSample, 60000)
  }
  for (let minute = 0; minute < (mode === '--qualify' ? 120 : 2); minute++) {
    if (samplingError) throw samplingError
    const active = mode === '--probe' || minute >= 10 && minute < 110
    if (active) {
      await navigation(); await navigation()
      if (minute % 5 === 0) await imageCycle()
      if (minute % 10 === 0) { await pluginCycle(); await modelCycle(false); await modelCycle(true) }
      if (mode === '--qualify') assert.ok(performance.now() - start < 110 * 60000, 'active operations must finish before the ten-minute idle period')
    }
    if (mode === '--probe') await sample('probe')
    await delay(Math.max(0, start + (minute + 1) * (mode === '--qualify' ? 60000 : 1000) - performance.now()))
  }
  clearInterval(sampleTimer); await sampling
  if (samplingError) throw samplingError
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const totals = (phase, field) => result.samples.filter(s => s.phase === phase).map(s => s.processes.reduce((sum, p) => sum + p[field], 0))
  if (mode === '--qualify') {
    assert.ok(performance.now() - start >= 120 * 60000)
    assert.ok(totals('baseline', 'privateBytes').length >= 10 && totals('idle', 'privateBytes').length >= 10)
    for (const phase of ['baseline', 'idle']) {
      const points = result.samples.filter(s => s.phase === phase)
      assert.ok(points.at(-1).monotonicMs - points[0].monotonicMs >= 9 * 60000 - 2000, `${phase} samples must span the actual observation period`)
    }
    for (let i = 1; i < result.samples.length; i++) {
      const gap = result.samples[i].monotonicMs - result.samples[i - 1].monotonicMs
      assert.ok(gap >= 45000 && gap <= 75000, `minute sampling drift: ${gap}ms`)
    }
    assert.equal(result.navigation, 200); assert.equal(result.images, 20); assert.equal(result.pluginCycles, 10)
    const base = median(totals('baseline', 'privateBytes')), idle = median(totals('idle', 'privateBytes'))
    const handles = median(totals('idle', 'handles')) - median(totals('baseline', 'handles'))
    result.resources = { baselinePrivateBytes: base, idlePrivateBytes: idle, handleGrowth: handles }
    assert.ok(idle <= base * 1.2 + 64 * 1024 * 1024); assert.ok(handles <= 100)
  }
  assert.equal(host.exitCode, null)
  assert.ok(browser.isConnected() && !page.isClosed())
  await composer().fill('SOAK_FINAL_INPUT_CHECK')
  assert.equal(await composer().innerText(), 'SOAK_FINAL_INPUT_CHECK')
  await composer().fill('')
  assert.deepEqual(result.exceptions, [])
  result.passed = true
} catch (error) {
  result.error = error.stack
  await persist()
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await writeFile(path.join(output, 'failure.html'), await page.content()).catch(() => {}) }
  process.exitCode = 1
} finally {
  clearInterval(sampleTimer); await sampling
  await browser?.close().catch(() => {})
  await cli('stop').catch(() => {})
  if (host?.exitCode === null) host.kill()
  gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve))
  await delay(10000); await sample('exited')
  const identities = [...new Map(result.samples.flatMap(s => s.processes).map(p => [`${p.pid}/${p.startedAt}`, { pid: p.pid, startedAt: p.startedAt }])).values()]
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$remaining=@(); foreach($identity in ($env:DSH_SOAK_PIDS | ConvertFrom-Json)) { $item=Get-Process -Id $identity.pid -ErrorAction SilentlyContinue; if($null -ne $item -and $item.StartTime.ToUniversalTime().ToString("o") -eq $identity.startedAt) { $remaining += $item.Id } }; ConvertTo-Json -InputObject @($remaining) -Compress'],
  { windowsHide: true, timeout: 15000, env: { ...env, DSH_SOAK_PIDS: JSON.stringify(identities) } })
  result.survivingOwnedPids = JSON.parse(stdout)
  if (result.samples.at(-1).processes.length || result.survivingOwnedPids.length) { result.passed = false; result.exitLeak = true; process.exitCode = 1 }
  result.qualifiesRelease = result.passed && mode === '--qualify'
  result.finishedAt = new Date().toISOString(); await persist()
  console.log(JSON.stringify({ passed: result.passed, qualifiesRelease: result.qualifiesRelease, output }))
}
