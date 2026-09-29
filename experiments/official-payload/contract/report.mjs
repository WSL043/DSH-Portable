import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_IDS = [
  'feed-http-accepted', 'installer-downloaded', 'blockmap-404-tolerated', 'update-dialog-shown',
  'install-invoked-installer', 'app-exited-after-install', 'userdata-redirected',
  'protocol-registered-to-app-exe', 'no-preexisting-official-instance',
  'static-app-update-yml', 'static-asar-manifest', 'static-nsis-updater',
];

const parseRequests = value => (value ?? []).map(item => typeof item === 'string' ? JSON.parse(item) : item);

export function validateInstallerCall(call, { version, cacheRoot }) {
  if (!call) return { passed: false, evidence: 'No stub invocation was recorded' };
  const expectedName = `deepseek-harness-${version}-win-x64.exe`;
  const expectedArgs = ['--updated', '/S', '--force-run'];
  const actualArgs = Array.isArray(call.argv) ? call.argv : [];
  const normalized = path.win32.resolve(call.executablePath ?? '');
  const expected = path.win32.resolve(cacheRoot, 'pending', expectedName);
  const exactPath = normalized.toLowerCase() === expected.toLowerCase();
  const argsOk = JSON.stringify(actualArgs) === JSON.stringify(expectedArgs);
  const evidence = { executablePath: call.executablePath ?? null, expectedPath: expected, argv: actualArgs, expectedArgv: expectedArgs, exactPath, argsMatch: argsOk };
  return { passed: exactPath && argsOk, evidence };
}

export function buildContractReport(input = {}) {
  const requests = parseRequests(input.requests);
  const hasRequest = (suffix, status) => requests.some(item => item.method === 'GET' && item.path === suffix && (status === undefined || Number(item.status) === status));
  const calls = (input.stubCalls ?? []).map(item => typeof item === 'string' ? JSON.parse(item) : item);
  const call = calls.find(item => item.argv?.[0] === '--updated') ?? calls[0];
  const callResult = validateInstallerCall(call, { version: input.version ?? 'unknown', cacheRoot: input.cacheRoot ?? 'C:\\missing-cache' });
  const before = input.defaultDataBefore ?? [];
  const after = input.defaultDataAfter ?? [];
  const userFiles = input.userDataFiles ?? [];
  const resultById = new Map();
  const put = (id, passed, evidence) => resultById.set(id, { id, passed: Boolean(passed), evidence });

  put('feed-http-accepted', hasRequest('/nightly.yml', 200), requests.filter(item => item.path === '/nightly.yml'));
  const installerPath = `/deepseek-harness-${input.version ?? 'unknown'}-win-x64.exe`;
  put('installer-downloaded', hasRequest(installerPath, 200) && input.installerFileExists === true, { request: requests.find(item => item.path === installerPath), installerFileExists: Boolean(input.installerFileExists) });
  const blockmapPath = `${installerPath}.blockmap`;
  put('blockmap-404-tolerated', hasRequest(blockmapPath, 404) && input.updateDialogShown === true, { request: requests.find(item => item.path === blockmapPath), updateDialogShown: Boolean(input.updateDialogShown) });
  put('update-dialog-shown', input.updateDialogShown === true, input.updateDialogEvidence ?? 'UI evidence not recorded');
  put('install-invoked-installer', callResult.passed, callResult.evidence);
  put('app-exited-after-install', input.appExitedAfterInstall === true, input.appExitEvidence ?? 'App exit not observed');
  const dataUnchanged = JSON.stringify(before) === JSON.stringify(after);
  put('userdata-redirected', userFiles.length > 0 && dataUnchanged, { redirectedFiles: userFiles, defaultDataUnchanged: dataUnchanged });
  const protocolMatches = typeof input.protocolPath === 'string' && typeof input.appExe === 'string' && path.win32.resolve(input.protocolPath).toLowerCase() === path.win32.resolve(input.appExe).toLowerCase();
  put('protocol-registered-to-app-exe', protocolMatches, { registeredPath: input.protocolPath ?? null, appExe: input.appExe ?? null, matches: protocolMatches });
  put('no-preexisting-official-instance', input.noPreexistingOfficialInstance === true, input.preflightEvidence ?? 'Preflight not completed');
  for (const id of REQUIRED_IDS.slice(9)) {
    const staticCheck = input.staticChecks?.find(item => item.id === id);
    put(id, staticCheck?.passed === true, staticCheck?.evidence ?? 'Static check did not run');
  }
  const results = REQUIRED_IDS.map(id => resultById.get(id));
  return {
    version: input.version ?? null,
    sourceVersion: input.rewriteEvidence?.sourceVersion ?? input.sourceVersion ?? null,
    overallPassed: results.every(item => item.passed),
    results,
    directoryOutsideWrites: input.directoryOutsideWrites ?? [],
    diagnostics: {
      failure: input.failure ?? null,
      preflight: input.preflightEvidence ?? null,
      rewrite: input.rewriteEvidence ?? null,
      feedUrl: input.feedUrl ?? null,
      cacheRoot: input.cacheRoot ?? null,
      cdpPort: input.cdpPort ?? null,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Usage: node report.mjs <input.json> <contract-report.json>');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const report = buildContractReport(input);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ overallPassed: report.overallPassed, results: report.results.map(({ id, passed }) => ({ id, passed })) }));
  if (!report.overallPassed) process.exitCode = 1;
}
