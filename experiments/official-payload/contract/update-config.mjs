const ROOT_KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s.*)?$/;
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function isMain() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

export function rewriteAppUpdateYml(source, feedUrl, cacheName) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(feedUrl)) throw new Error('Feed URL must use the local IPv4 loopback address');
  if (!/^[A-Za-z0-9._-]+$/.test(cacheName)) throw new Error('Invalid updater cache directory name');
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const keys = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(ROOT_KEY);
    if (match) keys.set(match[1], i);
  }
  if (!keys.has('channel')) throw new Error('app-update.yml is missing the official channel key');
  const output = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(ROOT_KEY);
    if (match?.[1] === 'publisherName') {
      i++;
      while (i < lines.length && /^\s+/.test(lines[i])) i++;
      i--;
      continue;
    }
    if (match?.[1] === 'provider') output.push('provider: generic');
    else if (match?.[1] === 'url') output.push(`url: ${feedUrl}`);
    else if (match?.[1] === 'updaterCacheDirName') output.push(`updaterCacheDirName: ${cacheName}`);
    else output.push(lines[i]);
  }
  if (!keys.has('updaterCacheDirName')) output.push(`updaterCacheDirName: ${cacheName}`);
  const rewritten = output.join('\n').replace(/\n+$/, '') + '\n';
  if (!/^provider: generic$/m.test(rewritten) || !new RegExp(`^url: ${feedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(rewritten)) {
    throw new Error('Could not rewrite provider and feed URL');
  }
  if (/^publisherName:/m.test(rewritten)) throw new Error('publisherName was not removed');
  return rewritten;
}

if (isMain()) {
  const [sourcePath, feedUrl, cacheName, outputPath] = process.argv.slice(2);
  if (!sourcePath || !feedUrl || !cacheName || !outputPath) throw new Error('Usage: node update-config.mjs <source.yml> <feed-url> <cache-name> <output.yml>');
  const rewritten = rewriteAppUpdateYml(await readFile(sourcePath, 'utf8'), feedUrl, cacheName);
  await writeFile(outputPath, rewritten, 'utf8');
}
