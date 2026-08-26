import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Windows finished-product lifecycle enforces the 0.5.0 performance budget', async () => {
  const budget = JSON.parse(await readFile(new URL('../config/performance-budgets.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(budget.platforms), ['windows-x64'])
  for (const metric of ['firstColdStartSeconds', 'movedColdStartSeconds', 'explicitExitSeconds', 'closeToExitSeconds']) {
    assert.ok(Number.isFinite(budget.platforms['windows-x64'][metric]), `missing ${metric}`)
  }

  const host = await readFile(new URL('../scripts/smoke-windows-desktop-host.ps1', import.meta.url), 'utf8')
  assert.match(host, /ExplicitExitSeconds/)
  assert.match(host, /CloseToExitSeconds/)

  const move = await readFile(new URL('../scripts/smoke-windows-desktop-move.ps1', import.meta.url), 'utf8')
  assert.match(move, /performance-budgets\.json/)
  assert.match(move, /firstColdStartSeconds/)
  assert.match(move, /FirstColdStartLimit/)
  assert.match(move, /movedColdStartSeconds/)
  assert.match(move, /explicitExitSeconds/)
  assert.match(move, /closeToExitSeconds/)
})
