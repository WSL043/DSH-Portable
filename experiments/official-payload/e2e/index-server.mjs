import { createServer } from 'node:http';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildAcceptedIndex } from './report.mjs';

if (!process.argv[1] || import.meta.url !== pathToFileURL(process.argv[1]).href) {
  throw new Error('Run this file directly with Node.js');
}

const [oldPath, newPath, portText = '0', logPath] = process.argv.slice(2);
if (!oldPath || !newPath) throw new Error('Usage: node index-server.mjs <old-candidate.json> <new-candidate.json> [port=0] [request-log]');
const oldCandidate = JSON.parse(await readFile(oldPath, 'utf8'));
const newCandidate = JSON.parse(await readFile(newPath, 'utf8'));
const body = Buffer.from(JSON.stringify(buildAcceptedIndex(oldCandidate, newCandidate)) + '\n');
const server = createServer(async (request, response) => {
  const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const status = request.method === 'GET' && route === '/index.json' ? 200 : 404;
  if (logPath) await appendFile(logPath, JSON.stringify({ method: request.method, path: route, status }) + '\n');
  const payload = status === 200 ? body : Buffer.from('not found');
  response.writeHead(status, { 'content-type': status === 200 ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store' });
  response.end(payload);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(portText), '127.0.0.1', resolve);
});
const address = server.address();
console.log(JSON.stringify({ port: address.port, baseUrl: 'http://127.0.0.1:' + address.port + '/', indexUrl: 'http://127.0.0.1:' + address.port + '/index.json' }));
