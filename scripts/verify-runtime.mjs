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

const dshManifestPath = requireFromApp.resolve('@deepseek-ai/dsh/package.json')
const dshManifest = JSON.parse(readFileSync(dshManifestPath, 'utf8'))
const dshBin = path.join(path.dirname(dshManifestPath), 'lib', 'bin.js')
assert.equal(dshManifest.name, '@deepseek-ai/dsh')
assert.equal(existsSync(dshBin), true, `official DSH CLI is missing: ${dshBin}`)

console.log(JSON.stringify({ dshVersion: dshManifest.version, dshBin, loaded }))
