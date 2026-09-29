import { writeFile } from 'node:fs/promises';

const [portText, version, locale, resultPath, timeoutText = '420000'] = process.argv.slice(2);
if (!portText || !version || !['zh', 'en'].includes(locale) || !resultPath) throw new Error('Usage: node ui-probe.mjs <cdp-port> <version> <zh|en> <result.json> [timeout-ms]');
const port = Number(portText);
const deadline = Date.now() + Number(timeoutText);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let client;

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}`);
  return response.json();
}

async function until(fn, description) {
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(350);
  }
  throw new Error(`${description} timed out${last ? `: ${last}` : ''}`);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 8000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP WebSocket error')); };
  });
  let sequence = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
    else request.resolve(message.result);
  };
  socket.onclose = () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP target closed')); }
    pending.clear();
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 12000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, close: () => socket.close(), evaluate: async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value };
}

async function mouseClick(labels, selector) {
  const expression = `(()=>{const labels=${JSON.stringify(labels)};const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.getClientRects().length&&!x.disabled&&labels.some(t=>x.textContent.trim()===t||x.getAttribute('aria-label')===t));if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(x<0||y<0||x>=innerWidth||y>=innerHeight||!e.contains(document.elementFromPoint(x,y)))return null;return{x,y,text:e.textContent.trim(),label:e.getAttribute('aria-label')};})()`;
  const point = await until(() => client.evaluate(expression), `Visible control ${labels.join('/')}`);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  for (const type of ['mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  return { text: point.text, ariaLabel: point.label, x: point.x, y: point.y };
}

const evidence = { workspaceUrl: 'dsh-app://app/', locale, version };
try {
  const initial = await until(async () => (await targets()).find(target => target.type === 'page' && (target.url === 'dsh-app://app/' || target.url.endsWith('/renderer/welcome.html'))), 'workspace or first-run welcome page');
  if (initial.url.endsWith('/renderer/welcome.html')) {
    const welcome = await connect(initial);
    await until(() => welcome.evaluate('typeof window.dshWelcome?.skip === "function"'), 'first-run welcome API');
    await welcome.evaluate('void window.dshWelcome.skip()');
    welcome.close();
  }
  const workspace = initial.url === 'dsh-app://app/' ? initial : await until(async () => (await targets()).find(target => target.type === 'page' && target.url === 'dsh-app://app/'), 'dsh-app://app/ workspace');
  client = await connect(workspace);
  await until(() => client.evaluate(`document.readyState === 'complete' && document.body && document.body.innerText.length > 0`), 'Workspace render');
  const updateLabels = ['新版本', 'New version'];
  evidence.updateEntry = await mouseClick(updateLabels, 'button,[role="button"],a,[tabindex]');
  const dialog = await until(async () => (await targets()).find(target => target.type === 'page' && target.url.startsWith('dsh-app://shell/update-dialog.html')), 'dsh-app://shell/update-dialog.html');
  client.close();
  client = await connect(dialog);
  await until(async () => {
    const text = await client.evaluate('document.readyState === "complete" ? document.body?.innerText ?? "" : ""');
    evidence.dialogText = text.slice(0, 6000);
    return text.includes(version);
  }, `Rendered update dialog containing ${version}`);
  evidence.updateDialogShown = true;
  const installLabels = ['安装并重启', 'Install and restart'];
  evidence.installButton = await mouseClick(installLabels, 'button,[role="button"]');
  evidence.installClicked = true;
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`);
  client.close();
} catch (error) {
  evidence.error = String(error);
  // Show what the app was actually displaying so a failed run on a clean machine can be diagnosed.
  try {
    evidence.targets = [];
    for (const target of (await targets()).filter(item => item.type === 'page')) {
      const entry = { url: target.url, title: target.title };
      try { const view = await connect(target); entry.text = String(await view.evaluate('document.body ? document.body.innerText.slice(0, 1500) : ""')); view.close(); } catch (probeError) { entry.error = String(probeError); }
      evidence.targets.push(entry);
    }
  } catch {}
  try { await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`); } catch {}
  process.exitCode = 1;
} finally {
  client?.close();
}
