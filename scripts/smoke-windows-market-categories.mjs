import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.argv[2]
const output = process.argv[3]
assert.ok(process.argv.includes('--disposable'), 'use an isolated test installation with --disposable')
assert.ok(root && output)
await mkdir(output, { recursive: true })
const exec = promisify(execFile)
const env = { ...process.env, DSH_PORTABLE_TEST_HIDDEN: '1', DSH_PORTABLE_TEST_AUTOMATION: '1', DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' }
const cli = (...args) => exec(path.join(root, 'runtime/node/node.exe'), [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', ...args, '--json'], { cwd: root, env, windowsHide: true, timeout: 60000 })
assert.equal(JSON.parse((await cli('status')).stdout).status, 'stopped')
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const child = spawn(path.join(root, 'DeepSeek-Herness.exe'), [], { cwd: root, env: { ...env, DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${port}` }, windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, evaluate, passed = false
const exceptions = []
try {
  let page
  const deadline = Date.now() + 90000
  while (!page && Date.now() < deadline) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(p.url)) } catch {}
    if (!page) await delay(200)
  }
  assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result) }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) })
  evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value }
  const until = async (expression, predicate, label) => { const limit = Date.now() + 30000; let result; while (Date.now() < limit) { result = await evaluate(expression); if (predicate(result)) return result; await delay(100) } throw new Error(`${label}: ${JSON.stringify(result)}`) }
  const click = names => `(() => {const names=${JSON.stringify(names)};const button=[...document.querySelectorAll('button,[role="button"],[role="tab"],[role="menuitem"]')].find(item=>names.includes((item.getAttribute('aria-label')||item.textContent||'').trim())&&item.getBoundingClientRect().width>0);button?.click();return Boolean(button)})()`
  await send('Runtime.enable')
  await send('Page.enable')

  // Onboarding is asynchronous: keep handling it until the settings dialog
  // actually opens, rather than declaring success before the first notice mounts.
  await until(`(() => {
    const dialogs = [...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')]
      .filter(item => item.getBoundingClientRect().width > 0)
    const notice = dialogs.find(item =>
      /Internal Testing Notice|内测声明|Add an API key to get started|添加 API 密钥|添加一个 API Key/.test(item.textContent || ''))
    if (notice) {
      const button = [...notice.querySelectorAll('button')].find(item =>
        ['Continue', '继续', 'Configure later', '稍后配置'].includes((item.textContent || '').trim()) && !item.disabled)
      button?.click()
      return false
    }
    if (dialogs.length) return true
    const settings = [...document.querySelectorAll('button')].find(item =>
      ['Settings', '设置'].includes((item.textContent || '').trim()))
    if (settings && settings.getBoundingClientRect().width > 0 && !settings.closest('[inert]')) {
      chrome.webview.postMessage({type:'dsh-portable/test-desktop',key:131260})
    }
    return false
  })()`, Boolean, 'native settings command opens after onboarding')

  await writeFile(path.join(output, 'general-page.txt'), await evaluate('document.body.innerText'))
  await until(click(['Portable']), Boolean, 'dedicated Portable settings navigation')
  await until(`document.body.innerText.includes('Check and repair') || document.body.innerText.includes('检查与修复')`, Boolean, 'Portable maintenance without update controls')
  assert.equal(await evaluate(`Boolean(document.querySelector('button[aria-label="Update channel"],button[aria-label="更新通道"]'))`), false)
  await until(click(['Updates', '更新']), Boolean, 'dedicated Updates navigation')
  await until(`Boolean(document.querySelector('button[aria-label="Update channel"],button[aria-label="更新通道"]'))`, Boolean, 'update channel control')
  const updateNavigation = await evaluate(`(() => {
    const button = labels => [...document.querySelectorAll('button')].find(node => labels.includes((node.textContent || '').trim()))
    const general = button(['General', '通用设置']), updates = button(['Updates', '更新']), models = button(['Models', '模型'])
    return { ordered: general?.getBoundingClientRect().y < updates?.getBoundingClientRect().y && updates?.getBoundingClientRect().y < models?.getBoundingClientRect().y,
      distinctIcon: Boolean(updates?.querySelector('svg')) && updates.querySelector('svg').innerHTML !== general?.querySelector('svg')?.innerHTML }
  })()`)
  assert.deepEqual(updateNavigation, { ordered: true, distinctIcon: true })
  await writeFile(path.join(output, 'updates-navigation.json'), JSON.stringify(updateNavigation))
  await delay(500)
  await writeFile(path.join(output, 'updates-settings.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
  await until(click(['Engine version', '内核版本']), Boolean, 'core version selector')
  await until(`Boolean(document.querySelector('button[aria-label="Engine version"][aria-expanded="true"],button[aria-label="内核版本"][aria-expanded="true"]'))`, Boolean, 'core version menu open')
  await delay(150)
  await writeFile(path.join(output, 'updates-version-menu.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
  await until(click(['Engine version', '内核版本']), Boolean, 'close core version selector')
  await until(click(['Portable']), Boolean, 'return to Portable maintenance')
  const nativeState = key => evaluate(`new Promise(resolve => {
    const listener = event => { if (event.data?.type !== 'dsh-portable/test-desktop-result') return;
      chrome.webview.removeEventListener('message', listener); resolve(event.data); };
    chrome.webview.addEventListener('message', listener);
    chrome.webview.postMessage({type:'dsh-portable/test-desktop',${key == null ? '' : `key:${key},`}});
  })`)
  for (const key of [262214, 262230, 262216]) {
    assert.equal((await nativeState(key)).openMenus.length, 1, 'keyboard opens one native menu')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 130, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 130, button: 'left', clickCount: 1 })
    assert.deepEqual((await nativeState()).openMenus, [], 'WebView click closes native menus')
    await nativeState(key)
    assert.deepEqual((await nativeState(27)).openMenus, [], 'Escape closes the menu before affecting the page')
  }
  await writeFile(path.join(output, 'menu-dismissal.json'), JSON.stringify({ passed: true, menus: 3, webViewPointer: true, escape: true }))
  await evaluate(`document.querySelector('section[aria-label="Updates"],section[aria-label="更新"]')?.scrollIntoView({block:'start'})`)
  const portableScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(output, 'portable-settings.png'), Buffer.from(portableScreenshot.data, 'base64'))
  const generalBorders = await until(`(() => {
    const textOf = node => (node?.textContent || '').replace(/\\s+/g, ' ').trim()
    const portableLabels = new Set(['Portable', '便携版'])
    const dataLabels = new Set(['Data', '数据'])
    const portableGroup = [...document.querySelectorAll('div')].find(node => {
      const heading = [...node.children].find(child => portableLabels.has(textOf(child)))
      const dataSections = [...node.children].filter(child => child.matches?.('section[aria-label]') && dataLabels.has(child.getAttribute('aria-label') || ''))
      return heading && dataSections.length > 0
    })
    if (!portableGroup) return null
    const sections = [...portableGroup.children].filter(child => child.matches?.('section[aria-label]'))
    const dataSection = sections.filter(section => dataLabels.has(section.getAttribute('aria-label') || '')).at(-1)
    const dataRow = dataSection?.lastElementChild
    if (!dataSection || !dataRow) return null
    dataSection.scrollIntoView({ block: 'end' })
    const borderOf = node => {
      const value = getComputedStyle(node).borderBottomWidth
      return { value, px: Number.parseFloat(value) }
    }
    const internalRows = sections.flatMap(section => [...section.children].slice(1).map(row => ({
      section: section.getAttribute('aria-label') || '', text: textOf(row).slice(0, 200), borderBottom: borderOf(row),
    })))
    return {
      portableGroup: { heading: textOf([...portableGroup.children].find(child => portableLabels.has(textOf(child)))), borderBottom: borderOf(portableGroup) },
      dataSection: { label: dataSection.getAttribute('aria-label') || '', lastRow: { text: textOf(dataRow).slice(0, 200), borderBottom: borderOf(dataRow) } },
      internalRows,
    }
  })()`, value => value !== null && value !== undefined, 'Portable general borders')
  await writeFile(path.join(output, 'general-borders.json'), JSON.stringify(generalBorders, null, 2))
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => resolve(true)))`)
  const generalScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(output, 'general-borders.png'), Buffer.from(generalScreenshot.data, 'base64'))
  assert.equal(generalBorders.portableGroup.borderBottom.px, 0, 'Portable group bottom border must be zero')
  assert.equal(generalBorders.dataSection.lastRow.borderBottom.px, 0, 'Data section last row bottom border must be zero')
  assert.ok(generalBorders.internalRows.some(row => row.borderBottom.px > 0), 'Portable internal rows must retain a separator')
  await until(click(['Plugins','插件']), Boolean, 'plugins');
  await until(click(['Plugin configuration','插件配置']), Boolean, 'plugin configuration');
  await delay(500);
  await writeFile(path.join(output, 'plugin-configuration.txt'), await evaluate('document.body.innerText'));
  await until(click(['Plugin list','插件列表']), Boolean, 'official plugin list');
  await delay(500);
  await writeFile(path.join(output, 'plugin-list.txt'), await evaluate('document.body.innerText'));
  await until(click(['Plugin Market','插件市场']), Boolean, 'market');
  await until(`Boolean(document.querySelector('[class*="catsToggle"]'))`, Boolean, 'category controls');
  const checks=[];
  for(const width of [580,1200,580]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await delay(400);
    const count=()=>evaluate(`document.querySelector('[class*="catsWrap"]')?.querySelectorAll('[data-chip="1"]').length`);
    const collapsed=await count();
    await evaluate(`document.querySelector('[class*="catsToggle"]')?.click()`);await delay(300);
    const expanded=await count();assert.ok(expanded>collapsed, 'expand must show more categories');
    await evaluate(`document.querySelector('[class*="catsToggle"]')?.click()`);await delay(300);
    assert.equal(await count(),collapsed,'collapse must restore measured budget');
    checks.push({width,collapsed,expanded});
  }
  assert.deepEqual(exceptions,[]);
  await writeFile(path.join(output,'checks.json'),JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks));
  passed=true;
} finally {
  try {
    if (evaluate) {
      await writeFile(path.join(output, 'page.txt'), await evaluate('document.body.innerText').catch(String))
      await writeFile(path.join(output, 'page.html'), await evaluate('document.documentElement.outerHTML').catch(String))
    }
  } finally {
    socket?.close()
    try {
      await cli('stop')
    } catch (error) {
      passed = false
      throw error
    } finally {
      if (child.exitCode === null) child.kill()
      await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed, exceptions }, null, 2))
    }
  }
}
console.log(JSON.stringify({ passed, output }))
