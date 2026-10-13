import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { configuredMirrors, DEFAULT_UPDATE_MIRRORS, mirrorUrls } from '../launcher/update-mirrors.mjs'
import { UPDATE_SIGNING_PUBLIC_KEYS, verifyUpdateSignature } from '../launcher/update-signature.mjs'
import { fetchJson, withMirrorRoutes } from '../launcher/update-core.mjs'

const fixture = name => readFile(new URL(`./fixtures/update-signature/${name}`, import.meta.url))
const MANIFEST = 'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-stable/dsh-core-index-windows-x64.json'
const response = (body, status = 200) => new Response(body, { status })

test('the built-in public key verifies a signature made by the release key and rejects any change', async () => {
  const bytes = await fixture('sample.json')
  const signature = (await fixture('sample.json.sig')).toString('utf8')
  assert.equal(verifyUpdateSignature(bytes, signature), true)
  assert.equal(verifyUpdateSignature(Buffer.concat([bytes, Buffer.from(' ')]), signature), false)
  assert.equal(verifyUpdateSignature(bytes, ''), false)
  assert.equal(verifyUpdateSignature(bytes, 'not base64 at all'), false)
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const forged = sign('sha256', bytes, { key: other.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
  assert.equal(verifyUpdateSignature(bytes, forged), false)
  assert.equal(verifyUpdateSignature(bytes, forged, [other.publicKey.export({ type: 'spki', format: 'pem' })]), true)
  assert.equal(UPDATE_SIGNING_PUBLIC_KEYS.length >= 1, true)
})

test('only GitHub release assets of Portable repositories get mirror routes, and the list can be replaced or turned off', () => {
  const routes = mirrorUrls(MANIFEST, ['https://mirror.example/'])
  assert.deepEqual(routes, [`https://mirror.example/${MANIFEST}`])
  assert.deepEqual(mirrorUrls(`${MANIFEST}?_portable_check=1`, ['https://mirror.example/']), routes)
  assert.deepEqual(mirrorUrls('https://example.com/a.json'), [])
  assert.deepEqual(mirrorUrls('https://github.com/someone/else/releases/download/v1/a.json'), [])
  assert.deepEqual(mirrorUrls('http://github.com/WSL043/DSH-Portable/releases/download/v1/a.zip'), [])
  assert.deepEqual(configuredMirrors({}), DEFAULT_UPDATE_MIRRORS)
  assert.deepEqual(configuredMirrors({ DSH_PORTABLE_UPDATE_MIRRORS: 'off' }), [])
  assert.deepEqual(configuredMirrors({ DSH_PORTABLE_UPDATE_MIRRORS: 'https://a.example, http://insecure.example, https://b.example/' }), ['https://a.example/', 'https://b.example/'])
})

test('archives try GitHub first and then the mirrors', () => {
  const archive = 'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-stable/core.zip'
  assert.deepEqual(withMirrorRoutes([archive], ['https://m.example/']), [archive, `https://m.example/${archive}`])
  assert.deepEqual(withMirrorRoutes(['https://cdn.example/core.zip'], ['https://m.example/']), ['https://cdn.example/core.zip'])
})

test('metadata falls back to a mirror only when GitHub cannot be reached, and only with a valid signature', async () => {
  const bytes = await fixture('sample.json')
  const signature = await fixture('sample.json.sig')
  const mirror = 'https://m.example/'
  const calls = []
  const serve = ({ githubDown = true, tamper = false, signed = true } = {}) => async input => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://github.com/')) {
      if (githubDown) throw new TypeError('fetch failed')
      return response('{"from":"github"}')
    }
    if (url.endsWith('.sig')) return signed ? response(signature) : response('', 404)
    return response(tamper ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes)
  }
  const options = fetchImpl => ({ allowHttp: false, fetchImpl, timeoutMs: 1000, mirrors: [mirror] })

  assert.deepEqual(await fetchJson(MANIFEST, options(serve())), { fixture: 'update-signature', schemaVersion: 1 })
  assert.equal(calls[0].startsWith('https://github.com/'), true)
  assert.equal(calls.some(url => url.startsWith(mirror)), true)

  await assert.rejects(fetchJson(MANIFEST, options(serve({ tamper: true }))), /fetch failed/)
  await assert.rejects(fetchJson(MANIFEST, options(serve({ signed: false }))), /fetch failed/)

  calls.length = 0
  assert.deepEqual(await fetchJson(MANIFEST, options(serve({ githubDown: false }))), { from: 'github' })
  assert.equal(calls.some(url => url.startsWith(mirror)), false, 'a reachable GitHub is never bypassed')

  calls.length = 0
  const notFound = async input => { calls.push(String(input)); return response('', 404) }
  await assert.rejects(fetchJson(MANIFEST, options(notFound)), /HTTP 404/)
  assert.equal(calls.length, 1, 'a 404 from GitHub is final and does not consult mirrors')
})
