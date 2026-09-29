import assert from 'node:assert/strict'
import test from 'node:test'
import { readLauncherSource } from './helpers/launcher-source.mjs'

test('default UI language follows the user preferred Windows language, not the install language', async () => {
  const source = await readLauncherSource()
  assert.match(source, /private static string uiLanguage = ResolveInitialUiLanguage\(\);/)
  assert.doesNotMatch(source, /uiLanguage = CultureInfo\.InstalledUICulture/, 'the install language must not be the first choice')
  const resolver = source.slice(source.indexOf('private static string ResolveInitialUiLanguage()'))
  const preferred = resolver.indexOf('GetUserPreferredUILanguages(')
  const current = resolver.indexOf('CultureInfo.CurrentUICulture')
  const installed = resolver.indexOf('CultureInfo.InstalledUICulture')
  assert.ok(preferred > 0 && current > preferred && installed > current, 'order: user preferred, process UI culture, install language')
  assert.match(source, /DllImport\("kernel32\.dll"[^\n]*\)\]\s*private static extern bool GetUserPreferredUILanguages/)
})
