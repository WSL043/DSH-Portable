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
assert.equal(dshManifest.name, '@deepseek-ai/dsh')
assert.equal(existsSync(dshBin), true, `official DSH CLI is missing: ${dshBin}`)

await new Promise((resolve) => {
  process.stdout.write(`${JSON.stringify({ dshVersion: dshManifest.version, dshBin, loaded })}\n`, resolve)
})
// node-pty keeps a ConPTY handle referenced on some headless Windows hosts even
// after the child has emitted its marker. This script is a one-shot build gate,
// so leave explicitly after stdout has flushed.
process.exit(0)
