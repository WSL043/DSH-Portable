import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const yaml = requireApp('js-yaml');

test('alpha seed smoke preserves the first launch and verifies seeding, health, disabled config, and relocation on Windows PowerShell 5.1', async () => {
  const source = await readFile(new URL('../experiments/official-payload/e2e/smoke-alpha-seeded.ps1', import.meta.url), 'utf8');
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url), 'utf8'));
  const smokeStep = workflow.jobs.package.steps.find(step => step.name === 'Smoke first and second startup, plugin-free config, and moved root');
  assert.equal(smokeStep.shell, 'powershell');
  assert.match(source, /PSEdition -ne 'Desktop'/);
  assert.match(source, /channel[\\/]smoke-package\.ps1/);
  assert.match(source, /seed-status\.json/);
  assert.match(source, /seeded\.json/);
  assert.match(source, /\$status\.status -cne 'complete'/);
  assert.match(source, /\$_\.status -ceq 'seeded'/);
  assert.match(source, /dsh-chat-manager\|dsh-image-viewer/);
  assert.match(source, /\[switch\]\$NoSeed/);
  assert.match(source, /A plugin-free package must not contain or create seed state/);
  assert.match(source, /AddSeconds\(20\)/);
  assert.match(source, /verify-smoke-page\.mjs/);
  assert.match(source, /close-app\.mjs/);
  assert.match(source, /Copy-Item -LiteralPath \$desktop -Destination \$probe -Recurse/);
  assert.match(source, /--profile probe --dump-config/);
  // Off means installed but outside profile bundles, so the entry is not composed at all.
  assert.match(source, /is enabled in profile bundles/);
  assert.match(source, /is composed although the plugin is off/);
  assert.match(source, /\[IO\.Directory\]::Move\(\$WorkRoot, \$MovedRoot\)/);
  assert.match(source, /Assert-DisabledDump \$MovedRoot 'after-move'/);
  assert.match(source, /\[IO\.FileShare\]::ReadWrite -bor \[IO\.FileShare\]::Delete/);
  assert.doesNotMatch(source, /New-Object System\.Collections\.Generic\.List/);
  assert.doesNotMatch(source, /[^\x00-\x7F]/);
});


test('all alpha smokes retain online Lite install and additionally exercise the signed local Root handoff', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs.package.steps;
  const online = steps.find(step => step.name === 'Smoke lite bootstrap install from the accepted channel and official CDN');
  const local = steps.find(step => step.name === 'Smoke lite first install from the already downloaded signed installer');
  assert.equal(online.if, "inputs.smoke == 'all' || inputs.smoke == 'lite'");
  assert.ok(!online.run.includes('LocalInstallerFile'));
  assert.equal(local.if, "inputs.smoke == 'all'");
  assert.equal(local.env.INSTALLER, '${{ steps.installer.outputs.installer }}');
  assert.ok(local.run.includes('-LocalInstallerFile $env:INSTALLER'));
  assert.ok(local.run.includes("-EvidenceRoot 'build/orch-080/T32/lite-evidence/local-first-install'"));
  assert.doesNotMatch(local.run, /Invoke-WebRequest|download|publish/);
  const wrapper = await readFile(new URL('../experiments/official-payload/e2e/smoke-alpha-seeded.ps1', import.meta.url), 'utf8');
  assert.ok(wrapper.includes('-LocalInstallerFile $LocalInstallerFile'));
  assert.ok(wrapper.includes('$firstStartReport.overallPassed -ne $true'));
  assert.ok(wrapper.includes('$firstStartReport.launcherExitCode -ne 0'));
  assert.ok(!wrapper.includes("$LASTEXITCODE -ne 0) { throw 'First-start package smoke failed."));
  const smoke = await readFile(new URL('../experiments/official-payload/channel/smoke-package.ps1', import.meta.url), 'utf8');
  assert.ok(!smoke.includes('Get-LatestAcceptedIndexCandidate'), 'local smoke must allow any uniquely matched accepted installer, including an explicitly selected older version');
  for (const boundary of ['Get-AcceptedInstallerCandidate (Read-LocalAcceptedIndex $snapshotPath) $LocalInstallerFile', 'Assert-Installer $LocalInstallerFile $localCandidate',
    "$arguments = '--installer-file", 'MaintenanceCallerPid', 'Get-LocalOfficialWindow $current.version',
    '$localWindow.CloseMainWindow()', '$launcherProcess.ExitCode -ne 0', 'if ($Bootstrap) { $current = Read-SharedJson $currentPath }', 'cdpDeferredToSecondStart=$true']) assert.ok(smoke.includes(boundary), boundary);
});
