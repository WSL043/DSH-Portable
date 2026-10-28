import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { openLocalNativeAcceptance } from '../scripts/lib/local-native-acceptance.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-local-ui-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const identity = { root, pid: 42, startedAt: '2026-10-29T00:00:00Z', hostSha256: 'a'.repeat(64), artifactSha256: 'c'.repeat(64),
    desktop: 'DSH-owned-test', inputDesktop: 'Default', origin: 'http://127.0.0.1:3456', user: 'fixture-user' }
  const proof = { ...identity, workerDesktop: identity.desktop, hostDesktop: identity.desktop, creationFlags: 0x08000400 }
  const timeouts = []
  const page = { url: () => identity.origin, setDefaultTimeout: value => timeouts.push(value),
    setDefaultNavigationTimeout: value => timeouts.push(value), evaluate: async () => [] }
  return { page, identity, proof, timeouts, open: () => openLocalNativeAcceptance({ page, identity, verifyOwner: async () => ({ ...proof }) }) }
}

test('local UI attachment requires the live owned process, private desktop and short explicit timeouts', async t => {
  const f = await fixture(t)
  for (const [key, wrong] of [['pid', 99], ['startedAt', 'reused-pid'], ['hostSha256', 'b'.repeat(64)],
    ['artifactSha256', 'd'.repeat(64)], ['workerDesktop', 'Default'], ['hostDesktop', 'Default'], ['inputDesktop', 'Winlogon'], ['creationFlags', 0]]) {
    const old = f.proof[key]; f.proof[key] = wrong
    await assert.rejects(f.open)
    f.proof[key] = old
  }
  await assert.rejects(() => openLocalNativeAcceptance({ page: f.page, identity: f.identity }))
  await assert.rejects(() => openLocalNativeAcceptance({ page: f.page, identity: f.identity, verifyOwner: async () => f.proof, timeoutMs: 30_000 }))
  f.page.url = () => 'http://127.0.0.1:9999/'
  await assert.rejects(f.open, /owned fixture/)
  f.page.url = () => f.identity.origin
  await f.open()
  assert.deepEqual(f.timeouts, [3000, 3000])
})

test('checkpoint recovery reuses the fixture but never silently repeats a passed, failed or interrupted action', async t => {
  const f = await fixture(t), first = await f.open()
  let calls = 0
  await first.step('one', async () => {
    assert.equal(JSON.parse(await readFile(first.checkpointFile, 'utf8')).phases.one.status, 'running')
    const interrupted = await f.open()
    await assert.rejects(() => interrupted.step('one', async () => calls++), /explicit retry/)
    calls++
  })
  const resumed = await f.open()
  await assert.rejects(() => resumed.step('one', async () => calls++), /live read-only recheck/)
  assert.equal((await resumed.step('one', async () => calls++, { recheck: async () => true })).resumed, true)
  assert.equal(calls, 1)
  await assert.rejects(() => resumed.step('two', async () => { throw Error('blocked') }), /blocked/)
  const again = await f.open()
  await assert.rejects(() => again.step('two', async () => calls++), /explicit retry/)
  await again.step('two', async () => calls++, { retry: true })
  assert.equal(calls, 2)
  assert.equal(JSON.parse(await readFile(first.checkpointFile, 'utf8')).phases.two.status, 'passed')
  f.identity.startedAt = f.proof.startedAt = '2026-10-29T01:00:00Z'
  await assert.rejects(f.open, /another fixture or native process/)
})

test('masked settings preserve the actual failure and record an aria-only Close without closing any dialog', async t => {
  const f = await fixture(t), close = { textContent: '', getAttribute: () => 'Close' }
  const modal = { getBoundingClientRect: () => ({ width: 300, height: 200 }), closest: () => null,
    getAttribute: () => 'Get started', querySelectorAll: () => [close] }
  f.page.evaluate = async fn => vm.runInNewContext('(' + fn.toString() + ')()', { document: { querySelectorAll: () => [modal] }, getComputedStyle: () => ({ visibility: 'visible' }) })
  let clicked = 0
  f.page.getByRole = (role, options) => {
    assert.equal(role, 'button'); assert.ok(options.name.test('General'))
    return { click: async args => { assert.equal(args.timeout, 3000); assert.equal(args.force, undefined); clicked++; throw Error('mask intercepts pointer events') } }
  }
  const session = await f.open()
  await assert.rejects(() => session.step('language', () => session.setLanguage('en')), /mask intercepts/)
  const report = JSON.parse(await readFile(session.checkpointFile, 'utf8'))
  assert.deepEqual(report.phases.language.dialogs, [{ label: 'Get started', buttons: ['Close'] }])
  assert.equal(clicked, 1, 'no force retry or automatic modal dismissal')
})

test('optional keyless dismissal supports only the exact English and Chinese dialog/button pairs', async t => {
  for (const [dialogName, buttonName] of [['Get started', 'Close'], ['开始使用', '关闭']]) {
    const f = await fixture(t)
    let present = false, closed = 0
    f.page.getByRole = (role, options) => {
      assert.equal(role, 'dialog')
      assert.equal(options.name.test(dialogName), true)
      assert.equal(options.name.test('Delete session'), false)
      return {
        waitFor: async ({ state, timeout }) => {
          assert.ok(timeout <= 3000)
          if (state === 'visible' && !present) { const error = Error('not present'); error.name = 'TimeoutError'; throw error }
        },
        getAttribute: async (attribute, { timeout }) => {
          assert.equal(attribute, 'aria-label'); assert.ok(timeout <= 3000)
          return dialogName
        },
        getByRole: (buttonRole, buttonOptions) => {
          assert.equal(buttonRole, 'button'); assert.deepEqual(buttonOptions, { name: buttonName, exact: true })
          return { click: async options => { assert.equal(options.force, undefined); closed++; present = false } }
        },
      }
    }
    const session = await f.open()
    assert.deepEqual(await session.dismissKeylessOnboarding(), { dismissed: false })
    assert.equal(closed, 0)
    present = true
    assert.deepEqual(await session.dismissKeylessOnboarding(), { dismissed: true })
    assert.equal(closed, 1)
  }
})

test('language inspection accepts the actual Chinese selector and ignores hidden or menu options', async t => {
  const f = await fixture(t)
  const button = (text, menu = false, hidden = false) => ({ textContent: text, disabled: false,
    getBoundingClientRect: () => ({ width: hidden ? 0 : 100, height: 24 }), closest: () => menu ? {} : null,
    getAttribute: () => null })
  const controls = [button('中文'), button('English', true), button('English', false, true)]
  f.page.evaluate = async (fn, args) => vm.runInNewContext('(' + fn.toString() + ')(args)', {
    args, document: { querySelectorAll: () => controls }, getComputedStyle: () => ({ visibility: 'visible' }),
  })
  const session = await f.open()
  assert.equal(await session.languageIs('zh'), true)
  assert.equal(await session.languageIs('en'), false)
  controls.push(button('English'))
  assert.equal(await session.languageIs('en'), false, 'ambiguous selectors cannot prove the locale')
  await assert.rejects(() => session.languageIs('other'), /supported acceptance locales/)
})
