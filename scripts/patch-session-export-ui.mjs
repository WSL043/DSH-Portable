import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifiedPackageFile } from './verified-package-file.mjs'

// The core publisher calls this historical entry point. The official client
// owns the export UI and WebView2 owns the generic save dialog.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node patch-session-export-ui.mjs <staged-app-directory>')
  await verifiedPackageFile(path.resolve(process.argv[2]), 'node_modules', '@deepseek-ai', 'dsh-session-log-export', 'lib', 'client.js')
}
