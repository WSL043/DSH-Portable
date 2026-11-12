import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
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
  for (const source of [dialog, '(0,react.useEffect)(()=>{setCopyResult(null)},[attempt?.id,attempt?.authorizeUrl]);']) {
    const patched = patchLoginBrowserOpen(source)
    assert.equal(patchLoginBrowserOpen(patched), patched)
    const opened = []
    const attempt = { id: 'first', phase: 'initializing', authorizeUrl: 'https://login.example/' }
    const context = createContext({ attempt, react: { useEffect: effect => effect() }, setCopyResult() {},
      authorizeUrlWithTheme: (url, theme) => `${url}?theme=${theme}`, colorScheme: 'dark',
      window: { open: (url, target) => opened.push([url, target]) } })
    runInContext(patched, context)
    assert.deepEqual(opened, [])
    attempt.phase = 'waiting-browser'
    runInContext(patched, context)
    runInContext(patched, context)
    assert.deepEqual(opened, [['https://login.example/?theme=dark', '_blank']])
    attempt.id = 'second'
    runInContext(patched, context)
    assert.equal(opened.length, 2)
  }
  assert.throws(() => patchLoginBrowserOpen(''), /seam changed/)
})
