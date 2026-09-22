import test from 'node:test'
import assert from 'node:assert/strict'
import { restartApp } from '../app/vendor/dsh-portable-plugin-market/src/client/restart-app.ts'

function browser(t, restart, responses) {
  const events = []
  for (const [key, value] of Object.entries({ window: { __DSH_PORTABLE_HOST__: restart ? { restart } : undefined }, sessionStorage: { removeItem: key => events.push(key) }, location: { reload: () => events.push('reload') } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key])
  }
  t.mock.method(globalThis, 'setTimeout', fn => { fn(); return 0 })
  t.mock.method(globalThis, 'fetch', async url => {
    events.push(url)
    const response = responses.shift()
    assert.ok(response, 'unexpected additional request')
    if (response instanceof Error) throw response
    return { ok: response.status < 400, status: response.status, json: async () => response.body }
  })
  return events
}

test('native restart waits for a different boot before reloading', async t => {
  const events = browser(t, async () => ({ ok: true }), [
    { status: 200, body: { boot: 'old' } },
    { status: 200, body: { boot: 'old' } },
    { status: 200, body: { boot: 'new' } },
  ])
  await restartApp()
  assert.equal(events.filter(x => x === '/dsh-market/status').length, 3)
  assert.equal(events.at(-1), 'reload')
})

test('native rejection does not fall back to a second restart or reload', async t => {
  const events = browser(t, async () => { throw new Error('tasks still running') }, [])
  await assert.rejects(restartApp('old'), /tasks still running/)
  assert.equal(events.includes('reload'), false)
  assert.equal(events.includes('/dsh-market/restart'), false)
})

test('lost native acknowledgement is accepted only after a new boot', async t => {
  const events = browser(t, async () => { throw Object.assign(new Error('transport closed'), { code: 'DSH_PORTABLE_RESTART_UNCONFIRMED' }) }, [
    { status: 200, body: { boot: 'new' } },
  ])
  await restartApp('old')
  assert.equal(events.at(-1), 'reload')
})

test('web restart retries operation contention and verifies the resulting boot', async t => {
  const events = browser(t, undefined, [
    { status: 409, body: {} }, { status: 202, body: { ok: true } },
    { status: 200, body: { boot: 'new' } },
  ])
  await restartApp('old')
  assert.equal(events.filter(x => x === '/dsh-market/restart').length, 2)
  assert.equal(events.at(-1), 'reload')
})
