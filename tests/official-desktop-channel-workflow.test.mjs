import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CHANNEL_BASE_URL, CHANNEL_INDEX_URL } from '../experiments/official-payload/channel/constants.mjs';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const yaml = requireApp('js-yaml');
const readWorkflow = async name => yaml.load(await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8'));

test('hourly channel YAML is valid, read-only until gated publishing, and least-privileged', async () => {
  const channel = await readWorkflow('official-desktop-channel.yml');
  const contract = await readWorkflow('official-contract-probe.yml');
  const e2e = await readWorkflow('official-pure-e2e.yml');
  assert.equal(channel.permissions.contents, 'read');
  assert.deepEqual(channel.jobs.resolve.permissions, { contents: 'read' });
  assert.deepEqual(channel.jobs.gates.permissions, { contents: 'read' });
  assert.deepEqual(channel.jobs.publish.permissions, { contents: 'write' });
  assert.deepEqual(channel.jobs['report-failure'].permissions, { contents: 'read', issues: 'write' });
  assert.ok(channel.jobs['report-failure'].steps.some(step => step.uses?.startsWith('actions/checkout@')));
  assert.equal(channel.jobs.gates.needs, 'resolve');
  assert.ok(channel.jobs.publish.needs.includes('gates'));
  assert.match(channel.on.schedule[0].cron, /^\d+ \* \* \* \*$/);
  assert.equal(contract.on.schedule, undefined);
  assert.deepEqual(channel.on.push.branches, ['main']);
  assert.ok(channel.on.push.paths.includes('.github/workflows/official-desktop-channel.yml'));
  assert.equal(CHANNEL_INDEX_URL, `${CHANNEL_BASE_URL}index.json`);
  assert.match(channel.jobs.resolve.steps.find(step => step.name?.includes('candidate and current channel index')).run, /CHANNEL_INDEX_URL/);
  assert.match(channel.jobs.resolve.steps.find(step => step.name?.includes('candidate and current channel index')).run, /redirect:\s*'follow'/);
  for (const [name, workflow] of [['contract', contract], ['e2e', e2e]]) {
    assert.equal(workflow.permissions.contents, 'read', `${name} workflow must remain read-only`);
    assert.ok(Object.values(workflow.jobs).every(job => !Object.values(job.permissions ?? {}).includes('write')));
  }
  for (const file of ['official-contract-probe.yml', 'official-pure-e2e.yml', 'official-desktop-channel.yml']) {
    const source = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.match(source, /\.\/\.github\/actions\/official-payload-stage/);
  }
  const action = await readFile(new URL('../.github/actions/official-payload-stage/action.yml', import.meta.url), 'utf8');
  assert.match(action, /Get-OfficialInstaller/);
  assert.match(action, /7-Zip\\7z\.exe/);
});

test('a new scheduled candidate can publish only after fresh gates, with manual publishing still opt-in', async () => {
  const channel = await readWorkflow('official-desktop-channel.yml');
  assert.equal(channel.on.workflow_dispatch.inputs.publish_channel.default, false);
  const resolve = channel.jobs.resolve.steps.find(step => step.id === 'identity');
  const request = new Function('github', 'inputs', 'return ' + resolve.env.PUBLISH_CHANNEL.slice(3, -2));
  const publish = new Function('needs', 'return ' + channel.jobs.publish.if);
  for (const [event, flag, allowed] of [['schedule', undefined, true], ['push', true, false], ['workflow_dispatch', false, false], ['workflow_dispatch', true, true]]) {
    assert.equal(request({ event_name: event }, { publish_channel: flag }), allowed);
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const needed of [false, true]) {
        assert.equal(publish({ resolve: { outputs: { publish: String(allowed && needed) } }, gates: { result } }), allowed && needed && result === 'success');
      }
    }
  }
  const reportFailure = new Function('github', 'inputs', 'needs', 'always', 'return ' + channel.jobs['report-failure'].if);
  const failed = { resolve: { outputs: { no_op: 'false' } }, gates: { result: 'failure' } };
  assert.equal(reportFailure({ event_name: 'schedule' }, { publish_channel: true }, failed, () => true), false);
  assert.equal(reportFailure({ event_name: 'workflow_dispatch' }, { publish_channel: true }, failed, () => true), true);
  assert.equal(channel.jobs.gates.if, "needs.resolve.outputs.no_op == 'false'");
  assert.match(resolve.run, /const publish = publicationRequested && needsPublication/);
  assert.match(resolve.run, /const noOp = publicationRequested && !needsPublication && !requested/);
  const cache = channel.jobs.gates.steps.find(step => step.id === 'qualification-cache');
  assert.equal(cache.if, "github.event_name == 'push'");
  assert.match(cache.with.key, /needs\.resolve\.outputs\.identity.*hashFiles\(/);
  assert.ok(channel.jobs.gates.steps.some(step => step.name?.startsWith('Run the phase-2')));
  assert.ok(channel.jobs.gates.steps.some(step => step.uses?.startsWith('actions/upload-artifact@')));
});

test('channel publishing uploads only the candidate and keeps immutable conflicts closed', async () => {
  const channel = await readWorkflow('official-desktop-channel.yml');
  const publication = channel.jobs.publish.steps.find(step => step.name === 'Build and publish qualified assets, then verify public downloads').run;
  assert.match(publication, /\$exeFiles\.Count -ne 1/);
  assert.match(publication, /--verify-only/);
  assert.match(publication, /--channel \$env:UPDATE_CHANNEL/);
  assert.match(publication, /foreach \(\$name in @\(\$assetName, 'index\.json', \$feedName\)\)/);
  assert.match(publication, /\$exeArgs = @\('scripts\/upload-release-assets\.mjs', \$tag\) \+ \$exeFiles/);
  assert.doesNotMatch(publication, /--clobber|DELETE/);
  assert.doesNotMatch(publication, /\$exeArgs[^\r\n]*--mutable/);
});
