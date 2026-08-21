import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const appDir = path.resolve(process.argv[2] ?? '')
if (!appDir || !existsSync(path.join(appDir, 'package.json'))) {
  throw new Error('usage: node verify-runtime.mjs <staged-app-directory>')
}

const requireFromApp = createRequire(path.join(appDir, 'package.json'))
const loaded = []
for (const dependency of ['node-pty', 'koffi', 'protobufjs']) {
  assert.ok(requireFromApp(dependency), `${dependency} did not load`)
  loaded.push(dependency)
}

const subprocessEntry = requireFromApp.resolve('@deepseek-ai/dsh-subprocess-local')
await import(pathToFileURL(subprocessEntry).href)
loaded.push('@deepseek-ai/dsh-subprocess-local')

const pty = requireFromApp('node-pty')
await new Promise((resolve, reject) => {
  const marker = 'DSH_PORTABLE_PTY_OK'
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `echo ${marker}`]
    : ['-lc', `printf ${marker}`]
  const child = pty.spawn(shell, args, { cols: 80, rows: 24, cwd: appDir, env: process.env })
  let output = ''
  let settled = false
  const finish = (action) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    action()
  }
  const timeout = setTimeout(() => finish(() => reject(new Error('node-pty runtime smoke timed out'))), 10000)
  child.onData((text) => {
    output += text
    if (output.includes(marker)) finish(resolve)
  })
  child.onExit(({ exitCode }) => {
    if (exitCode !== 0 || !output.includes(marker)) {
      finish(() => reject(new Error(`node-pty runtime smoke failed: exit=${exitCode} output=${JSON.stringify(output)}`)))
    }
  })
})
loaded.push('node-pty-spawn')

const dshManifestPath = requireFromApp.resolve('@deepseek-ai/dsh/package.json')
const dshManifest = JSON.parse(readFileSync(dshManifestPath, 'utf8'))
const dshBin = path.join(path.dirname(dshManifestPath), 'lib', 'bin.js')
const pnpmManifestPath = path.join(appDir, 'node_modules', 'pnpm', 'package.json')
const pnpmManifest = JSON.parse(readFileSync(pnpmManifestPath, 'utf8'))
const pnpmBin = path.join(appDir, 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
const piAiProviderData = path.join(
  appDir,
  'node_modules',
  '@earendil-works',
  'pi-ai',
  'dist',
  'providers',
  'data',
  'amazon-bedrock.json',
)
const desktopBridgeManifestPath = requireFromApp.resolve('@wsl043/dsh-portable-desktop-bridge/package.json')
const desktopBridgeRoot = path.dirname(desktopBridgeManifestPath)
const marketManifestPath = requireFromApp.resolve('@wsl043/dsh-portable-plugin-market/package.json')
const marketManifest = JSON.parse(readFileSync(marketManifestPath, 'utf8'))
const marketRoot = path.dirname(marketManifestPath)
const marketClientPath = requireFromApp.resolve('@wsl043/dsh-portable-plugin-market/client')
const sessionExportClientPath = requireFromApp.resolve('@deepseek-ai/dsh-session-log-export/client')
assert.equal(dshManifest.name, '@deepseek-ai/dsh')
assert.equal(existsSync(dshBin), true, `official DSH CLI is missing: ${dshBin}`)
assert.equal(pnpmManifest.version, '11.7.0', 'bundled pnpm version')
assert.equal(existsSync(pnpmBin), true, `bundled pnpm command is missing: ${pnpmBin}`)
assert.equal(existsSync(piAiProviderData), true, `pi-ai provider data is missing: ${piAiProviderData}`)
assert.equal(existsSync(path.join(desktopBridgeRoot, 'lib', 'client.js')), true, 'desktop bridge client is missing')
assert.equal(existsSync(path.join(desktopBridgeRoot, 'lib', 'index.js')), true, 'desktop bridge host entry is missing')
assert.equal(existsSync(path.join(desktopBridgeRoot, 'cordis.patch.yml')), true, 'desktop bridge patch is missing')
assert.equal(marketManifest.name, '@wsl043/dsh-portable-plugin-market')
assert.match(marketManifest.version, /^0\.1\.0-beta\.\d+$/, 'pinned Portable visual market version')
assert.equal(existsSync(marketClientPath), true, 'Portable plugin market client is missing')
assert.match(
  readFileSync(marketClientPath, 'utf8'),
  /^window\.__ModuleLoader__\.load\(\{\s*id:\s*"@wsl043\/dsh-portable-plugin-market"/,
  'Portable plugin market client registered the wrong module id',
)
assert.equal(existsSync(path.join(marketRoot, 'LICENSE')), true, 'Portable plugin market license is missing')
assert.equal(existsSync(path.join(marketRoot, 'NOTICE.md')), true, 'Portable plugin market attribution notice is missing')
assert.match(
  readFileSync(sessionExportClientPath, 'utf8'),
  /dsh-portable-native-download-v1/,
  'Session export client is missing the native desktop download lifecycle adapter',
)

await new Promise((resolve) => {
  process.stdout.write(`${JSON.stringify({ dshVersion: dshManifest.version, dshBin, marketVersion: marketManifest.version, pnpmVersion: pnpmManifest.version, pnpmBin, loaded })}\n`, resolve)
})
// node-pty keeps a ConPTY handle referenced on some headless Windows hosts even
// after the child has emitted its marker. This script is a one-shot build gate,
// so leave explicitly after stdout has flushed.
process.exit(0)
