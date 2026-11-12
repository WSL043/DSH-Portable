import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifiedPackageFile } from './verified-package-file.mjs'

const openMarker = 'dsh-portable-login-open-v1'

// The Desktop shell opens the sign-in page itself when an attempt starts waiting for the browser; Portable's host
// has no such shell, so the dialog only offered "copy link" and spun forever. Open the Platform page once per
// attempt: WebView2 forwards window.open to the system default browser, where the user is usually signed in.
export function patchLoginBrowserOpen(source) {
  if (source.includes(openMarker)) return source
  const effect = /(\(0,\s*react\.useEffect\)\(\(\)\s*=>\s*\{\s*)(setCopyResult\(null\));?(\s*\},\s*\[attempt\?\.id,\s*attempt\?\.authorizeUrl\]\);?)/g
  const matches = source.match(effect)?.length ?? 0
  if (matches !== 1) throw new Error(`sign-in dialog seam changed upstream: expected 1 match, found ${matches}`)
  return source.replace(effect, (_, head, body, tail) => `${head}${body}; /* ${openMarker} */ if (attempt?.authorizeUrl && attempt.phase === "waiting-browser" && globalThis.__dshPortableLoginOpened !== attempt.id) { globalThis.__dshPortableLoginOpened = attempt.id; window.open(authorizeUrlWithTheme(attempt.authorizeUrl, colorScheme), "_blank"); }${tail}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: patch-account-login.mjs <app-root>')
  const filename = await verifiedPackageFile(process.argv[2], 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-account', 'lib', 'client.js')
  const source = await readFile(filename, 'utf8')
  const patched = patchLoginBrowserOpen(source)
  if (patched !== source) await writeFile(filename, patched, 'utf8')
}
