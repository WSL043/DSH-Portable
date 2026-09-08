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

  await delay(1000)
  await until(click(['Settings', '设置']), Boolean, 'settings button')
  await until(click(['Plugins','插件']), Boolean, 'plugins');
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
    if (evaluate) await writeFile(path.join(output, 'page.txt'), await evaluate('document.body.innerText').catch(String))
  } finally {
    socket?.close()
    try {
      await cli('stop')
    } finally {
      if (child.exitCode === null) child.kill()
      await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed, exceptions }, null, 2))
    }
  }
}
console.log(JSON.stringify({ passed, output }))
