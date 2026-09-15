import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { patchNativeSettingsCommand, patchPortableUpdatesIcon, patchPluginSettingsNavigation } from '../scripts/patch-native-settings-command.mjs'

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
    Event,
  }
  vm.runInNewContext(`${output}\nthis.SettingsRoot = SettingsRoot`, context)
  context.SettingsRoot({})
  assert.equal(effects.length, 3)
  const cleanup = effects[1]()
  assert.equal(listeners.size, 1)
  window.dispatchEvent({ type: 'dsh-portable/open-settings', detail: { probe: true } })
  assert.deepEqual(setCalls, [])
  assert.equal(typeof window.__DSH_PORTABLE_SETTINGS__.open, 'function')
  window.dispatchEvent({ type: 'dsh-portable/open-settings' })
  assert.deepEqual(setCalls, [{ index: 0, value: true }])
  cleanup()
  assert.equal(window.__DSH_PORTABLE_SETTINGS__, undefined)
  assert.equal(listeners.size, 0)
  window.dispatchEvent({ type: 'dsh-portable/open-settings' })
  assert.deepEqual(setCalls, [{ index: 0, value: true }])
})

test('settings survives a reload but explicit close clears restoration', () => {
  const data = new Map([['dsh-portable-settings-view', JSON.stringify({open:true,section:'plugins'})]])
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }
  const effects = [], calls = [], callbacks = []
  let index = 0
  const context = { Event, Date, sessionStorage: storage, localStorage: { getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    react: { useState: value => { const i=index++; return [value, v=>calls.push([i,v])] },
      useRef: current=>({current}), useEffect: f=>effects.push(f), useCallback: f=>{callbacks.push(f);return f} } }
  vm.runInNewContext(patchNativeSettingsCommand(upstream)+'\nSettingsRoot({});', context)
  const cleanup = effects[1]()
  assert.deepEqual(calls, [[1,'plugins'],[0,true]])
  calls.length=0
  context.window.__DSH_PORTABLE_SETTINGS__.open('archived-sessions')
  assert.deepEqual(calls, [[1,'archived-sessions'],[0,true]])
  cleanup()
  assert.equal(data.has('dsh-portable-settings-view'), true)
  callbacks[0]()
  assert.equal(data.has('dsh-portable-settings-view'), false)
})

test('plugin subtab restoration is bounded to the native tab state', () => {
  const source='const [activeId, setActiveId] = (0, react.useState)();'
  const patched=patchPluginSettingsNavigation(source)
  assert.match(patched, /sessionStorage.getItem\("dsh-portable-plugin-tab"\)/)
  assert.equal(patchPluginSettingsNavigation(patched),patched)
  assert.throws(()=>patchPluginSettingsNavigation('changed'), /seam changed upstream/)
})

test('the native settings command patch is idempotent and rejects a changed or duplicated seam', () => {
  const output = patchNativeSettingsCommand(upstream)
  assert.match(output, /dsh-portable-native-settings-command-v3/)
  assert.match(output, /window\.addEventListener\("dsh-portable\/open-settings", openSettings\)/)
  assert.match(output, /window\.removeEventListener\("dsh-portable\/open-settings", openSettings\)/)
  assert.match(output, /setActiveId\(event.detail.section\)/)
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


test('Updates uses the shared download icon and preserves other navigation icons', () => {
  const source = 'function navIcon(id) { return "existing-icon"; }'
  const output = patchPortableUpdatesIcon(source)
  const context = { react_jsx_runtime: { jsx: (icon, props) => ({ icon, props }) },
    _deepseek_ai_dsh_client_ui_primitives: { IconDownloadOutline16: 'download' },
    SettingsRoot_module_css_default: { navIcon: 'nav-icon' } }
  vm.runInNewContext(`${output}; this.icon = navIcon`, context)
  assert.equal(context.icon('portable-updates').icon, 'download')
  assert.equal(context.icon('portable-updates').props.size, 16)
  assert.equal(context.icon('general'), 'existing-icon')
  assert.equal(patchPortableUpdatesIcon(output), output)
  assert.throws(() => patchPortableUpdatesIcon('changed upstream'), /expected 1 match/)
})

test('Desktop and data adds its own monitor icon without changing existing tabs', () => {
  const previous = 'function navIcon(id) { /* dsh-portable-updates-nav-icon-v1 */ if (id === "portable-updates") return "download"; return "existing"; }'
  const output = patchPortableUpdatesIcon(previous)
  const context = { react_jsx_runtime: { jsx: (icon, props) => ({ icon, props }) }, SettingsRoot_module_css_default: { navIcon: 'nav-icon' } }
  vm.runInNewContext(`${output}; this.icon = navIcon`, context)
  assert.equal(context.icon('portable').icon, 'svg')
  assert.equal(context.icon('portable').props.width, 16)
  assert.equal(context.icon('general'), 'existing')
  assert.equal(context.icon('portable-updates'), 'download')
  assert.equal(patchPortableUpdatesIcon(output), output)
})
