import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('late API Key onboarding is dismissed without touching unrelated dialogs', async () => {
  const source = await readFile(new URL('../scripts/smoke-windows-tray-bridge.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('await evaluate(client, `(() => {', source.indexOf('async function waitForValue'))
  const end = source.indexOf('`)\n', start)
  assert.ok(start >= 0 && end > start)
  const expression = source.slice(source.indexOf('`', start) + 1, end)
  let clicks = 0
  const button = { textContent: 'Configure later', disabled: false, closest: () => null, click: () => clicks++ }
  const modal = { textContent: 'Add an API Key to get started', getBoundingClientRect: () => ({ width: 400 }), querySelectorAll: () => [button] }
  const context = { document: { querySelectorAll: () => [modal] } }
  assert.equal(vm.runInNewContext(expression, context), true)
  assert.equal(clicks, 1)
  modal.textContent = 'Confirm deleting your session'
  assert.equal(vm.runInNewContext(expression, context), false)
  assert.equal(clicks, 1)
})

test('native acceptance waits for an actionable control after a tab change', async () => {
  const source = await readFile(new URL('../scripts/smoke-windows-tray-bridge.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('const clickButton =')
  const end = source.indexOf('const clickChoice =', start)
  assert.ok(start >= 0 && end > start)
  const expression = vm.runInNewContext(`${source.slice(start, end)}; clickButton(['Light'])`)
  let clicks = 0
  const button = overrides => ({
    textContent: 'Light',
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    getAttribute: () => null,
    closest: () => null,
    click: () => { clicks++ },
    ...overrides,
  })
  const hidden = button({ getBoundingClientRect: () => ({ width: 0, height: 0 }) })
  const disabled = button({ disabled: true })
  const inert = button({ closest: () => ({ inert: true }) })
  const visible = button({})
  const context = {
    document: { querySelectorAll: () => [hidden, disabled, inert] },
    getComputedStyle: () => ({ visibility: 'visible' }),
  }
  assert.equal(vm.runInNewContext(expression, context).clicked, false)
  assert.equal(clicks, 0)
  context.document.querySelectorAll = () => [hidden, disabled, inert, visible]
  assert.equal(vm.runInNewContext(expression, context).clicked, true)
  assert.equal(clicks, 1)
})
