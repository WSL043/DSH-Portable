import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { EXTRAS_MARKER, patchMarketExtras } from '../scripts/patch-official-market-extras.mjs'
import { buildOfficialExtras } from '../app/vendor/dsh-portable-plugin-market/src/extras.ts'

const CLIENT = new URL('../app/node_modules/@deepseek-ai/dsh-client-ui-plugin-market/lib/client.js', import.meta.url)

test('the official card gets the extras row once, and the result is still valid code', async () => {
  const source = await readFile(CLIENT, 'utf8')
  const patched = patchMarketExtras(source)
  assert.ok(patched.includes(EXTRAS_MARKER))
  assert.equal(patchMarketExtras(patched), patched, 'applying twice changes nothing')
  assert.equal(patched.split('PortableEntryExtras, { entry, language }').length - 1, 1)
  assert.equal(patched.split('PortableEntryShot, { entry, language }').length - 1, 1, 'the preview is its own element beside the install button')
  assert.doesNotThrow(() => new vm.Script(patched))
  assert.ok(patched.includes('data-portable-viewer'), 'a click on the preview opens it full size')
  assert.ok(patched.includes('data-portable-prev') && patched.includes('data-portable-next'), 'several images can be stepped through with visible buttons')
})

test('a changed card layout stops the build instead of shipping a half patch', async () => {
  const source = await readFile(CLIENT, 'utf8')
  assert.throws(() => patchMarketExtras(source.replace('function EntryCard(', 'function RenamedCard(')), /card function changed/)
  assert.throws(() => patchMarketExtras(source.replace('DiscoverSection_module_css_default.cardEnd', 'DiscoverSection_module_css_default.cardTail')), /card layout changed/)
})

test('the extras table is keyed by npm name and by whole repository, with only safe preview images', () => {
  const plugins = [
    { name: 'a', npm: 'pkg-a', url: 'https://github.com/Some/Repo', downloads: 1234.4, stars: 7, screenshots: ['https://raw.githubusercontent.com/o/r/main/a.png', 'https://evil.example/x.png', 'https://github.com/o/r/a.svg', 'http://github.com/o/r/b.png'] },
    { name: 'b', npm: null, url: 'https://github.com/o/mono/tree/main/packages/b', downloads: 5, screenshots: [] },
    { name: 'c', npm: 'pkg-c', url: 'https://github.com/o/c', downloads: null, stars: 0 },
    { name: 'd', npm: 'pkg-d', url: 'https://github.com/o/d.git', stars: 3 },
  ]
  const { byName, byRepo } = buildOfficialExtras({ plugins })
  assert.deepEqual(byName['pkg-a'], { d: 1234, stars: 7, shots: ['https://raw.githubusercontent.com/o/r/main/a.png'] })
  assert.equal(byName['pkg-c'], undefined, 'an entry with nothing to show is left out')
  assert.deepEqual(byRepo['some/repo'], byName['pkg-a'])
  assert.deepEqual(byRepo['o/d'], { stars: 3 })
  assert.equal(Object.keys(byRepo).some(key => key.includes('mono')), false, 'a sub-directory does not claim its whole repository')
})
