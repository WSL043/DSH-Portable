import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/;
const OFFICIAL_PUBLISHER = 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.';

export const REQUIRED_IDS = [
  'old-app-running-from-root',
  'update-copy-executed',
  'update-applied',
  'current-switched',
  'new-app-running',
  'health-cleared',
  'rewritten-app-update-yml',
  'protocol-owned-while-running',
  'protocol-restored-after-exit',
  'only-two-versions-kept',
  'no-outside-writes',
  'rollback-to-previous',
];

export function normalizeOfficialCandidate(source) {
  if (!source || !VERSION_RE.test(String(source.version ?? ''))) throw new Error('Invalid official candidate version');
  const installerUrl = source.installerUrl ?? source.url;
  let uri;
  try { uri = new URL(installerUrl); } catch { throw new Error('Invalid official candidate installer URL'); }
  if (uri.protocol !== 'https:' || uri.hostname !== 'download.deepseek.com' || uri.port || !uri.pathname.startsWith('/dsh-desk/bin/win-x64/')) {
    throw new Error('Candidate URL is outside the official Windows installer path');
  }
  const digest = String(source.sha512 ?? '');
  const decoded = Buffer.from(digest, 'base64');
  const size = Number(source.size);
  if (decoded.length !== 64 || decoded.toString('base64') !== digest || !Number.isSafeInteger(size) || size < 1_000_000 || size > 2_147_483_648) {
    throw new Error('Invalid official installer digest or size');
  }
  return {
    schemaVersion: 1,
    version: String(source.version),
    url: uri.toString(),
    size,
    sha512: digest,
    publisher: source.publisher ?? OFFICIAL_PUBLISHER,
    qualification: source.qualification ?? 'pending',
    launcherProtocol: source.launcherProtocol ?? 2,
  };
}

export function serializeCandidateFile(source) {
  return JSON.stringify(normalizeOfficialCandidate(source), null, 2) + '\n';
}

export function buildAcceptedIndex(oldCandidate, newCandidate) {
  const versions = [oldCandidate, newCandidate].map(source => {
    const candidate = normalizeOfficialCandidate(source);
    return { version: candidate.version, installerUrl: candidate.url, sha512: candidate.sha512, size: candidate.size };
  });
  if (versions[0].version === versions[1].version) throw new Error('Old and new official versions must differ');
  return { versions };
}

export function isPathOwnedByRoot(target, root) {
  if (typeof target !== 'string' || typeof root !== 'string' || !target || !root) return false;
  const absoluteRoot = path.win32.resolve(root);
  const absoluteTarget = path.win32.resolve(target);
  const relative = path.win32.relative(absoluteRoot, absoluteTarget);
  return relative === '' || (relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative));
}

export function expectedProtocolCommand(launcherPath) {
  return '"' + path.win32.resolve(launcherPath) + '" --open "%1"';
}

export function packageFeedContract(follow, appUpdateYml) {
  const urlMatch = String(appUpdateYml ?? '').match(/^url:\s*(\S+)\s*$/m);
  const cacheMatch = String(appUpdateYml ?? '').match(/^updaterCacheDirName:\s*"?([^"\s]+)"?\s*$/m);
  const feedUrl = follow?.feedUrl;
  const cacheDirName = follow?.cacheDirName;
  return {
    passed: typeof feedUrl === 'string' && Boolean(urlMatch) && urlMatch[1] === feedUrl &&
      typeof cacheDirName === 'string' && Boolean(cacheMatch) && cacheMatch[1] === cacheDirName &&
      !/^publisherName:/m.test(String(appUpdateYml ?? '')),
    evidence: { feedUrl: feedUrl ?? null, appUpdateUrl: urlMatch?.[1] ?? null, cacheDirName: cacheDirName ?? null, appUpdateCacheDirName: cacheMatch?.[1] ?? null },
  };
}

export function buildPureE2EReport(input = {}) {
  const checks = input.checks ?? {};
  const results = REQUIRED_IDS.map(id => {
    const check = checks[id];
    let passed = check?.passed === true;
    let evidence = check?.evidence ?? 'Not run';
    if (id === 'old-app-running-from-root') {
      const details = evidence && typeof evidence === 'object' ? evidence : {};
      const pathOwned = isPathOwnedByRoot(details.primaryExecutablePath, details.portableRoot);
      passed = passed && pathOwned && details.userDataInsidePortableRoot === true;
      evidence = { ...details, pathOwnedByRoot: pathOwned };
    } else if (id === 'protocol-owned-while-running') {
      const details = evidence && typeof evidence === 'object' ? evidence : {};
      const expected = details.launcherPath ? expectedProtocolCommand(details.launcherPath) : null;
      const samples = Array.isArray(details.samples) ? details.samples : [];
      const commandsMatch = Boolean(expected) && samples.length > 0 && samples.every(sample => sample?.valueExists === true && sample.value === expected);
      const link = details.linkHandoff;
      const linkHandoffPassed = link?.passed === true && link.noNewOfficialInstance === true && link.noErrorDialog === true;
      passed = passed && commandsMatch && linkHandoffPassed;
      evidence = { ...details, expectedCommand: expected, allObservedCommandsMatch: commandsMatch, linkHandoffPassed };
    }
    return { id, passed, evidence };
  });
  return {
    oldVersion: input.oldVersion ?? null,
    newVersion: input.newVersion ?? null,
    overallPassed: !input.failure && results.every(item => item.passed),
    results,
    outsideWriteDifferences: input.outsideWriteDifferences ?? [],
    diagnostics: {
      failure: input.failure ?? null,
      feedUrl: input.feedUrl ?? null,
      indexUrl: input.indexUrl ?? null,
      workRoot: input.workRoot ?? null,
      stages: input.stages ?? [],
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === 'candidate') {
    if (args.length !== 3) throw new Error('Usage: node report.mjs candidate <source.json> <candidate.json>');
    const source = JSON.parse(await readFile(args[1], 'utf8'));
    await writeFile(args[2], serializeCandidateFile(source));
    console.log(JSON.stringify({ version: normalizeOfficialCandidate(source).version, output: args[2] }));
  } else {
    const [inputPath, outputPath] = args;
    if (!inputPath || !outputPath) throw new Error('Usage: node report.mjs <input.json> <pure-e2e-report.json>');
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const report = buildPureE2EReport(input);
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ overallPassed: report.overallPassed, results: report.results.map(({ id, passed }) => ({ id, passed })) }));
    if (!report.overallPassed) process.exitCode = 1;
  }
}
