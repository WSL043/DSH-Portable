import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrowserSpec } from '../launcher/browser-fallback.mjs'

test('default browser receives a literal URL without a command interpreter', () => {
  const url = 'http://127.0.0.1:3080/?a=1&b=2'
  const spec = defaultBrowserSpec(url, 'win32', { SystemRoot: 'C:\\Windows' })
  assert.equal(spec.command, 'C:\\Windows\\explorer.exe')
  assert.deepEqual(spec.args, [url])
  assert.equal(defaultBrowserSpec(url, 'linux').command, 'xdg-open')
})
test('workspace browser fallback rejects remote and executable URL schemes', () => {
  for (const url of ['file:///C:/test.exe', 'javascript:alert(1)', 'https://example.com', 'http://localhost.example.com', 'http://user@localhost']) {
    assert.throws(() => defaultBrowserSpec(url))
  }
})
