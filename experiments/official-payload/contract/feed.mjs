import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/;

export async function startFeed({ version, stubPath, port = 0, logPath }) {
  if (!VERSION_RE.test(version)) throw new Error(`Invalid feed version: ${version}`);
  const stub = await readFile(stubPath);
  const filename = `deepseek-harness-${version}-win-x64.exe`;
  const sha512 = createHash('sha512').update(stub).digest('base64');
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    let status = 404;
    let body = Buffer.from('not found');
    let type = 'text/plain; charset=utf-8';
    if (request.method === 'GET' && pathname === '/nightly.yml') {
      status = 200;
      type = 'text/yaml; charset=utf-8';
      body = Buffer.from([
        `version: ${version}`,
        'files:',
        `  - url: ${filename}`,
        `    sha512: ${sha512}`,
        `    size: ${stub.length}`,
        `path: ${filename}`,
        `sha512: ${sha512}`,
        `releaseDate: '${new Date().toISOString()}'`,
        '',
      ].join('\n'));
    } else if (request.method === 'GET' && pathname === `/${filename}`) {
      status = 200;
      type = 'application/octet-stream';
      body = stub;
    }
    if (logPath) await appendFile(logPath, `${JSON.stringify({ method: request.method, path: pathname, status })}\n`);
    response.writeHead(status, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store' });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, port: address.port, baseUrl: `http://127.0.0.1:${address.port}/`, filename, sha512, size: stub.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, stubPath, requestedPort = '0', logPath] = process.argv.slice(2);
  if (!version || !stubPath) throw new Error('Usage: node feed.mjs <version> <stub.exe> [port=0] [request-log]');
  const feed = await startFeed({ version, stubPath, port: Number(requestedPort), logPath });
  console.log(JSON.stringify({ port: feed.port, baseUrl: feed.baseUrl, filename: feed.filename, sha512: feed.sha512, size: feed.size }));
}
