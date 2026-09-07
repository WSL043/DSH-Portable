import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { patchClientModuleStartup } from '../scripts/patch-client-module-startup.mjs'

const original = `function newlineCount(value) {
\tlet count = 0;
\tfor (const char of value) if (char === "\\n") count += 1;
\treturn count;
}`

test('startup newline scan preserves source-map line counts for Unicode and line endings', () => {
  const count = vm.runInNewContext(`${patchClientModuleStartup(original)}; newlineCount`)
  for (const value of ['', 'abc', '\n', '\r\n', '\n\nlast\n', '😀\n中文\r\n\u2028\u2029', '😀\n'.repeat(100000)]) {
    assert.equal(count(value), value.split('\n').length - 1)
  }
})

test('startup patch is idempotent and rejects changed or ambiguous upstream code', () => {
  const patched = patchClientModuleStartup(original)
  assert.equal(patchClientModuleStartup(patched), patched)
  assert.throws(() => patchClientModuleStartup('function newlineCount() {}'), /seam changed/)
  assert.throws(() => patchClientModuleStartup(original + original), /found 2/)
})
