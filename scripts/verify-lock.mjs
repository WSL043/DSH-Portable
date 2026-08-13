import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [lockfileName, upstreamName] = process.argv.slice(2)
if (!lockfileName || !upstreamName) {
  console.error('usage: node verify-lock.mjs <package-lock.json> <upstream.lock.json>')
  process.exit(2)
}

const [lockfile, upstream] = await Promise.all([
  readFile(path.resolve(lockfileName), 'utf8').then(JSON.parse),
  readFile(path.resolve(upstreamName), 'utf8').then(JSON.parse),
])

assert.equal(lockfile.lockfileVersion, 3, 'npm lockfile version must be 3')
const root = lockfile.packages?.['']
assert.deepEqual(root?.dependencies, { [upstream.dsh.package]: upstream.dsh.version })
const installed = lockfile.packages?.[`node_modules/${upstream.dsh.package}`]
assert.equal(installed?.version, upstream.dsh.version, 'pinned DSH version')
assert.equal(installed?.integrity, upstream.dsh.integrity, 'pinned DSH integrity')
assert.equal(installed?.license, 'MIT', 'DSH npm license')

const serializedRoot = JSON.stringify(root)
for (const forbidden of ['@yanxu', 'openai-codex', 'opencode-zen', 'GenericAgent']) {
  assert.equal(serializedRoot.includes(forbidden), false, `forbidden root integration: ${forbidden}`)
}

console.log(JSON.stringify({
  dshVersion: installed.version,
  integrity: installed.integrity,
  packages: Object.keys(lockfile.packages).length,
}))
