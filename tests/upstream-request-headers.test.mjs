import assert from 'node:assert/strict'
import test from 'node:test'
import { upstreamRequestHeaders } from '../scripts/upstream-request-headers.mjs'

test('upstream registry requests never carry the GitHub credential', () => {
  for (const url of ['https://registry.npmjs.org/example', 'https://api.github.com.example.org/', 'http://api.github.com/']) {
    assert.equal(upstreamRequestHeaders(url, 'fixture-token').authorization, undefined)
  }
  assert.equal(upstreamRequestHeaders('https://api.github.com/repos/owner/repo', 'fixture-token').authorization, 'Bearer fixture-token')
  assert.equal(upstreamRequestHeaders('https://raw.githubusercontent.com/owner/repo/sha/file', 'fixture-token').authorization, 'Bearer fixture-token')
  assert.equal(upstreamRequestHeaders('https://api.github.com/', '').authorization, undefined)
})
