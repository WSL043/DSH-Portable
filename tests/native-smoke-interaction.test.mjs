import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { dismissOfficialOnboardingExpression } from '../scripts/lib/official-onboarding.mjs'
import { clickButton, builtInPluginCard, officialPowerShellDetailsReady } from '../scripts/lib/native-smoke-interaction.mjs'

test('late API Key onboarding is dismissed without touching unrelated dialogs', async () => {
  const expression = dismissOfficialOnboardingExpression
  let clicks = 0
  const button = { textContent: 'Configure later', disabled: false, closest: () => null, click: () => clicks++ }
  const modal = { textContent: 'Add an API Key to get started', getBoundingClientRect: () => ({ width: 400 }), querySelectorAll: () => [button] }
  const context = { document: { querySelectorAll: () => [modal] } }
  const first = vm.runInNewContext(expression, context)
  assert.equal(first.clicked, true)
  assert.equal(first.terminal, true)
  assert.equal(clicks, 1)
  modal.textContent = 'Internal Testing Notice'
  button.textContent = 'Continue'
  assert.equal(vm.runInNewContext(expression, context).terminal, false, 'welcome is not the final onboarding step')
  assert.equal(clicks, 2)
  modal.textContent = '预览版说明'
  assert.equal(vm.runInNewContext(expression, context).terminal, false, 'preview notice is not the final onboarding step')
  assert.equal(clicks, 3)
  modal.textContent = 'A brand new official notice'
  assert.equal(vm.runInNewContext(expression, context).terminal, false, 'an unnamed acknowledgement dialog is dismissed')
  assert.equal(clicks, 4)
  button.textContent = 'Delete'
  modal.textContent = 'Confirm deleting your session'
  assert.equal(vm.runInNewContext(expression, context), false)
  const cancel = { textContent: 'Continue', disabled: false, closest: () => null, click: () => clicks++ }
  modal.querySelectorAll = () => [cancel, button]
  assert.equal(vm.runInNewContext(expression, context), false, 'a dialog that offers a choice is never dismissed')
  assert.equal(clicks, 4)
})

test('native acceptance waits for an actionable control after a tab change', async () => {
  const expression = clickButton(['Light'])
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

function officialCardExpressions() {
  return { open: builtInPluginCard('tool-pwsh', true), close: builtInPluginCard('tool-pwsh', false), inspect: builtInPluginCard('tool-pwsh'), ready: officialPowerShellDetailsReady }
}
function inventoryCardFixture() {
  let open = false, clicks = 0
  const box = { width: 300, height: 50 }
  const facts = [['Module', '@deepseek-ai/dsh-tool-pwsh'], ['From', 'Standard'], ['Configuration', 'Enabled']]
  const detail = { getBoundingClientRect: () => box, closest: () => null,
    querySelector: selector => selector === '[data-loader-entry]' ? { textContent: 'tool-pwsh' } : null,
    querySelectorAll: () => facts.map(([label, value]) => ({ querySelector: selector => ({ textContent: selector === 'dt' ? label : value }) })),
  }
  const button = { disabled: false, closest: () => null, getBoundingClientRect: () => box, scrollIntoView() {},
    getAttribute: name => name === 'aria-controls' ? 'plugin-details-fixture' : name === 'aria-expanded' ? String(open) : null,
    click() { clicks++; open = !open },
  }
  const card = { getBoundingClientRect: () => box, closest: () => null,
    getAttribute: name => name === 'data-plugin-entry' ? 'tool-pwsh' : name === 'data-plugin-module' ? '@deepseek-ai/dsh-tool-pwsh' : null,
    querySelector: () => button, contains: element => open && element === detail,
  }
  const cards = [card]
  const context = { document: { querySelectorAll: () => cards, getElementById: id => open && id === 'plugin-details-fixture' ? detail : null }, getComputedStyle: () => ({ visibility: 'visible' }) }
  return { context, card, button, detail, facts, cards, clicks: () => clicks }
}

test('Alpha native smoke clicks the exact official Windows tool card and observes owned facts then removal', async () => {
  const expressions = await officialCardExpressions(), fixture = inventoryCardFixture()
  fixture.cards.unshift({ ...fixture.card, getAttribute: () => 'tool-bash' })
  const expanded = vm.runInNewContext(expressions.open, fixture.context)
  assert.equal(expanded.clicked, true); assert.equal(fixture.clicks(), 1)
  assert.equal(expressions.ready(expanded), true)
  const closed = vm.runInNewContext(expressions.close, fixture.context)
  assert.equal(closed.clicked, true); assert.equal(closed.expanded, false)
  assert.equal(closed.detailsPresent, false); assert.equal(fixture.clicks(), 2)
  assert.equal(expressions.ready(closed), false)
})

test('Alpha native smoke rejects hidden, disabled, inert and duplicate exact cards', async () => {
  const expressions = await officialCardExpressions()
  for (const fault of ['hidden', 'disabled', 'inert', 'duplicate']) {
    const fixture = inventoryCardFixture()
    if (fault === 'hidden') fixture.card.getBoundingClientRect = () => ({ width: 0, height: 0 })
    if (fault === 'disabled') fixture.button.disabled = true
    if (fault === 'inert') fixture.card.closest = () => ({ inert: true })
    if (fault === 'duplicate') fixture.cards.push(fixture.card)
    assert.equal(vm.runInNewContext(expressions.open, fixture.context).ready, false, fault)
    assert.equal(fixture.clicks(), 0, fault)
  }
})

test('Alpha native smoke cannot accept another module, unrelated controlled detail or missing official facts', async () => {
  const expressions = await officialCardExpressions()
  for (const fault of ['module', 'ownership', 'facts', 'hidden-details']) {
    const fixture = inventoryCardFixture()
    if (fault === 'module') fixture.card.getAttribute = name => name === 'data-plugin-entry' ? 'tool-pwsh' : '@other/module'
    if (fault === 'ownership') fixture.card.contains = () => false
    if (fault === 'facts') fixture.facts.pop()
    if (fault === 'hidden-details') fixture.detail.getBoundingClientRect = () => ({ width: 0, height: 0 })
    const snapshot = vm.runInNewContext(expressions.open, fixture.context)
    assert.equal(expressions.ready(snapshot), false, fault)
  }
})
