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
  assert.match(source, /smoke-package\.ps1/);
  assert.match(source, /--draft/);
  assert.doesNotMatch(source, /--prerelease|--latest\b/);
});
