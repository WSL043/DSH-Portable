import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

// Run only against a disposable product: this changes its theme settings.
const root = path.resolve(process.argv[2] || '')
if (process.platform !== 'win32' || process.argv[3] !== '--disposable')
  throw new Error('usage: node smoke-windows-startup-theme.mjs <isolated product> --disposable')
const exec = promisify(execFile)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
await mkdir(path.join(root, 'data/dsh-home'), { recursive: true })
await mkdir(path.join(root, 'acceptance'), { recursive: true })

for (const theme of ['dark', 'light', 'dark', 'system']) {
  const expectedTheme = theme === 'system'
    ? (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize','AppsUseLightTheme',1)"], { windowsHide: true, timeout: 10000 })).stdout.trim() === '0' ? 'dark' : 'light'
    : theme
  await writeFile(path.join(root, 'data/dsh-home/settings.yaml'), `ui-theme:\n  preference: ${theme}\n`)
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  let socket
  const child = spawn(path.join(root, 'DeepSeek-Herness.exe'), [], {
    cwd: root, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
      DSH_PORTABLE_TEST_HIDDEN: '1', DSH_PORTABLE_TEST_AUTOMATION: '1',
      DSH_PORTABLE_STARTUP_HOLD_MS: '5000',
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${port}` },
  })
  try {
    let page
    const deadline = Date.now() + 90000
    while (Date.now() < deadline && !page) {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.webSocketDebuggerUrl) } catch {}
      if (!page) await delay(100)
    }
    assert.ok(page, 'WebView target available')
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let id = 0
    const pending = new Map()
    socket.onmessage = ({ data }) => {
      const msg = JSON.parse(data)
      const callback = pending.get(msg.id)
      if (!callback) return
      pending.delete(msg.id)
      msg.error ? callback.reject(new Error(JSON.stringify(msg.error))) : callback.resolve(msg.result)
    }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const request = ++id
      const timer = setTimeout(() => { pending.delete(request); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
      pending.set(request, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ id: request, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
      return result.result?.value
    }
    const reducedMotion = results.length % 2 === 0
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] })
    let loading
    const loadingDeadline = Date.now() + 10000
    while (Date.now() < loadingDeadline) {
      loading = await evaluate(`document.querySelector('#portable-startup-loading') ? ({background:getComputedStyle(document.body).backgroundColor,text:document.body.innerText,dark:matchMedia('(prefers-color-scheme:dark)').matches}) : null`)
      if (loading) break
      await delay(100)
    }
    assert.ok(loading, 'visible loading document exists before workspace navigation')
    assert.equal(loading.background, expectedTheme === 'dark' ? 'rgb(24, 24, 26)' : 'rgb(248, 248, 248)')
    assert.equal(loading.dark, expectedTheme === 'dark')
    assert.match(loading.text, /DeepSeek Harness/)
    const spinnerBefore = await evaluate(`getComputedStyle(document.querySelector('.ring')).transform`)
    await delay(650)
    const spinnerAfter = await evaluate(`getComputedStyle(document.querySelector('.ring')).transform`)
    assert.notEqual(spinnerAfter, spinnerBefore, `loading indicator must advance with reduced motion ${reducedMotion}`)
    await send('Page.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__startupColors=[];const sample=()=>{if(document.body){const color=getComputedStyle(document.body).backgroundColor;if(!window.__startupColors.includes(color))window.__startupColors.push(color)}};document.addEventListener('DOMContentLoaded',sample);const timer=setInterval(sample,16);setTimeout(()=>clearInterval(timer),15000)` })
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(root, 'acceptance', `loading-${results.length}-${theme}.png`), Buffer.from(screenshot.data, 'base64'))
    let trace = []
    while (Date.now() < deadline) {
      trace = (await readFile(path.join(root, 'data/logs/startup-latest.jsonl'), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
      if (trace.some(entry => entry.phase === 'interactive-ready')) break
      await delay(200)
    }
    assert.ok(trace.some(entry => entry.phase === 'interactive-ready'), 'workspace becomes interactive')
    const final = await evaluate(`({dark:matchMedia('(prefers-color-scheme:dark)').matches,background:getComputedStyle(document.body).backgroundColor,url:location.origin})`)
    assert.equal(final.dark, expectedTheme === 'dark')
    assert.match(final.url, /^http:\/\/127\.0\.0\.1:/)
    const colors = await evaluate('window.__startupColors')
    assert.ok(Array.isArray(colors) && colors.length, 'transition colors captured')
    for (const color of colors) {
      const channels = color.match(/[\d.]+/g)?.map(Number)
      if (!channels || (channels.length === 4 && channels[3] === 0)) continue
      const brightness = (channels[0] + channels[1] + channels[2]) / 3
      assert.ok(expectedTheme === 'dark' ? brightness < 128 : brightness >= 128, `unexpected ${theme} startup background: ${color}`)
    }
    const history = await readFile(path.join(root, 'data/logs/history', trace[0].startupId, 'startup.jsonl'), 'utf8')
    assert.match(history, /loading-document-ready/)
    results.push({ theme, reducedMotion, spinnerBefore, spinnerAfter, loading, final, colors, startupId: trace[0].startupId,
      loadingMs: trace.find(entry => entry.phase === 'loading-document-ready')?.elapsedMs,
      interactiveMs: trace.find(entry => entry.phase === 'interactive-ready')?.elapsedMs })
  } finally {
    socket?.close()
    await exec(path.join(root, 'runtime/node/node.exe'), [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', 'stop', '--json'], { cwd: root, windowsHide: true, timeout: 120000 })
    if (child.exitCode === null) child.kill()
    await delay(1000)
  }
}
for (const run of results) assert.match(await readFile(path.join(root, 'data/logs/history', run.startupId, 'startup.jsonl'), 'utf8'), /process-start/)
await writeFile(path.join(root, 'acceptance/startup-theme.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify({ passed: true, results }))
