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

test('manual channel qualification does not publish or write issues, while scheduled delivery keeps its gates', async () => {
  const channel = await readWorkflow('official-desktop-channel.yml');
  assert.equal(channel.on.workflow_dispatch.inputs.publish_channel.type, 'boolean');
  assert.equal(channel.on.workflow_dispatch.inputs.publish_channel.default, false);
  const permits = (job, event_name, publish_channel, result, no_op = 'false') => {
    const predicate = new Function('github', 'inputs', 'needs', 'always', `return ${channel.jobs[job].if}`);
    return predicate({ event_name }, { publish_channel }, { resolve: { outputs: { no_op } }, gates: { result } }, () => true);
  };
  for (const publish_channel of [undefined, false]) {
    assert.equal(permits('publish', 'workflow_dispatch', publish_channel, 'success'), false);
    assert.equal(permits('report-failure', 'workflow_dispatch', publish_channel, 'failure'), false);
  }
  for (const [event, enabled] of [['workflow_dispatch', true], ['schedule', undefined]]) {
    assert.equal(permits('publish', event, enabled, 'success'), true);
    assert.equal(permits('publish', event, enabled, 'failure'), false);
    assert.equal(permits('publish', event, enabled, 'success', 'true'), false);
    assert.equal(permits('report-failure', event, enabled, 'failure'), true);
    assert.equal(permits('report-failure', event, enabled, 'success'), false);
    assert.equal(permits('report-failure', event, enabled, 'failure', 'true'), false);
  }
  // Qualification and its evidence do not depend on publication authorization.
  assert.equal(channel.jobs.gates.if, "needs.resolve.outputs.no_op == 'false'");
  const resolve = channel.jobs.resolve.steps.find(step => step.id === 'identity');
  assert.match(resolve.run, /const noOp = Boolean\(same\) && !requested/);
  assert.ok(channel.jobs.gates.steps.some(step => step.uses?.startsWith('actions/upload-artifact@')));
});

test('channel publishing uploads only the candidate and keeps immutable conflicts closed', async () => {
  const channel = await readWorkflow('official-desktop-channel.yml');
  const publication = channel.jobs.publish.steps.find(step => step.name === 'Publish qualified assets and verify exact readback').run;
  assert.match(publication, /\$exeFiles\.Count -ne 1/);
  assert.match(publication, /\$expectedLauncher = 'deepseek-harness-\$\{\{ needs\.resolve\.outputs\.version \}\}-win-x64\.exe'/);
  assert.match(publication, /throw "Immutable launcher asset differs: \$name"/);
  assert.match(publication, /\$exeArgs = @\('scripts\/upload-release-assets\.mjs', \$tag\) \+ \$exeFiles/);
  assert.doesNotMatch(publication, /--clobber|DELETE/);
  assert.doesNotMatch(publication, /\$exeArgs[^\r\n]*--mutable/);
});
