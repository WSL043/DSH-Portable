import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const marker = 'dsh-portable-account-login-v1'

// The official account plugin only registers its sign-in surfaces when the Electron preload API
// (`dshDesktop`) exists. Portable renders the same web client in WebView2, so the guard hid the account menu
// and the sign-in step. The server side (browser PKCE, loopback callback, credential store) already works for
// any host, and the Electron-only onboarding block below the guard keeps its own `dshDesktop` check.
export function patchAccountLogin(source) {
  if (source.includes(marker)) return source
  const guard = /(function apply\(ctx\) \{\r?\n)(\s*)if \(!\("dshDesktop" in globalThis\)\) return;/g
  const matches = source.match(guard)?.length ?? 0
  if (matches !== 1) throw new Error(`account login guard seam changed upstream: expected 1 match, found ${matches}`)
  return source.replace(guard, `$1$2/* ${marker}: Portable's WebView2 host has no dshDesktop, the Platform login does not need it. */`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: patch-account-login.mjs <app-root>')
  const filename = path.join(path.resolve(process.argv[2]), 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-account', 'lib', 'client.js')
  await writeFile(filename, patchAccountLogin(await readFile(filename, 'utf8')), 'utf8')
}
