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

test('the DSH renderer explicitly hands a settled surface to the native desktop host', () => {
  const output = patchNativeBootHandoff(upstream)
  assert.match(output, /dsh-portable-native-boot-handoff-v3/)
  assert.match(output, /globalThis\.chrome\?\.webview/)
  assert.match(output, /MutationObserver/)
  assert.match(output, /now - lastMutation >= 300/)
  assert.match(output, /controls >= 2/)
  assert.match(output, /dsh-portable\/surface-ready/)
  assert.match(output, /useLayoutEffect\)\(\(\) => \{[\s\S]+surfaceReady[\s\S]+nativeHost\.postMessage[\s\S]+\}, \[nativeHost, surfaceReady\]\)/)
  assert.match(output, /dsh-portable\/boot-visible/)
  assert.match(output, /nativeHost\.postMessage/)
  assert.doesNotMatch(output, /cloneNode|append\(overlay\)/)
  assert.match(output, /surfaceReady \? null : boot/)
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

test('Windows keeps the native fallback invisible until the real DSH boot surface exists', async () => {
  const source = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  assert.match(source, /ShowInTaskbar = !nonInteractive && !testHidden && !desktopStart/)
  assert.match(source, /else if \(desktopStart\) Opacity = 0/)
  assert.match(source, /launchPanel\.Visible = !desktopStart/)
  const navigation = source.slice(source.indexOf('private async Task NavigateWorkspaceAsync'), source.indexOf('private void RevealDesktopSurface'))
  assert.doesNotMatch(navigation, /launchPanel\.Visible\s*=\s*true/)
  const bootReveal = source.slice(source.indexOf('private void RevealDesktopBootSurface'), source.indexOf('private async Task<string> WaitForWorkspaceHandoffAsync'))
  assert.match(bootReveal, /dsh-boot-surface-visible/)
  assert.match(bootReveal, /ShowInTaskbar\s*=\s*true/)
  assert.match(bootReveal, /Opacity\s*=\s*1/)
})
