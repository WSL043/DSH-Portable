import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstatSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = realpathSync(process.cwd());
function localPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Missing workspace path');
  const path = resolve(workspace, value);
  if (path === workspace) return workspace;
  if (!path.startsWith(workspace + sep)) throw new Error('Security path escapes the workspace');
  for (let ancestor = path; ancestor !== workspace; ancestor = dirname(ancestor)) {
    if (!ancestor.startsWith(workspace + sep)) throw new Error('Security ancestor escapes the workspace');
    try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Security path contains a link'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}
function reportKind(value) {
  const kind = ['full', 'lite', 'candidate'].find(kind => kind === value);
  if (!kind) throw new Error('Unknown security report kind');
  return kind;
}
function candidateVersion(candidate) {
  if (typeof candidate.version !== 'string' || candidate.version.trim() !== candidate.version
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(candidate.version)) throw new Error('Invalid official version');
  return candidate.version;
}
const digest = async path => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(localPath(path))) hash.update(bytes);
  return hash.digest('hex');
};

async function collect() {
  const directory = localPath(process.env.SECURITY_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const candidateBytes = await readFile(localPath(process.env.SECURITY_CANDIDATE));
  const candidate = JSON.parse(candidateBytes);
  candidateVersion(candidate);
  await writeFile(localPath(join(directory, 'selection.json')), candidateBytes);
  const provenance = { schemaVersion: 1, repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    sourceSha: process.env.GITHUB_SHA, officialVersion: candidate.version,
    candidateSHA256: createHash('sha256').update(candidateBytes).digest('hex'), entries: [], assets: [] };
  // report-only exit 0 is evidence collection, never publication authorization.
  for (const [inputKind, root] of JSON.parse(process.env.SECURITY_ROOTS)) {
    const kind = reportKind(inputKind);
    const asar = localPath(join(localPath(root), 'app', candidate.version, 'resources', 'app.asar'));
    const reportPath = localPath(join(directory, kind + '.json'));
    const verifiedPath = localPath(join(directory, kind + '-verified.json'));
    const entry = { kind, appASARPath: asar, qualificationAllowed: false };
    try {
      for (const args of [[], ['--verify-report', reportPath]]) {
        const output = args.length ? verifiedPath : reportPath;
        const child = spawnSync(process.execPath, [fileURLToPath(new URL('./check-official-payload-security.mjs', import.meta.url)), asar,
          '--output', output, '--report-only', ...args], { encoding: 'utf8' });
        if (child.status !== 0) throw new Error(child.stderr || child.error?.message || 'Security collection failed');
      }
      const report = JSON.parse(await readFile(localPath(verifiedPath), 'utf8'));
      Object.assign(entry, { reportSHA256: await digest(reportPath), verifiedSHA256: await digest(verifiedPath),
        appASARBytes: report.appASARBytes, appASARsha256: report.appASARsha256,
        qualificationAllowed: report.qualificationAllowed === true && report.verifiedReport?.passed === true
          && report.officialVersion === candidate.version && report.appASARPath === asar });
    } catch (error) { entry.error = error.message; }
    provenance.entries.push(entry);
  }
  for (const path of JSON.parse(process.env.SECURITY_ASSETS || '[]')) {
    provenance.assets.push({ name: path.replaceAll('\\', '/').split('/').at(-1), sha256: await digest(path) });
  }
  provenance.qualificationAllowed = provenance.entries.length > 0
    && provenance.entries.every(entry => entry.qualificationAllowed === true);
  await writeFile(localPath(join(directory, 'provenance.json')), JSON.stringify(provenance, null, 2) + '\n');
  await writeFile(localPath(join(directory, 'summary.md')), '### Official payload security\n\n'
    + 'Runtime acceptance and security are independent. Runtime acceptance passing does not establish publication qualification.\n\n'
    + provenance.entries.map(entry => '- ' + entry.kind + ': **' + (entry.qualificationAllowed ? 'allowed for the checked advisory' : 'security blocked') + '**').join('\n')
    + '\n\nreport-only exit 0 only retains evidence; publication requires bound reports with qualificationAllowed === true.\n');
}

async function authorize() {
  const directory = localPath(process.env.SECURITY_DIRECTORY);
  const read = async name => JSON.parse(await readFile(localPath(join(directory, name)), 'utf8'));
  const provenance = await read('provenance.json');
  const candidatePath = localPath(process.env.SECURITY_CANDIDATE);
  const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
  candidateVersion(candidate);
  if (provenance.schemaVersion !== 1 || provenance.qualificationAllowed !== true
    || provenance.repository !== process.env.GITHUB_REPOSITORY || provenance.sourceSha !== process.env.GITHUB_SHA
    || provenance.runId !== process.env.GITHUB_RUN_ID || provenance.runAttempt !== process.env.GITHUB_RUN_ATTEMPT
    || provenance.officialVersion !== process.env.SECURITY_EXPECTED_VERSION
    || candidate.version !== process.env.SECURITY_EXPECTED_VERSION
    || provenance.candidateSHA256 !== await digest(candidatePath)) throw new Error('Security provenance missing, blocked, or not bound to this run/source/candidate');
  const kinds = JSON.parse(process.env.SECURITY_KINDS).map(reportKind);
  if (!Array.isArray(provenance.entries) || provenance.entries.length !== kinds.length) throw new Error('Security report set is incomplete');
  for (const kind of kinds) {
    const entry = provenance.entries.find(item => item.kind === kind);
    if (!entry || entry.qualificationAllowed !== true || !/^[a-f0-9]{64}$/.test(entry.appASARsha256)
      || !Number.isSafeInteger(entry.appASARBytes) || entry.appASARBytes <= 0
      || typeof entry.appASARPath !== 'string'
      || !entry.appASARPath.replaceAll('\\', '/').endsWith('/app/' + candidate.version + '/resources/app.asar')) throw new Error('Security ASAR binding is incomplete');
    for (const [name, expectedHash, verified] of [[kind + '.json', entry.reportSHA256, false], [kind + '-verified.json', entry.verifiedSHA256, true]]) {
      if (await digest(join(directory, name)) !== expectedHash) throw new Error('Security report digest mismatch');
      const report = await read(name);
      if (report.schemaVersion !== 1 || report.qualificationAllowed !== true || report.status !== 'allowed-for-this-advisory'
        || report.advisory?.id !== 'GHSA-6prh-2h8m-c8cw' || report.advisory.affected !== false
        || report.officialVersion !== candidate.version || report.appASARsha256 !== entry.appASARsha256
        || report.appASARBytes !== entry.appASARBytes || report.appASARPath !== entry.appASARPath
        || (verified && report.verifiedReport?.passed !== true)) throw new Error('Official ASAR security report does not authorize publication');
    }
  }
  const assets = JSON.parse(process.env.SECURITY_ASSETS || '[]');
  if (!Array.isArray(provenance.assets) || provenance.assets.length !== assets.length) throw new Error('Security asset binding is incomplete');
  for (const path of assets) {
    const expected = provenance.assets.find(asset => asset.name === path.replaceAll('\\', '/').split('/').at(-1));
    if (!expected || expected.sha256 !== await digest(path)) throw new Error('Security package digest mismatch');
  }
  console.log('Bound actual-ASAR security reports allow the checked advisory; other runtime/publication gates still apply.');
}

const mode = process.argv[2];
if (!['collect', 'authorize'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: official-payload-security-evidence.mjs collect|authorize');
try { await (mode === 'collect' ? collect() : authorize()); }
catch (error) { console.error(error.message); process.exitCode = 1; }
