const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Expected a CDP port');
const deadline = Date.now() + 90_000;
let lastError = 'CDP page was not available';
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error(`CDP target list returned ${response.status}`);
    const targets = await response.json();
    for (const target of targets.filter(item => item.type === 'page' && item.webSocketDebuggerUrl)) {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP WebSocket open timed out')), 2000);
        socket.onopen = () => { clearTimeout(timer); resolve(); };
        socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP WebSocket failed')); };
      });
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Renderer evaluation timed out')), 4000);
        socket.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.id !== 1) return;
          clearTimeout(timer);
          resolve(message.result?.result?.value);
        };
        socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => ({ready:document.readyState,title:document.title,url:location.href,bodyText:(document.body?.innerText??'').trim()}))()` } }));
      });
      socket.close();
      if (!result || !['interactive', 'complete'].includes(result.ready) || !result.title?.trim() || result.bodyText?.length < 5 || result.url?.startsWith('devtools:')) continue;
      console.log(JSON.stringify({ rendered: true, ready: result.ready, title: result.title, url: result.url, bodyTextLength: result.bodyText.length }));
      process.exit(0);
    }
    lastError = 'No rendered official page target had a title and visible body text';
  } catch (error) { lastError = error.message; }
  await new Promise(resolve => setTimeout(resolve, 500));
}
throw new Error(lastError);
