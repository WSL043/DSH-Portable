import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const yaml = requireApp('js-yaml');

test('alpha.4 workflow parses, uses production channel constants, smoke-tests, and can only publish a draft', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const source = await readFile(file, 'utf8');
  const workflow = yaml.load(source);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.deepEqual(workflow.jobs.package.permissions, { contents: 'read' });
  assert.deepEqual(workflow.jobs['draft-release'].permissions, { contents: 'write' });
  assert.match(source, /official-payload\/channel\/constants\.mjs/);
  const selector = await readFile(new URL('../experiments/official-payload/channel/select-candidate.mjs', import.meta.url), 'utf8');
  assert.match(selector, /redirect:\s*'follow'/);
  assert.match(source, /-FeedUrl \$urls\.channelBaseUrl[\s\S]*-IndexUrl \$urls\.indexUrl/);
  assert.match(source, /smoke-alpha-seeded\.ps1/);
  assert.match(source, /DSH-Portable-1\.0\.0-alpha\.4-windows-x64-lite\.zip/);
  assert.match(source, /\$liteBytes -ge 40MB/);
  assert.match(source, /launcher\/bootstrap\.json/);
  assert.match(source, /-Bootstrap/);
  assert.match(source, /\$zipHash  DSH-Portable-1\.0\.0-alpha\.4-windows-x64\.zip/);
  assert.match(source, /\$liteZipHash  DSH-Portable-1\.0\.0-alpha\.4-windows-x64-lite\.zip/);
  assert.equal(workflow.jobs.package['timeout-minutes'], 90);
  const packageStep = workflow.jobs.package.steps.find(step => step.name === 'Package the pure portable layout against the production channel');
  for (const path of ['DeepSeek Harness Portable.exe', 'launcher/apply-update.ps1', 'launcher/Payload.psm1', 'launcher/follow.json', 'launcher/bootstrap.json', 'launcher/7z.exe', 'launcher/seed/seed.json']) {
    assert.ok(packageStep.run.includes(path), `lite package allowlist assertion is missing ${path}`);
  }
  assert.match(packageStep.run, /app\/current\.json/);
  assert.match(packageStep.run, /Get-ChildItem -LiteralPath \(Join-Path \$liteRoot 'app'\) -Directory/);
  assert.match(source, /--draft/);
  // An alpha is always a draft AND a prerelease, so publishing it can never make it the repository's Latest release.
  assert.match(source, /--draft --prerelease --latest=false/);
  assert.match(source, /-F draft=true -F prerelease=true/);
  assert.doesNotMatch(source, /prerelease=false|--latest(?!=false)/);
});

test('alpha.4 pins the two default plugin sources and packages their asserted CI-built versions', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const source = await readFile(file, 'utf8');
  const workflow = yaml.load(source);
  assert.match(workflow.env.IMAGE_VIEWER_COMMIT, /^[0-9a-f]{40}$/);
  assert.match(workflow.env.CHAT_MANAGER_COMMIT, /^[0-9a-f]{40}$/);
  assert.equal(workflow.env.IMAGE_VIEWER_VERSION, '0.1.5');
  assert.equal(workflow.env.CHAT_MANAGER_VERSION, '1.5.4');
  const pluginCheckouts = workflow.jobs.package.steps.filter(step => step.uses === 'actions/checkout@v7' && step.with?.repository);
  assert.deepEqual(pluginCheckouts.map(step => [step.with.repository, step.with.ref]), [
    ['${{ env.IMAGE_VIEWER_REPOSITORY }}', '${{ env.IMAGE_VIEWER_COMMIT }}'],
    ['${{ env.CHAT_MANAGER_REPOSITORY }}', '${{ env.CHAT_MANAGER_COMMIT }}'],
  ]);
  assert.match(source, /version = \$env:IMAGE_VIEWER_VERSION/);
  assert.match(source, /version = \$env:CHAT_MANAGER_VERSION/);
  assert.match(source, /\[string\]\$manifest\.version -cne \[string\]\$target\.version/);
  assert.match(source, /dsh-image-viewer-' \+ \$env:IMAGE_VIEWER_VERSION \+ '\.tgz/);
  assert.match(source, /dsh-chat-manager-' \+ \$env:CHAT_MANAGER_VERSION \+ '\.tgz/);
  assert.doesNotMatch(source, /dsh-image-viewer-0\.1\.5\.tgz|dsh-chat-manager-1\.5\.4\.tgz/);
  assert.match(source, /pnpm run test:behavior/);
  assert.match(source, /pnpm run build/);
  assert.match(source, /pnpm pack --pack-destination/);
  // PowerShell rejects a repeated parameter: both archives must travel in one array argument.
  assert.equal((source.match(/-SeedPlugin\b/g) ?? []).length, 2);
  assert.match(source, /-SeedPlugin @\(\$imageViewer, \$chatManager\)/);
});

test('alpha.4 failure evidence upload excludes the official payload', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const workflow = yaml.load(await readFile(file, 'utf8'));
  const steps = workflow.jobs.package.steps;
  const evidence = steps.find(step => step.with?.name === 'official-pure-alpha-4-seed-smoke-evidence');
  assert.ok(evidence);
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with.path, 'build/orch-080/T32/evidence/');
  assert.doesNotMatch(evidence.with.path, /\.zip|(?:^|\/)package(?:\/|$)|(?:^|\/)app(?:\/|$)/i);
  const releaseAssets = steps.find(step => step.with?.name === 'official-pure-alpha-4-draft-assets');
  assert.ok(releaseAssets);
  assert.equal(releaseAssets.if, 'success()');
  assert.match(releaseAssets.with.path, /DSH-Portable-1\.0\.0-alpha\.4-windows-x64\.zip/);
  assert.match(releaseAssets.with.path, /DSH-Portable-1\.0\.0-alpha\.4-windows-x64-lite\.zip/);
  assert.match(releaseAssets.with.path, /smoke-root-moved\/smoke-report\.json/);
});

test('the alpha workflow checks out this repository first, before the plugin repositories', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const workflow = yaml.load(await readFile(file, 'utf8'));
  const first = workflow.jobs.package.steps[0];
  assert.match(first.uses, /^actions\/checkout@/);
  assert.equal(first.with, undefined);
});
