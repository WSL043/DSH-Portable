import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { patchNativeSettingsCommand } from '../scripts/patch-native-settings-command.mjs'

const upstream = `\t\tfunction SettingsRoot(props) {
\t\t\tconst { wide, reconnect, useConnectionState, useSections, useOnboardingSteps, useSessions, renderSlot, t } = props;
\t\t\tconst [open, setOpen] = (0, react.useState)(false);
\t\t\tconst [activeId, setActiveId] = (0, react.useState)(void 0);
\t\t\tconst [completedOnboarding, setCompletedOnboarding] = (0, react.useState)(() => /* @__PURE__ */ new Set());
\t\t\tconst [showRecovery, setShowRecovery] = (0, react.useState)(false);
\t\t\tconst triggerButton = (0, react.useRef)(null);
\t\t\tconst wasOpen = (0, react.useRef)(open);
\t\t\tconst close = (0, react.useCallback)(() => {
\t\t\t\tsetOpen(false);
\t\t\t\tsetActiveId(void 0);
\t\t\t}, []);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (wasOpen.current && !open) triggerButton.current?.focus();
\t\t\t\twasOpen.current = open;
\t\t\t}, [open]);
\t\t\treturn null;
\t\t}`

test('the native settings command opens Settings and removes its listener on cleanup', () => {
  const output = patchNativeSettingsCommand(upstream)
  const listeners = new Map()
  const setCalls = []
  const effects = []
  let stateIndex = 0
  const window = {
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event)
    },
  }
  const context = {
    react: {
      useState(initial) {
        const index = stateIndex++
        return [initial, value => setCalls.push({ index, value })]
      },
      useRef: initial => ({ current: initial }),
      useCallback: callback => callback,
      useEffect: effect => effects.push(effect),
    },
    window,
  }
  vm.runInNewContext(`${output}\nthis.SettingsRoot = SettingsRoot`, context)
  context.SettingsRoot({})
  assert.equal(effects.length, 2)
  const cleanup = effects[1]()
  assert.equal(listeners.size, 1)
  window.dispatchEvent({ type: 'dsh-portable/open-settings' })
  assert.deepEqual(setCalls, [{ index: 0, value: true }])
  cleanup()
  assert.equal(listeners.size, 0)
  window.dispatchEvent({ type: 'dsh-portable/open-settings' })
  assert.deepEqual(setCalls, [{ index: 0, value: true }])
})

test('the native settings command patch is idempotent and rejects a changed or duplicated seam', () => {
  const output = patchNativeSettingsCommand(upstream)
  assert.match(output, /dsh-portable-native-settings-command-v1/)
  assert.match(output, /window\.addEventListener\("dsh-portable\/open-settings", openSettings\)/)
  assert.match(output, /window\.removeEventListener\("dsh-portable\/open-settings", openSettings\)/)
  assert.match(output, /openSettings = \(\) => \{\s+setOpen\(true\);\s+\};/)
  assert.equal(patchNativeSettingsCommand(output), output)
  assert.throws(() => patchNativeSettingsCommand(upstream.replace('wasOpen.current = open;', 'wasOpen.current = false;')), /seam changed upstream/)
  assert.throws(() => patchNativeSettingsCommand(`${upstream}\n${upstream}`), /expected 1 match, found 2/)
})

test('every platform build applies the native settings command patch beside boot handoff', async () => {
  for (const filename of ['build-windows.ps1', 'build-linux.sh', 'build-macos.sh']) {
    const source = await readFile(new URL(`../scripts/${filename}`, import.meta.url), 'utf8')
    assert.match(source, /patch-native-boot-handoff\.mjs[\s\S]{0,240}patch-native-settings-command\.mjs/, filename)
  }
})
