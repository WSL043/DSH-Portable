import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { forgetOfficialMarket, readOfficialMarket } from '../app/vendor/dsh-portable-plugin-market/src/client/official-market.ts'

const vendor = path => new URL(`../app/vendor/dsh-portable-plugin-market/${path}`, import.meta.url)

test('the Portable market reports whether the official market bundle is on in the active profile', async () => {
  const routes = await readFile(vendor('src/routes.ts'), 'utf8')
  const at = routes.indexOf("path: '/dsh-market/official-market'")
  assert.ok(at !== -1)
  const route = routes.slice(at, at + 900)
  assert.ok(route.includes("allow: 'GET'"))
  assert.ok(route.includes('readProfileBundles(activeProfileDir).includes(OFFICIAL_MARKET_BUNDLE)'))
  assert.ok(route.includes('active: false'), 'an unreadable profile never hides the Portable market')
  assert.ok(routes.includes("const OFFICIAL_MARKET_BUNDLE = '@deepseek-ai/dsh-experimental-plugin-market-bundle'"))
})

test('the shipped server bundle serves the official-market route', async () => {
  const bundle = await readFile(vendor('lib/index.js'), 'utf8')
  assert.ok(bundle.includes('/dsh-market/official-market'), 'rebuild the market server bundle')
  const client = await readFile(vendor('client/client.js'), 'utf8')
  assert.ok(client.includes('/dsh-market/official-market'), 'rebuild the market client bundle')
})

test('with the official market on, the Portable market stays one click away as Advanced and the update status stays', async () => {
  const action = await readFile(vendor('src/client/MarketAction.tsx'), 'utf8')
  assert.ok(action.includes("official === 'active' ? props.t('navAdvanced') : props.t('nav')"), 'the button is relabelled, not removed')
  assert.ok(action.includes('<PluginUpdateStatus'), 'updates stay available')
  assert.ok(action.includes('<Button'), 'the button is always built')
})

test('the client reads the answer once, falls back to the Portable market on any failure and can re-ask', async () => {
  forgetOfficialMarket()
  const seen = []
  const yes = async url => { seen.push(url); return new Response(JSON.stringify({ active: true })) }
  assert.equal(await readOfficialMarket(yes), 'active')
  assert.deepEqual(seen, ['/dsh-market/official-market'])

  forgetOfficialMarket()
  assert.equal(await readOfficialMarket(async () => new Response('x', { status: 500 })), 'inactive')
  forgetOfficialMarket()
  assert.equal(await readOfficialMarket(async () => { throw new Error('offline') }), 'inactive')
  forgetOfficialMarket()
  assert.equal(await readOfficialMarket(async () => new Response(JSON.stringify({ active: 'yes' }))), 'inactive')
})

test('every chunk the shipped server bundle imports exists, and no stale chunk is left behind', async () => {
  const { readdir } = await import('node:fs/promises')
  const lib = vendor('lib/')
  const files = (await readdir(lib)).filter(name => name.endsWith('.js'))
  const referenced = new Set(['index.js'])
  for (const name of files) {
    const source = await readFile(new URL(name, lib), 'utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["']\.\/([^"']+\.js)["']/gu)) {
      assert.ok(files.includes(match[1]), `${name} imports ./${match[1]}, which is not in the shipped lib directory; copy the whole build output, not only index.js`)
      referenced.add(match[1])
    }
  }
  for (const name of files) {
    if (name === 'import-preflight.js') continue
    assert.ok(referenced.has(name), `${name} is not imported by any shipped chunk (stale build output)`)
  }
})

test('the shipped server bundle carries the update support for index-installed plugins', async () => {
  const { readdir } = await import('node:fs/promises')
  const lib = vendor('lib/')
  let all = ''
  for (const name of (await readdir(lib)).filter(file => file.endsWith('.js'))) all += await readFile(new URL(name, lib), 'utf8')
  assert.ok(all.includes('git+https://github.com/'), 'pinned-commit specs are rebuilt for the next commit')
  assert.ok(all.includes('&path:/'), 'a monorepo sub-directory is kept')
  assert.ok(all.includes('releases'), 'release tarballs are recognised')
  assert.ok(all.includes("kind:`pinned`") || all.includes('kind: "pinned"') || all.includes("kind:'pinned'") || all.includes('pinned'), 'the pinned rollback source exists')
})
