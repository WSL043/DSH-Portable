import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const yaml = requireApp('js-yaml');

test('alpha seed smoke preserves the first launch and verifies seeding, health, disabled config, and relocation on Windows PowerShell 5.1', async () => {
  const source = await readFile(new URL('../experiments/official-payload/e2e/smoke-alpha-seeded.ps1', import.meta.url), 'utf8');
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url), 'utf8'));
  const smokeStep = workflow.jobs.package.steps.find(step => step.name === 'Smoke first and second startup, seed state, disabled config, and moved root');
  assert.equal(smokeStep.shell, 'powershell');
  assert.match(source, /PSEdition -ne 'Desktop'/);
  assert.match(source, /channel[\\/]smoke-package\.ps1/);
  assert.match(source, /seed-status\.json/);
  assert.match(source, /seeded\.json/);
  assert.match(source, /\$status\.status -cne 'complete'/);
  assert.match(source, /\$_\.status -ceq 'seeded'/);
  assert.match(source, /dsh-chat-manager\|dsh-image-viewer/);
  assert.match(source, /AddSeconds\(20\)/);
  assert.match(source, /verify-smoke-page\.mjs/);
  assert.match(source, /close-app\.mjs/);
  assert.match(source, /Copy-Item -LiteralPath \$desktop -Destination \$probe -Recurse/);
  assert.match(source, /--profile probe --dump-config/);
  assert.match(source, /disabled\["''\]\?\\s\*:\\s\*true/);
  assert.match(source, /\[IO\.Directory\]::Move\(\$WorkRoot, \$MovedRoot\)/);
  assert.match(source, /Assert-DisabledDump \$MovedRoot 'after-move'/);
  assert.match(source, /\[IO\.FileShare\]::ReadWrite -bor \[IO\.FileShare\]::Delete/);
  assert.doesNotMatch(source, /New-Object System\.Collections\.Generic\.List/);
  assert.doesNotMatch(source, /[^\x00-\x7F]/);
});
