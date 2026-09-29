import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareVersions } from '../version.mjs';
import { CHANNEL_BASE_URL } from './constants.mjs';

const OFFICIAL_HOST = 'download.deepseek.com';
const OFFICIAL_PREFIX = '/dsh-desk/bin/win-x64/';
const MAX_VERSIONS = 20;

function assertVersion(version) {
  compareVersions(version, version);
  return version;
}

function assertSha512(value) {
  if (typeof value !== 'string') throw new Error('Invalid SHA-512 digest');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== value) throw new Error('Invalid SHA-512 digest');
  return value;
}

export function assertInstallerUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Untrusted installer URL'); }
  if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_HOST || (url.port && url.port !== '443') || url.username || url.password || !url.pathname.startsWith(OFFICIAL_PREFIX)) {
    throw new Error('Untrusted installer URL');
  }
  return url.href;
}

function normalizeEntry(entry, defaultQualifiedAt) {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid channel version entry');
  const version = assertVersion(entry.version);
  const installerUrl = assertInstallerUrl(entry.installerUrl);
  const sha512 = assertSha512(entry.sha512);
  if (!Number.isSafeInteger(entry.size) || entry.size < 1_000_000 || entry.size > 2_147_483_648) throw new Error('Invalid official package size');
  const qualifiedAt = entry.qualifiedAt ?? defaultQualifiedAt;
  if (typeof qualifiedAt !== 'string' || !Number.isFinite(Date.parse(qualifiedAt))) throw new Error('Invalid qualification timestamp');
  return { version, installerUrl, sha512, size: entry.size, qualifiedAt };
}

function assertChannelBase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid channel base URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) throw new Error('Invalid channel base URL');
  return url.href;
}

export function generateChannel({ existingIndex = null, candidate, launcherBytes, channelBaseUrl = CHANNEL_BASE_URL, qualifiedAt = new Date().toISOString() }) {
  if (!Buffer.isBuffer(launcherBytes) || launcherBytes.length === 0) throw new Error('Launcher file is empty');
  const channelBase = assertChannelBase(channelBaseUrl);
  const byVersion = new Map();
  if (existingIndex !== null) {
    if (!existingIndex || existingIndex.schemaVersion !== 1 || !Array.isArray(existingIndex.versions) || existingIndex.versions.length > 100) throw new Error('Invalid existing channel index');
    for (const entry of existingIndex.versions) {
      const normalized = normalizeEntry(entry, qualifiedAt);
      const prior = byVersion.get(normalized.version);
      if (prior && (prior.sha512 !== normalized.sha512 || prior.size !== normalized.size)) throw new Error(`Official version identity changed: ${normalized.version}`);
      byVersion.set(normalized.version, normalized);
    }
  }
  const incoming = normalizeEntry(candidate, qualifiedAt);
  const prior = byVersion.get(incoming.version);
  if (prior && (prior.sha512 !== incoming.sha512 || prior.size !== incoming.size)) throw new Error(`Official version identity changed: ${incoming.version}`);
  byVersion.set(incoming.version, incoming);

  const versions = [...byVersion.values()].sort((a, b) => compareVersions(a.version, b.version)).slice(-MAX_VERSIONS);
  if (versions.length === 0) throw new Error('No qualified official versions');
  const latest = versions.at(-1);
  const filename = `deepseek-harness-${latest.version}-win-x64.exe`;
  const launcherSha512 = createHash('sha512').update(launcherBytes).digest('base64');
  const releaseDate = new Date(qualifiedAt).toISOString();
  const feed = [
    `version: ${latest.version}`,
    'files:',
    `  - url: ${channelBase}${filename}`,
    `    sha512: ${launcherSha512}`,
    `    size: ${launcherBytes.length}`,
    `path: ${filename}`,
    `sha512: ${launcherSha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');
  return {
    index: { schemaVersion: 1, versions },
    feed,
    launcherSha512,
    launcherSize: launcherBytes.length,
    launcherFiles: versions.slice(-2).map(entry => `deepseek-harness-${entry.version}-win-x64.exe`),
  };
}

async function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!key?.startsWith('--') || !args[i + 1] || values[key.slice(2)] !== undefined) throw new Error('Usage: node build-channel.mjs --candidate FILE --launcher FILE --output DIR [--index FILE]');
    values[key.slice(2)] = args[i + 1];
  }
  if (Object.keys(values).some(key => !['candidate', 'launcher', 'output', 'index', 'base-url'].includes(key)) || !values.candidate || !values.launcher || !values.output) throw new Error('Usage: node build-channel.mjs --candidate FILE --launcher FILE --output DIR [--index FILE] [--base-url URL]');
  return values;
}

async function main() {
  const args = await parseArgs(process.argv.slice(2));
  let existingIndex = null;
  if (args.index) existingIndex = JSON.parse(await readFile(args.index, 'utf8'));
  const rawCandidate = JSON.parse(await readFile(args.candidate, 'utf8'));
  const candidate = { ...rawCandidate, installerUrl: rawCandidate.installerUrl ?? rawCandidate.url };
  const launcherBytes = await readFile(args.launcher);
  const generated = generateChannel({ existingIndex, candidate, launcherBytes, channelBaseUrl: args['base-url'] ?? CHANNEL_BASE_URL });
  const output = resolve(args.output);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'index.json'), `${JSON.stringify(generated.index, null, 2)}\n`, { flag: 'wx' });
  await writeFile(resolve(output, 'nightly.yml'), generated.feed, { flag: 'wx' });
  for (const filename of generated.launcherFiles) await copyFile(args.launcher, resolve(output, filename));
  console.log(JSON.stringify({ latest: generated.index.versions.at(-1).version, versions: generated.index.versions.length, launcherFiles: generated.launcherFiles, launcherSha512: generated.launcherSha512, launcherSize: generated.launcherSize }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
