import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('pure portable operations guide stays within its 100-line limit', async () => {
  const guide = await readFile(new URL('../docs/pure-portable-operations.md', import.meta.url), 'utf8');
  assert.ok(guide.trimEnd().split(/\r?\n/).length <= 100);
});
