// Official, unmodified application on a disposable Windows runner. No credentials.
import { writeFile } from 'node:fs/promises';
const [port, output] = process.argv.slice(2);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { targets: [], passed: false };
let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { targets = await (await fetch(`http://127.0.0.1:${Number(port)}/json/list`, { signal: AbortSignal.timeout(1000) })).json(); } catch {}
    if (targets?.some(t => t.type === 'page')) break;
    await delay(1000);
  }
  evidence.targets = targets?.map(({ type, url }) => ({ type, url }));
  const target = targets?.find(t => t.type === 'page' && /welcome\.html|dsh-app:\/\/app\//.test(t.url));
  if (!target) throw new Error('Official welcome/workspace did not open');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const r = JSON.parse(data), request = pending.get(r.id);
    if (!request) return;
    pending.delete(r.id); clearTimeout(request.timer);
    if (r.error || r.result?.exceptionDetails) request.reject(new Error(JSON.stringify(r.error ?? r.result.exceptionDetails)));
    else request.resolve(r.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 10000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  evidence.page = (await send('Runtime.evaluate', { expression: '({title:document.title,state:document.readyState,buttons:[...document.querySelectorAll("button")].map(e=>e.textContent),welcome:typeof window.dshWelcome?.skip})', returnByValue: true })).result.value;
  await writeFile(`${output}.png`, Buffer.from((await send('Page.captureScreenshot')).data, 'base64'));
  if (evidence.page.welcome === 'function') {
    await send('Runtime.evaluate', { expression: 'void window.dshWelcome.skip()' });
  }
  await delay(12000);
  evidence.after = (await (await fetch(`http://127.0.0.1:${Number(port)}/json/list`)).json()).map(({ type, url }) => ({ type, url }));
  evidence.passed = evidence.after.some(t => t.url === 'dsh-app://app/');
  if (!evidence.passed) throw new Error('Workspace absent after welcome');
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
finally { socket?.close(); await writeFile(output, JSON.stringify(evidence, null, 2)); }
