// Read-only page proof plus an optional synthetic localStorage relocation marker.
// Connect only to the unique CDP port of an isolated hidden Desktop development run.
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const port = Number(process.argv[2]);
const mode = process.argv[3] ?? 'readiness';
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Expected a CDP port');
if (!['readiness', 'set-marker', 'get-marker'].includes(mode)) throw new Error('Unknown probe mode');
if (!process.env.DSH_PORTABLE_DEVELOPMENT_ROOT) throw new Error('An isolated development root is required');
const appRoot = process.env.DSH_OFFICIAL_DESKTOP_APP_ROOT;
if (!appRoot || !isAbsolute(appRoot)) throw new Error('An absolute DSH_OFFICIAL_DESKTOP_APP_ROOT is required');
const welcomeUrl = pathToFileURL(join(appRoot, 'renderer', 'welcome.html')).href;

async function within(promise, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${description} timed out`)), 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`CDP target listing failed: ${response.status}`);
const targets = await response.json();
const target = targets.find(item => item.type === 'page' && item.url === welcomeUrl);
if (!target) throw new Error('Official Desktop welcome target not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await within(
  new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  }),
  'CDP connection',
);

const expression = mode === 'set-marker'
  ? "localStorage.setItem('dsh-portable-synthetic-move-probe', 'rc2-test-value'); localStorage.getItem('dsh-portable-synthetic-move-probe')"
  : mode === 'get-marker'
    ? "localStorage.getItem('dsh-portable-synthetic-move-probe')"
    : "({ title: document.title, readyState: document.readyState, buttons: Array.from(document.querySelectorAll('button')).map(button => button.textContent?.trim()) })";

try {
  const result = await within(
    new Promise((resolve, reject) => {
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message));
        else if (message.result.exceptionDetails) reject(new Error(message.result.exceptionDetails.text));
        else resolve(message.result.result.value);
      });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    }),
    'CDP evaluation',
  );
  console.log(JSON.stringify({ mode, result, url: target.url }));
} finally {
  socket.close();
}
