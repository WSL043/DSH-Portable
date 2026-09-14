import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

test('local environment is published before a stalled update check without duplicate requests', async () => {
  const source = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')
  const begin = source.indexOf('    let portableShellSummary = null')
  const end = source.indexOf('    function usePortableShellSummary', begin)
  assert.ok(begin >= 0 && end > begin)
  let finish, requests = 0
  const update = new Promise(resolve => { finish = resolve })
  const seen = []
  const context = { fetch: async url => { requests++; return url.endsWith('/settings')
    ? { ok: true, json: async () => ({ environments: { current: 'work' }, settings: { productUpdateCheckEnabled: true } }) }
    : update } }
  vm.runInNewContext(source.slice(begin, end) + '\nthis.load=loadPortableShellSummary;this.listen=f=>portableShellSummaryListeners.add(f);', context)
  context.listen(value => seen.push(value))
  const pending = context.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(seen[0].environments.current, 'work')
  assert.equal(seen[0].availableScopes.length, 0)
  assert.equal(context.load(), pending)
  assert.equal(requests, 2)
  finish({ json: async () => ({ status: 'available' }) })
  await pending
  assert.equal(seen.at(-1).availableScopes[0], 'product')
  assert.equal(requests, 2)
})
