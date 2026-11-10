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
  assert.match(source, /smoke-portable-package\.ps1/);
  assert.match(source, /DSH-Portable-\$\{\{ env\.PORTABLE_VERSION \}\}-windows-x64-lite\.zip/);
  assert.match(source, /\$liteBytes -ge 40MB/);
  assert.match(source, /launcher\/bootstrap\.json/);
  assert.match(source, /-Bootstrap/);
  assert.match(source, /\$zipHash  DSH-Portable-\$\{\{ env\.PORTABLE_VERSION \}\}-windows-x64\.zip/);
  assert.match(source, /\$liteZipHash  DSH-Portable-\$\{\{ env\.PORTABLE_VERSION \}\}-windows-x64-lite\.zip/);
  assert.equal(workflow.jobs.package['timeout-minutes'], 90);
  const packageStep = workflow.jobs.package.steps.find(step => step.name === 'Package the pure portable layout against the production channel');
  for (const path of ['DeepSeek Harness Portable.exe', 'launcher/apply-update.ps1', 'launcher/Payload.psm1', 'launcher/follow.json', 'launcher/bootstrap.json', 'launcher/7z.exe']) {
    assert.ok(packageStep.run.includes(path), `lite package allowlist assertion is missing ${path}`);
  }
  assert.match(packageStep.run, /app\/current\.json/);
  assert.match(packageStep.run, /Get-ChildItem -LiteralPath \(Join-Path \$liteRoot 'app'\) -Directory/);
  const draft = workflow.jobs['draft-release'].steps.find(step => step.env?.RELEASE_TAG);
  assert.ok(draft.run.indexOf('sha256sum --strict --check') < draft.run.indexOf('gh release create'));
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
  const smokes = workflow.jobs.package.steps.filter(step => /smoke-portable-package\.ps1/.test(step.run ?? ''));
  assert.equal(smokes.length, 3);
  const packager = await readFile(new URL('../experiments/official-payload/package-pure.ps1', import.meta.url), 'utf8');
  const launcher = await readFile(new URL('../experiments/official-payload/Launcher.cs', import.meta.url), 'utf8');
  assert.doesNotMatch(packager, /SeedPlugin|seed-plugins/);
  assert.doesNotMatch(launcher, /RunSeedPlugins|seed-plugins/);
});

test('the alpha failure evidence upload excludes the official payload', async () => {
  const file = new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url);
  const workflow = yaml.load(await readFile(file, 'utf8'));
  const steps = workflow.jobs.package.steps;
  const evidence = steps.find(step => step.with?.name === 'official-pure-${{ env.PORTABLE_VERSION }}-package-smoke-evidence');
  assert.ok(evidence);
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with.path, 'build/orch-080/T32/evidence/');
  assert.doesNotMatch(evidence.with.path, /\.zip|(?:^|\/)package(?:\/|$)|(?:^|\/)app(?:\/|$)/i);
  const releaseAssets = steps.find(step => step.with?.name === 'official-pure-${{ env.PORTABLE_VERSION }}-draft-assets');
  assert.ok(releaseAssets);
  assert.equal(releaseAssets.if, 'success()');
  assert.match(releaseAssets.with.path, /DSH-Portable-\$\{\{ env\.PORTABLE_VERSION \}\}-windows-x64\.zip/);
  assert.match(releaseAssets.with.path, /DSH-Portable-\$\{\{ env\.PORTABLE_VERSION \}\}-windows-x64-lite\.zip/);
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
  assert.equal(workflow.jobs['draft-release'].if, "inputs.publish_draft == true && inputs.smoke == 'all' && !inputs.stable_candidate");
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
  assert.equal(mayPublish({ publish_draft: true, smoke: 'all', rc_candidate: true }), true);
  assert.equal(mayPublish({ publish_draft: true, smoke: 'all', stable_candidate: true }), false);
  for (const smoke of ['full', 'lite', 'none']) assert.equal(mayPublish({ publish_draft: true, smoke }), false);
  assert.equal(workflow.jobs.package.permissions.contents, 'read');
  assert.ok(workflow.jobs.package.steps.some(step => step.uses?.startsWith('actions/upload-artifact@') && step.with?.name?.includes('draft-assets')));
});

test('the build version reaches both packages and the 1.0.0 candidate requires an explicit official version', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-pure-alpha.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.env.ALPHA, "${{ inputs.alpha || '5' }}");
  assert.equal(workflow.on.workflow_dispatch.inputs.alpha.default, '5');
  assert.equal(workflow.on.workflow_dispatch.inputs.stable_candidate.default, false);
  assert.match(workflow.env.PORTABLE_VERSION, /stable_candidate && '1\.0\.0'/);
  assert.equal(workflow.on.workflow_dispatch.inputs.rc_candidate.default, false);
  assert.match(workflow.env.PORTABLE_VERSION, /rc_candidate && '1\.0\.0-rc\.1'/);
  const build = workflow.jobs.package.steps.find(step => step.name === 'Package the pure portable layout against the production channel');
  assert.equal(build.run.split('-PortableVersion $env:PORTABLE_VERSION').length, 3);
  assert.equal(build.run.split('-ExpectedOfficialVersion $env:EXPECTED_OFFICIAL_VERSION').length, 3);
  assert.match(build.env.EXPECTED_OFFICIAL_VERSION, /stable_candidate \|\| inputs\.rc_candidate\) && steps\.select\.outputs\.version/);
  const mode = workflow.jobs.preflight.steps.find(step => step.name === 'Validate package version and draft mode');
  assert.equal(mode.env.OFFICIAL_VERSION, '${{ inputs.version }}');
  assert.match(mode.run, /\[\[ "\$PUBLISH_DRAFT" != true && "\$SMOKE" == all && -n "\$OFFICIAL_VERSION" \]\]/);
});
