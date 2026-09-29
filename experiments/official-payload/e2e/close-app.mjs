const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Usage: node close-app.mjs <cdp-port>');
const response = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(3000) });
if (!response.ok) throw new Error('CDP version endpoint returned ' + response.status);
const version = await response.json();
if (typeof version.webSocketDebuggerUrl !== 'string') throw new Error('CDP browser WebSocket URL is missing');
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP WebSocket open timed out')), 5000);
  socket.onopen = () => { clearTimeout(timer); resolve(); };
  socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP WebSocket failed')); };
});
const closeObserved = new Promise(resolve => {
  const timer = setTimeout(resolve, 5000);
  socket.onclose = () => { clearTimeout(timer); resolve(); };
});
socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await closeObserved;
try { socket.close(); } catch {}
console.log(JSON.stringify({ closedBy: 'Browser.close', port }));
