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
  // Newer cores register the account UI in plain Web clients themselves and have no guard left to remove.
  if (matches === 0 && /function apply\(ctx\) \{\r?\n\s*const desktop = "dshDesktop" in globalThis;/.test(source)) return source
  if (matches !== 1) throw new Error(`account login guard seam changed upstream: expected 1 match, found ${matches}`)
  return source.replace(guard, `$1$2/* ${marker}: Portable's WebView2 host has no dshDesktop, the Platform login does not need it. */`)
}

const openMarker = 'dsh-portable-login-open-v1'

// The Desktop shell opens the sign-in page itself when an attempt starts waiting for the browser; Portable's host
// has no such shell, so the dialog only offered "copy link" and spun forever. Open the Platform page once per
// attempt: WebView2 forwards window.open to the system default browser, where the user is usually signed in.
export function patchLoginBrowserOpen(source) {
  if (source.includes(openMarker)) return source
  const effect = /(\(0, react\.useEffect\)\(\(\) => \{\r?\n)(\s*)(setCopyResult\(null\);)(\r?\n\s*\}, \[attempt\?\.id, attempt\?\.authorizeUrl\]\);)/g
  const matches = source.match(effect)?.length ?? 0
  if (matches !== 1) throw new Error(`sign-in dialog seam changed upstream: expected 1 match, found ${matches}`)
  return source.replace(effect, (_, head, indent, body, tail) => `${head}${indent}${body}\n${indent}/* ${openMarker} */ if (attempt?.authorizeUrl && attempt.phase === "waiting-browser" && globalThis.__dshPortableLoginOpened !== attempt.id) { globalThis.__dshPortableLoginOpened = attempt.id; window.open(authorizeUrlWithTheme(attempt.authorizeUrl, colorScheme), "_blank"); }${tail}`)
}

export const patchAccountClient = source => patchLoginBrowserOpen(patchAccountLogin(source))

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: patch-account-login.mjs <app-root>')
  const filename = path.join(path.resolve(process.argv[2]), 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-account', 'lib', 'client.js')
  await writeFile(filename, patchAccountClient(await readFile(filename, 'utf8')), 'utf8')
}
