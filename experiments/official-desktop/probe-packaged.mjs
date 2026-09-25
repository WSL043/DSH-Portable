// Bounded native Electron CDP acceptance, on the private desktop test process only.
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const [portArg, action, output] = process.argv.slice(2);
const port = Number(portArg);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid probe port');
const labels = { 'close-dialog': '关闭', 'toggle-fixture': '启用 dsh-portable-acceptance-fixture', 'fixture-detail': '查看 dsh-portable-acceptance-fixture', 'uninstall-fixture': '卸载 dsh-portable-acceptance-fixture' };
if (!['inspect', 'input', 'screenshot', 'plugins', 'new-chat', 'add-plugin', 'install-fixture', 'install', 'enable', 'confirm-uninstall', 'close-app', ...Object.keys(labels)].includes(action)) throw new Error('Invalid probe action');
if (!process.env.DSH_PORTABLE_DEVELOPMENT_ROOT) throw new Error('Isolated root required');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const target = targets.find(t => t.type === 'page' && t.url === 'dsh-app://app/');
if (!target) throw new Error('Packaged workspace target missing');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let next = 0;
socket.addEventListener('close', () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    // Electron may terminate before acknowledging Browser.close. The private
    // process harness must separately confirm exit code 0 without forced cleanup.
    if (request.method === 'Browser.close') request.resolve({ transportClosed: true });
    else request.reject(new Error('CDP transport closed before response'));
  }
  pending.clear();
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
    pending.set(id, { resolve, reject, timer, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const connected = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Connection timed out')), 5000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
});
try {
  await connected;
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  if (action === 'close-app') {
    await send('Browser.close');
    console.log(JSON.stringify({ closeRequested: true }));
  } else if (action === 'screenshot') {
    if (!output || !isAbsolute(output)) throw new Error('Absolute screenshot output required');
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(output, Buffer.from(result.data, 'base64'));
    console.log(JSON.stringify({ screenshot: output, url: target.url }));
  } else if (action === 'input') {
    await evaluate(`(() => { const editor = [...document.querySelectorAll('[contenteditable=true],textarea')].find(e => e.getClientRects().length); if (!editor) throw new Error('Editor missing'); editor.focus(); })()`);
    await send('Input.insertText', { text: 'Portable alpha 输入验收 123' });
    const value = await evaluate(`document.activeElement?.textContent || document.activeElement?.value`);
    if (!value?.includes('Portable alpha 输入验收 123')) throw new Error('Inserted text not retained');
    console.log(JSON.stringify({ action, passed: true }));
  } else if (action === 'install-fixture') {
    if (!output || !isAbsolute(output)) throw new Error('Absolute fixture directory required');
    await evaluate(`(() => { const input = document.querySelector('[role=dialog] input[type=text]'); if (!input) throw new Error('Install input missing'); input.focus(); })()`);
    await send('Input.insertText', { text: output });
    console.log(JSON.stringify({ fixtureEntered: true }));
  } else if (action in labels) {
    const point = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(e => e.getClientRects().length && e.getAttribute('aria-label') === ${JSON.stringify(labels[action])}); if (!button || button.disabled) throw new Error('Enabled button missing'); const r=button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
    console.log(JSON.stringify({clicked:labels[action]}));
  } else if (['plugins', 'new-chat', 'add-plugin', 'install', 'enable', 'confirm-uninstall'].includes(action)) {
    const label = { plugins: '插件', 'new-chat': '新会话', 'add-plugin': '添加插件', install: '安装', enable: '立即启用', 'confirm-uninstall': '卸载' }[action];
    const selector = action === 'confirm-uninstall' ? '[role=dialog] button' : 'button';
    const point = await evaluate(`(() => { const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getClientRects().length && (e.textContent.trim() === ${JSON.stringify(label)} || (${JSON.stringify(action)} === "new-chat" && e.textContent.trim().startsWith(${JSON.stringify(label)})))); if (!button || button.disabled) throw new Error('Enabled button missing'); const r = button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    console.log(JSON.stringify({ clicked: label }));
  } else console.log(JSON.stringify(await evaluate(`({ title: document.title, text: document.body.innerText.slice(0, 6000), buttons: [...document.querySelectorAll('button')].filter(e => e.getClientRects().length).map(e => ({text:e.textContent.trim(),label:e.getAttribute('aria-label'),disabled:e.disabled,checked:e.getAttribute('aria-checked')})), editors: [...document.querySelectorAll('[contenteditable=true],textarea')].filter(e => e.getClientRects().length).length })`)));
} finally {
  socket.close();
}
