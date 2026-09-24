import test from 'node:test'
import assert from 'node:assert/strict'
import { pluginStateNote } from '../app/vendor/dsh-portable-plugin-market/src/client/plugin-state-note.ts'

test('official plugin rows expose only observed switch/runtime disagreement', () => {
  assert.equal(pluginStateNote(false, 'live'), 'running-outside-switch')
  assert.equal(pluginStateNote(true, 'disabled'), 'stopped-despite-switch')
  assert.equal(pluginStateNote(false, 'pending-disable'), 'pending-stop')
  assert.equal(pluginStateNote(true, 'pending-disable'), 'pending-stop')
  assert.equal(pluginStateNote(true, 'live'), null)
  assert.equal(pluginStateNote(false, 'inert'), null)
  assert.equal(pluginStateNote(undefined, 'live'), null)
  assert.equal(pluginStateNote(true, undefined), null)
})
