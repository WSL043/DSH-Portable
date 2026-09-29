import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function findEntry(node, path) {
  let current = node;
  for (const part of path.split('/')) current = current?.files?.[part];
  return current;
}

export function readAsarFile(archive, entryPath) {
  const bytes = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  if (bytes.length < 16 || bytes.readUInt32LE(0) !== 4) throw new Error('Unsupported ASAR header');
  const headerSize = bytes.readUInt32LE(4);
  const jsonSize = bytes.readUInt32LE(12);
  if (headerSize > 20 * 1024 * 1024 || jsonSize < 2 || jsonSize > headerSize || 16 + jsonSize > bytes.length) throw new Error('Invalid ASAR index');
  const header = JSON.parse(bytes.toString('utf8', 16, 16 + jsonSize));
  let entry = findEntry(header, entryPath);
  if (!entry && entryPath.startsWith('dsh/')) entry = findEntry(header, entryPath.slice(4));
  if (!entry || entry.files || entry.unpacked) throw new Error(`ASAR entry unavailable: ${entryPath}`);
  const start = 8 + headerSize + Number(entry.offset);
  const end = start + Number(entry.size);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > bytes.length) throw new Error(`Invalid ASAR entry bounds: ${entryPath}`);
  return bytes.subarray(start, end);
}

export function checkNsisUpdater(source) {
  const failures = [];
  if (!/\[\s*["']--updated["']\s*\]/.test(source)) failures.push('NsisUpdater.js no longer seeds installer argv with --updated');
  if (!/args\.push\(\s*["']--force-run["']\s*\)/.test(source)) failures.push('NsisUpdater.js no longer appends --force-run for forced restart');
  if (!/publisherName\s*==\s*null[\s\S]{0,240}?return\s+null\s*;/.test(source)) failures.push('NsisUpdater.js no longer skips signature verification when publisherName is null');
  return { passed: failures.length === 0, failures };
}

export async function inspectPayload({ appUpdatePath, asarPath }) {
  const checks = [];
  let version = null;
  try {
    const config = await readFile(appUpdatePath, 'utf8');
    const missing = ['provider: generic', 'url:', 'channel:', 'updaterCacheDirName:'].filter(key => !new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').test(config));
    checks.push({ id: 'static-app-update-yml', passed: missing.length === 0, evidence: missing.length ? `Missing expected key(s): ${missing.join(', ')}` : 'resources/app-update.yml has provider, url, channel, and updaterCacheDirName' });
  } catch (error) {
    checks.push({ id: 'static-app-update-yml', passed: false, evidence: String(error) });
  }
  let archive;
  try {
    archive = await readFile(asarPath);
    const manifest = JSON.parse(readAsarFile(archive, 'package.json').toString('utf8'));
    version = manifest.version ?? null;
    const ok = typeof version === 'string' && !!manifest.dshMandatoryUpdatePolicy;
    checks.push({ id: 'static-asar-manifest', passed: ok, evidence: ok ? `package.json version=${version}; dshMandatoryUpdatePolicy present` : 'app.asar package.json is missing version or dshMandatoryUpdatePolicy' });
  } catch (error) {
    checks.push({ id: 'static-asar-manifest', passed: false, evidence: String(error) });
  }
  try {
    if (!archive) throw new Error('app.asar unavailable after manifest inspection');
    const updater = readAsarFile(archive, 'node_modules/electron-updater/out/NsisUpdater.js').toString('utf8');
    const result = checkNsisUpdater(updater);
    checks.push({ id: 'static-nsis-updater', passed: result.passed, evidence: result.passed ? 'NsisUpdater.js contains the updated/force-run and publisherName-null contracts' : result.failures.join('; ') });
  } catch (error) {
    checks.push({ id: 'static-nsis-updater', passed: false, evidence: String(error) });
  }
  return { version, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [appUpdatePath, asarPath, outputPath] = process.argv.slice(2);
  if (!appUpdatePath || !asarPath || !outputPath) throw new Error('Usage: node static-check.mjs <app-update.yml> <app.asar> <output.json>');
  const result = await inspectPayload({ appUpdatePath, asarPath });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  if (result.checks.some(check => !check.passed)) process.exitCode = 1;
}
