import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
test('every product builder applies the account login patch', async () => {
  for (const file of ['build-windows.ps1', 'build-macos.sh', 'build-linux.sh']) {
    assert.match(await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'), /patch-account-login\.mjs/)
  }
})

test('smoke helpers recognise and close the account sign-in step shown on first use', async () => {
  const { dismissOfficialOnboardingExpression: expression } = await import('../scripts/lib/official-onboarding.mjs')
  assert.match(expression, /登录 DeepSeek 账号，或添加 API Key/)
  assert.match(expression, /add an API Key to get started/)
  assert.match(expression, /\["Close","关闭"\]/)
})

const dialog = `(0, react.useEffect)(() => {\n\t\t\t\tsetCopyResult(null);\n\t\t\t}, [attempt?.id, attempt?.authorizeUrl]);`

test('the sign-in page opens once per attempt in the system browser, and a changed dialog is rejected', async () => {
  const { patchLoginBrowserOpen } = await import('../scripts/patch-account-login.mjs')
  const patched = patchLoginBrowserOpen(dialog)
  assert.match(patched, /attempt\.phase === "waiting-browser"/)
  assert.match(patched, /__dshPortableLoginOpened !== attempt\.id/)
  assert.match(patched, /window\.open\(authorizeUrlWithTheme\(attempt\.authorizeUrl, colorScheme\), "_blank"\)/)
  assert.equal(patchLoginBrowserOpen(patched), patched)
  assert.throws(() => patchLoginBrowserOpen(''), /seam changed/)
})
