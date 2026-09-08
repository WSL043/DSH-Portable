import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { patchNativeBootCss, patchNativeBootHandoff } from '../scripts/patch-native-boot-handoff.mjs'

const upstream = `\t\tfunction BootHandoff(props) {
\t\t\tconst [ready, setReady] = (0, react.useState)(false);
\t\t\t(0, react.useLayoutEffect)(() => {
\t\t\t\tsetReady(true);
\t\t\t}, []);
\t\t\tif (ready) return props.app();
\t\t\treturn (0, react.createElement)("div", {
\t\t\t\tclassName: props.boot.className,
\t\t\t\t"data-dsh-boot": "",
\t\t\t\tdangerouslySetInnerHTML: { __html: props.boot.html }
\t\t\t});
\t\t}`

test('the DSH renderer hands a settled app surface to the native desktop host', () => {
  const output = patchNativeBootHandoff(upstream)
  assert.match(output, /dsh-portable-native-boot-handoff-v5/)
  assert.match(output, /globalThis\.chrome\?\.webview/)
  assert.match(output, /readyFrames >= 3/)
  assert.match(output, /visibleControls >= 2/)
  assert.match(output, /rootRect\.width >= Math\.max\(320, innerWidth \* 0\.8\)/)
  assert.doesNotMatch(output, /MutationObserver|lastMutation/)
  assert.match(output, /replace\(\/\\s\+\/g/)
  assert.match(output, /dsh-portable\/surface-ready/)
  assert.match(output, /useLayoutEffect\)\(\(\) => \{[\s\S]+surfaceReady[\s\S]+nativeHost\.postMessage[\s\S]+\}, \[nativeHost, surfaceReady\]\)/)
  assert.match(output, /dsh-portable\/boot-visible/)
  assert.match(output, /nativeHost\.postMessage/)
  assert.match(output, /if \(nativeHost !== void 0\) return ready \? props\.app\(\) : null;/)
  assert.match(output, /if \(ready\) return props\.app\(\);/)
  assert.doesNotMatch(output, /cloneNode|append\(overlay\)|react\.Fragment|surfaceReady \? null : boot/)
  assert.doesNotMatch(output, /style: nativeHost === void 0/)
  assert.match(output, /dangerouslySetInnerHTML: \{ __html: props\.boot\.html \}/)
  assert.match(output, /setReady\(true\);\s+requestAnimationFrame\(finish\);/)
  assert.equal(patchNativeBootHandoff(output), output)
})

test('the official DSH loader carries the product whale without changing its hydrated DOM', () => {
  const source = '._boot{--dsh-boot-bg:#fff}._card{display:flex}'
  const output = patchNativeBootCss(source)
  assert.match(output, /dsh-portable-native-boot-logo-v1/)
  assert.match(output, /\[data-dsh-boot\]>div:before/)
  assert.match(output, /favicon\.svg/)
  assert.equal(patchNativeBootCss(output), output)
})

test('every platform build applies the same native surface handoff', async () => {
  for (const filename of ['build-windows.ps1', 'build-linux.sh', 'build-macos.sh']) {
    const source = await readFile(new URL(`../scripts/${filename}`, import.meta.url), 'utf8')
    assert.match(source, /patch-native-boot-handoff\.mjs/, filename)
  }
})

test('Windows keeps one native loading panel until the real DSH surface is ready', async () => {
  const source = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  assert.match(source, /ShowInTaskbar = !nonInteractive && !testHidden/)
  assert.doesNotMatch(source, /else if \(desktopStart\) Opacity = 0/)
  assert.match(source, /launchPanel\.Visible = true/)
  const bootMessage = source.slice(source.indexOf('dsh-portable/boot-visible'), source.indexOf('dsh-portable/surface-ready'))
  assert.match(bootMessage, /RecordWebViewPhase\("boot-visible-message"\)/)
  assert.doesNotMatch(source, /RevealDesktopBootSurface|NavigateToString/)
  const surfaceReveal = source.slice(source.indexOf('private void RevealDesktopSurface'), source.indexOf('private void InjectTestWebViewCrashAfterReady'))
  assert.match(surfaceReveal, /webView\.Visible\s*=\s*true/)
  assert.match(surfaceReveal, /launchPanel\.Visible\s*=\s*false/)
  assert.match(surfaceReveal, /ShowInTaskbar\s*=\s*true/)
  assert.match(surfaceReveal, /Opacity\s*=\s*1/)
})
