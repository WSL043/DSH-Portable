import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [rootArgument, fixtureArgument] = process.argv.slice(2)
if (!rootArgument || !fixtureArgument) {
  throw new Error('usage: node smoke-portable-extensions.mjs <finished-product-root> <independent-plugin-fixture>')
}

const root = path.resolve(rootArgument)
const fixture = path.resolve(fixtureArgument)
const missing = async filename => access(filename).then(() => false, error => {
  if (error?.code === 'ENOENT') return true
  throw error
})

assert.equal(await missing(path.join(root, 'launcher', 'extension-operations.mjs')), true)
assert.equal(await missing(path.join(root, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'lib', 'extensions.js')), true)
assert.equal(await missing(path.join(root, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'extensions', 'catalog.json')), true)
await access(fixture)

const client = await readFile(path.join(
  root, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'lib', 'client.js',
), 'utf8')
assert.doesNotMatch(client, /Portable extensions|便携扩展|portable-extensions|\/api\/dsh-portable\/extensions/)

const core = await import(pathToFileURL(path.join(root, 'launcher', 'portable-core.mjs')))
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-retired-extension-product-'))
const pending = path.join(temporary, 'pending-extension.json')
const result = path.join(temporary, 'extension-result.json')
try {
  await writeFile(pending, JSON.stringify({
    schemaVersion: 1,
    operationId: 'finished-product-retirement',
    id: 'legacy-extension',
    action: 'install',
    status: 'queued',
  }))
  assert.equal(await core.retirePendingExtensionOperation({ extensionPending: pending, extensionResult: result }), true)
  assert.equal(await missing(pending), true)
  assert.equal(JSON.parse(await readFile(result, 'utf8')).code, 'portable_extensions_retired')
} finally {
  await rm(temporary, { recursive: true, force: true })
}

process.stdout.write('[portable-extensions-smoke] stable product has no built-in extension surface and retires queued RC work without applying it\n')
