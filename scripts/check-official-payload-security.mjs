import { createHash } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ADVISORY = Object.freeze({
  id: 'GHSA-6prh-2h8m-c8cw',
  url: 'https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw',
  affectedRange: '>=2.0.0 <2.3.0',
  patchedVersion: '2.3.0',
});
const ALLOWED = 'allowed-for-this-advisory';
const PACKAGE_PATH = /(?:^|\/)node_modules\/@modelcontextprotocol\/(client|core)\/package\.json$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function versionParts(version) {
  if (typeof version !== 'string') return undefined;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) return undefined;
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

// Prereleases and malformed versions are unknown rather than an inferred pass.
export function affectedClientVersion(version) {
  const parts = versionParts(version);
  if (!parts) return null;
  return parts[0] === 2 && parts[1] < 3;
}

function desktopVersion(version) {
  return typeof version === 'string'
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version);
}

async function readExact(file, size, position) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(bytes, offset, size - offset, position + offset);
    if (!bytesRead) throw new Error('Truncated ASAR entry');
    offset += bytesRead;
  }
  return bytes;
}

function selectedEntries(header) {
  const selected = [];
  const pending = [{ files: header.files, parent: '', depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { files, parent, depth } = pending.pop();
    if (!files || typeof files !== 'object' || Array.isArray(files) || depth > 128) throw new Error('Invalid ASAR directory');
    for (const [name, entry] of Object.entries(files)) {
      if (++count > 200_000) throw new Error('ASAR entry limit exceeded');
      if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)
        || !entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid ASAR entry');
      const path = parent ? `${parent}/${name}` : name;
      if (entry.files !== undefined) pending.push({ files: entry.files, parent: path, depth: depth + 1 });
      else {
        const match = PACKAGE_PATH.exec(path);
        if (path === 'package.json' || match) selected.push({ path, kind: match?.[1] ?? 'desktop', entry });
      }
    }
  }
  return selected;
}

/** Read only package manifests and stream the ASAR digest; never extract or execute its contents. */
export async function inspectOfficialPayloadSecurity(asarPath, { verifyReport } = {}) {
  const result = {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    scope: 'Only GHSA-6prh-2h8m-c8cw in installed MCP client manifests. Not a comprehensive audit or release authorization.',
    officialVersion: null,
    appASARPath: resolve(asarPath),
    appASARBytes: null,
    appASARsha256: null,
    advisory: { ...ADVISORY, affected: null },
    packages: [],
    status: 'blocked',
    qualificationAllowed: false,
    findings: [],
  };
  let file, before;
  try {
    file = await open(result.appASARPath, 'r');
    before = await file.stat();
    result.appASARBytes = before.size;
    if (!before.isFile() || before.size < 16) throw new Error('ASAR is not a complete regular file');
    const prefix = await readExact(file, 16, 0);
    const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    if (prefix.readUInt32LE(0) !== 4 || headerSize < 8 || headerSize > 64 * 1024 * 1024
      || jsonSize < 2 || 16 + jsonSize > 8 + headerSize || 8 + headerSize > before.size) throw new Error('Invalid ASAR header bounds');
    const header = JSON.parse((await readExact(file, jsonSize, 16)).toString('utf8'));
    for (const { path, kind, entry } of selectedEntries(header)) {
      const record = { kind, path, name: null, version: null, sha256: null,
        integrity: { algorithm: entry.integrity?.algorithm ?? null, declared: entry.integrity?.hash ?? null, verified: false } };
      result.packages.push(record);
      try {
        if (entry.unpacked || entry.link !== undefined) throw new Error('Manifest must be a packed regular ASAR entry');
        if (typeof entry.offset !== 'string' || !/^\d+$/.test(entry.offset)
          || !Number.isSafeInteger(entry.size) || entry.size < 2 || entry.size > 1024 * 1024) throw new Error('Invalid manifest bounds');
        const offset = Number(entry.offset), start = 8 + headerSize + offset, end = start + entry.size;
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
          || start < 8 + headerSize || end > before.size) throw new Error('Manifest lies outside ASAR');
        const bytes = await readExact(file, entry.size, start);
        record.sha256 = sha256(bytes);
        if (record.integrity.algorithm !== 'SHA256' || typeof record.integrity.declared !== 'string'
          || !/^[a-f0-9]{64}$/i.test(record.integrity.declared)
          || record.integrity.declared.toLowerCase() !== record.sha256) throw new Error('Missing or mismatched manifest SHA256 integrity');
        record.integrity.verified = true;
        const pkg = JSON.parse(bytes.toString('utf8'));
        const expected = kind === 'desktop' ? '@deepseek-ai/dsh-desktop' : `@modelcontextprotocol/${kind}`;
        record.name = pkg?.name ?? null;
        record.version = pkg?.version ?? null;
        if (record.name !== expected) throw new Error(`Manifest identity is not ${expected}`);
        if (kind === 'desktop') {
          if (!desktopVersion(record.version)) throw new Error('Missing or invalid official desktop version');
          result.officialVersion = record.version;
        } else if (!versionParts(record.version)) throw new Error('Unknown MCP package version (prerelease or malformed)');
      } catch (error) {
        result.findings.push(`${path}: ${error.message}`);
      }
    }
  } catch (error) {
    result.findings.push(`ASAR inspection failed: ${error.message}`);
  } finally {
    if (file) {
      try {
        const hash = createHash('sha256');
        for await (const bytes of file.createReadStream({ start: 0, autoClose: false })) hash.update(bytes);
        result.appASARsha256 = hash.digest('hex');
        const after = await file.stat();
        if (before && (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)) {
          result.findings.push('ASAR changed during inspection');
        }
      } catch (error) { result.findings.push(`ASAR digest failed: ${error.message}`); }
      await file.close();
    }
  }
  for (const kind of ['desktop', 'client', 'core']) {
    if (!result.packages.some(pkg => pkg.kind === kind)) result.findings.push(`Required ${kind} manifest is missing`);
  }
  const clients = result.packages.filter(pkg => pkg.kind === 'client');
  const affected = clients.map(pkg => affectedClientVersion(pkg.version));
  result.advisory.affected = affected.includes(true) ? true
    : clients.length && affected.every(value => value === false) ? false : null;
  if (result.advisory.affected === true) result.findings.push(`${ADVISORY.id}: affected MCP client version found`);
  if (result.advisory.affected === null) result.findings.push('MCP advisory applicability is unknown');
  if (!result.appASARsha256 || !result.officialVersion) result.findings.push('ASAR identity is incomplete');
  if (verifyReport !== undefined) {
    const verification = { path: resolve(verifyReport), passed: false, findings: [] };
    result.verifiedReport = verification;
    try {
      const previous = JSON.parse(await readFile(verification.path, 'utf8'));
      if (previous.schemaVersion !== 1 || previous.advisory?.id !== ADVISORY.id
        || previous.qualificationAllowed !== true || previous.status !== ALLOWED
        || previous.advisory.affected !== false) verification.findings.push('Previous report does not allow this advisory qualification');
      if (previous.appASARsha256 !== result.appASARsha256 || previous.officialVersion !== result.officialVersion
        || previous.appASARBytes !== result.appASARBytes) verification.findings.push('Previous report does not match the actual ASAR identity');
    } catch (error) { verification.findings.push(`Cannot read previous report: ${error.message}`); }
    if (result.findings.length) verification.findings.push('Independent actual-ASAR inspection is blocked');
    verification.passed = verification.findings.length === 0;
    result.findings.push(...verification.findings.map(finding => `Report verification: ${finding}`));
  }
  result.qualificationAllowed = result.findings.length === 0 && result.advisory.affected === false;
  result.status = result.qualificationAllowed ? ALLOWED : 'blocked';
  return result;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    output: { type: 'string' }, 'report-only': { type: 'boolean', default: false },
    'verify-report': { type: 'string' },
  } });
  if (positionals.length !== 1) throw new Error('Usage: node check-official-payload-security.mjs <app.asar> [--output report.json] [--report-only] [--verify-report existing.json]');
  if (values.output && resolve(values.output) === resolve(positionals[0])) throw new Error('Report output must not overwrite the ASAR');
  if (values.output && values['verify-report'] && resolve(values.output) === resolve(values['verify-report'])) throw new Error('Report output must not overwrite the report being verified');
  const report = await inspectOfficialPayloadSecurity(positionals[0], { verifyReport: values['verify-report'] });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) await writeFile(values.output, json);
  process.stdout.write(json);
  if (!report.qualificationAllowed && !values['report-only']) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
