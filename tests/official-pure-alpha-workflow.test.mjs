import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const yaml = requireApp('js-yaml');

test('the alpha workflow parses, uses production channel constants, smoke-tests, and can only publish a draft', async () => {
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
  assert.match(source, /DSH-Portable-1\.0\.0-alpha\.\$\{\{ env\.ALPHA \}\}-windows-x64-lite\.zip/);
  assert.match(source, /\$liteBytes -ge 40MB/);
  assert.match(source, /launcher\/bootstrap\.json/);
  assert.match(source, /-Bootstrap/);
  assert.match(source, /\$zipHash  DSH-Portable-1\.0\.0-alpha\.\$\{\{ env\.ALPHA \}\}-windows-x64\.zip/);
  assert.match(source, /\$liteZipHash  DSH-Portable-1\.0\.0-alpha\.\$\{\{ env\.ALPHA \}\}-windows-x64-lite\.zip/);
  assert.equal(workflow.jobs.package['timeout-minutes'], 90);
  const packageStep = workflow.jobs.package.steps.find(step => step.name === 'Package the pure portable layout against the production channel');
  for (const path of ['DeepSeek Harness Portable.exe', 'launcher/apply-update.ps1', 'launcher/Payload.psm1', 'launcher/follow.json', 'launcher/bootstrap.json', 'launcher/7z.exe']) {
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

test('the 1.0 alpha preinstalls no plugins: no plugin sources, no seed packaging, and a plugin-free smoke', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const source = await readFile(file, 'utf8');
  const workflow = yaml.load(source);
  // The two plugins (Chat Manager, Image Viewer) are offered through the README instead of being bundled; bundling made
  // every start run a PowerShell seeding pass before the official app could open.
  assert.doesNotMatch(source, /IMAGE_VIEWER|CHAT_MANAGER|SeedPlugin|pnpm|dsh-image-viewer|dsh-chat-manager/);
  assert.equal(workflow.env.IMAGE_VIEWER_COMMIT, undefined);
  const pluginCheckouts = workflow.jobs.package.steps.filter(step => step.uses === 'actions/checkout@v7' && step.with?.repository);
  assert.deepEqual(pluginCheckouts, []);
  const smokes = workflow.jobs.package.steps.filter(step => /smoke-alpha-seeded\.ps1/.test(step.run ?? ''));
  assert.equal(smokes.length, 2);
  for (const step of smokes) assert.match(step.run, /-NoSeed/);
});

test('the alpha failure evidence upload excludes the official payload', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const workflow = yaml.load(await readFile(file, 'utf8'));
  const steps = workflow.jobs.package.steps;
  const evidence = steps.find(step => step.with?.name === 'official-pure-alpha-${{ env.ALPHA }}-seed-smoke-evidence');
  assert.ok(evidence);
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with.path, 'build/orch-080/T32/evidence/');
  assert.doesNotMatch(evidence.with.path, /\.zip|(?:^|\/)package(?:\/|$)|(?:^|\/)app(?:\/|$)/i);
  const releaseAssets = steps.find(step => step.with?.name === 'official-pure-alpha-${{ env.ALPHA }}-draft-assets');
  assert.ok(releaseAssets);
  assert.equal(releaseAssets.if, 'success()');
  assert.match(releaseAssets.with.path, /DSH-Portable-1\.0\.0-alpha\.\$\{\{ env\.ALPHA \}\}-windows-x64\.zip/);
  assert.match(releaseAssets.with.path, /DSH-Portable-1\.0\.0-alpha\.\$\{\{ env\.ALPHA \}\}-windows-x64-lite\.zip/);
  assert.match(releaseAssets.with.path, /smoke-root-moved\/smoke-report\.json/);
});

test('the alpha workflow checks out this repository first', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const workflow = yaml.load(await readFile(file, 'utf8'));
  const first = workflow.jobs.package.steps[0];
  assert.match(first.uses, /^actions\/checkout@/);
  assert.equal(first.with, undefined);
});

test('a static preflight gates the package job, and a draft is only created after every smoke ran', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const workflow = yaml.load(await readFile(file, 'utf8'));
  assert.equal(workflow.jobs.package.needs, 'preflight');
  assert.equal(workflow.jobs['draft-release'].if, "inputs.publish_draft == true && inputs.smoke == 'all'");
  const steps = workflow.jobs.package.steps;
  const full = steps.find(step => /Smoke first and second startup/.test(step.name ?? ''));
  const lite = steps.find(step => /Smoke lite bootstrap/.test(step.name ?? ''));
  assert.equal(full.if, "inputs.smoke == 'all' || inputs.smoke == 'full'");
  assert.equal(lite.if, "inputs.smoke == 'all' || inputs.smoke == 'lite'");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.smoke.options, ['all', 'full', 'lite', 'none']);
  const preflightSource = JSON.stringify(workflow.jobs.preflight.steps);
  assert.match(preflightSource, /Parser\]::ParseFile/);
  assert.match(preflightSource, /node --test/);
  const dependency = workflow.jobs.preflight.steps.find(step => step.name === 'Provide js-yaml for the static workflow tests').run;
  assert.match(dependency, /app\/package-lock\.json[\s\S]*node_modules\/js-yaml/);
  assert.match(dependency, /ConvertFrom-Json -AsHashtable/, 'npm locks contain an empty root-package key; read them as a PowerShell 7 hashtable');
  assert.match(dependency, /npm pack "js-yaml@\$\(\$dependency\.version\)" --registry https:\/\/registry\.npmjs\.org --ignore-scripts/);
  assert.match(dependency, /Invalid locked js-yaml identity/);
  assert.ok(dependency.indexOf('Get-FileHash') < dependency.indexOf('tar -xzf'), 'authenticate the locked archive before extraction');
  assert.match(dependency, /Get-FileHash[^\n]*-Algorithm SHA512[^\n]*-cne \$expected/);
  assert.doesNotMatch(dependency, /npm ci|js-yaml@\d/);
});

test('manual alpha qualification creates no draft unless publication is explicitly enabled after both smokes', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url), 'utf8'));
  const input = workflow.on.workflow_dispatch.inputs.publish_draft;
  assert.equal(input.type, 'boolean');
  assert.equal(input.default, false);
  const mayPublish = new Function('inputs', `return ${workflow.jobs['draft-release'].if}`);
  for (const publish_draft of [undefined, false]) {
    for (const smoke of workflow.on.workflow_dispatch.inputs.smoke.options) {
      assert.equal(mayPublish({ publish_draft, smoke }), false);
    }
  }
  assert.equal(mayPublish({ publish_draft: true, smoke: 'all' }), true);
  for (const smoke of ['full', 'lite', 'none']) assert.equal(mayPublish({ publish_draft: true, smoke }), false);
  assert.equal(workflow.jobs.package.permissions.contents, 'read');
  assert.ok(workflow.jobs.package.steps.some(step => step.uses?.startsWith('actions/upload-artifact@') && step.with?.name?.includes('draft-assets')));
});

test('the alpha number comes from one workflow-level variable', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.env.ALPHA, "${{ inputs.alpha || '5' }}");
  assert.equal(workflow.on.workflow_dispatch.inputs.alpha.default, '5');
});

test('security collection preserves runtime artifacts and every external writer first requires bound reports', async () => {
  const alpha = yaml.load(await readFile(new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url), 'utf8'));
  const channel = yaml.load(await readFile(new URL('../.github/workflows/official-desktop-channel.yml', import.meta.url), 'utf8'));
  const collectorName = 'Collect actual accepted ASAR security evidence without blocking runtime artifacts';
  const gateName = 'Require bound actual-ASAR security authorization before any external write';
  for (const [job, roots] of [[alpha.jobs.package, ['smoke-root-moved', 'smoke-lite-root-moved']], [channel.jobs.gates, ['T27/work/portable']]]) {
    const step = job.steps.find(step => step.name === collectorName);
    assert.equal(step.if, 'always()');
    for (const root of roots) assert.ok(step.env.SECURITY_ROOTS.includes(root));
    assert.match(step.run, /node scripts\/official-payload-security-evidence\.mjs collect/);
    assert.match(step.run, /exit 0/);
    assert.doesNotMatch(step.run, /Expand-Archive|extract|7z\.exe|import /);
    assert.ok(job.steps.some(step => step.if === 'always()' && step.with?.path?.includes('/security/')));
  }
  for (const job of [alpha.jobs['draft-release'], channel.jobs.publish, channel.jobs['report-failure']]) {
    const gateIndex = job.steps.findIndex(step => step.name === gateName);
    const writeIndex = job.steps.findIndex(step => /gh release create|gh api -X PATCH|gh issue comment|gh issue create/.test(step.run ?? ''));
    assert.ok(gateIndex >= 0 && gateIndex < writeIndex, 'security authorization must precede the first external write');
    assert.match(job.steps[gateIndex].run, /node scripts\/official-payload-security-evidence\.mjs authorize/);
    assert.doesNotMatch(job.steps[gateIndex].run, /import /);
    assert.ok(job.steps.slice(0, gateIndex).some(step => step.uses?.startsWith('actions/download-artifact@') && /security|gates/.test(step.with.name)));
  }
});
