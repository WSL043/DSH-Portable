import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { patchAccountLogin } from '../scripts/patch-account-login.mjs'

const official = `\t\t/** Register account UI only in the Desktop renderer. @param ctx - client plugin context. */
\t\tfunction apply(ctx) {
\t\t\tif (!("dshDesktop" in globalThis)) return;
\t\t\tctx.effect(() => ctx.locale.register("settings.account", { en, zh }), "account: dictionaries");
\t\t\tif ("dshDesktop" in globalThis) {
\t\t\t\tconst controller = new DesktopOnboardingController();
\t\t\t}
\t\t}`

test('account login patch removes only the Desktop-only registration guard', () => {
  const patched = patchAccountLogin(official)
  assert.doesNotMatch(patched, /if \(!\("dshDesktop" in globalThis\)\) return;/)
  assert.match(patched, /if \("dshDesktop" in globalThis\) \{\s+const controller/)
  assert.equal(patchAccountLogin(patched), patched)
  assert.equal(patchAccountLogin(official.replace(/\n/g, '\r\n')).includes('dsh-portable-account-login-v1'), true)
})

test('account login patch rejects a changed upstream seam', () => {
  assert.throws(() => patchAccountLogin(''), /seam changed/)
  assert.throws(() => patchAccountLogin(official + '\n' + official), /expected 1 match, found 2/)
})

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
