import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractReport, REQUIRED_IDS, validateInstallerCall } from '../experiments/official-payload/contract/report.mjs';

test('report marks missing and failed evidence as failures', () => {
  const missing = buildContractReport();
  assert.equal(missing.results.length, REQUIRED_IDS.length);
  assert.ok(missing.results.every(item => item.passed === false));
  const failed = buildContractReport({ requests: [{ method: 'GET', path: '/nightly.yml', status: 500 }] });
  assert.equal(failed.results.find(item => item.id === 'feed-http-accepted').passed, false);
});

test('report accepts only exact updater argv and exact pending executable path', () => {
  const options = { version: '0.2.1-contract.0', cacheRoot: 'C:\\Users\\probe\\AppData\\Local\\dsh-contract-probe-a' };
  const valid = {
    executablePath: `${options.cacheRoot}\\pending\\deepseek-harness-${options.version}-win-x64.exe`,
    argv: ['--updated', '/S', '--force-run'],
  };
  assert.equal(validateInstallerCall(valid, options).passed, true);
  assert.equal(validateInstallerCall({ ...valid, argv: ['--updated', '/S'] }, options).passed, false);
  assert.equal(validateInstallerCall({ ...valid, executablePath: 'C:\\other\\pending\\deepseek-harness-0.2.1-contract.0-win-x64.exe' }, options).passed, false);
});

test('report aggregates successful HTTP, UI, install, data and static evidence', () => {
  const version = '0.2.1-contract.0';
  const cacheRoot = 'C:\\probe\\cache';
  const installer = `deepseek-harness-${version}-win-x64.exe`;
  const report = buildContractReport({
    version, cacheRoot, installerFileExists: true, updateDialogShown: true,
    appExitedAfterInstall: true, noPreexistingOfficialInstance: true,
    appExe: 'C:\\probe\\app\\DeepSeek Harness.exe',
    protocolPath: 'C:\\probe\\app\\DeepSeek Harness.exe',
    requests: [
      { method: 'GET', path: '/nightly.yml', status: 200 },
      { method: 'GET', path: `/${installer}`, status: 200 },
      { method: 'GET', path: `/${installer}.blockmap`, status: 404 },
    ],
    stubCalls: [{ executablePath: `${cacheRoot}\\pending\\${installer}`, argv: ['--updated', '/S', '--force-run'] }],
    userDataFiles: [{ root: 'electron', path: 'Local State' }],
    defaultDataBefore: [{ path: 'sentinel', length: 3, lastWriteUtcTicks: 9 }],
    defaultDataAfter: [{ path: 'sentinel', length: 3, lastWriteUtcTicks: 9 }],
    staticChecks: REQUIRED_IDS.slice(9).map(id => ({ id, passed: true, evidence: 'fixture' })),
  });
  assert.equal(report.overallPassed, true);
  assert.ok(report.results.every(item => item.passed));
});
