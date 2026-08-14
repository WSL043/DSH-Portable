import assert from 'node:assert/strict'
import { access, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const appDir = path.resolve(process.argv[2] ?? '')
const platform = process.argv[3] ?? process.platform
const architecture = process.argv[4] ?? process.arch
if (!appDir) throw new Error('usage: node prune-runtime.mjs <staged-app-directory> [platform] [architecture]')

const nodeModules = path.join(appDir, 'node_modules')
const ptyRoot = path.join(nodeModules, 'node-pty')
const prebuildRoot = path.join(ptyRoot, 'prebuilds')
await access(path.join(ptyRoot, 'package.json'))

const target = `${platform}-${architecture}`
const allowed = new Set(['win32-x64', 'darwin-arm64', 'darwin-x64'])
assert.equal(allowed.has(target), true, `unsupported runtime prune target: ${target}`)
await access(path.join(prebuildRoot, target))

async function bytes(root) {
  const info = await stat(root)
  if (info.isFile()) return info.size
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) total += await bytes(path.join(root, entry.name))
  return total
}

async function removeDebugSymbols(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name)
    if (entry.isDirectory()) await removeDebugSymbols(filename)
    else if (entry.name.toLowerCase().endsWith('.pdb')) await rm(filename, { force: true })
  }
}

const before = await bytes(ptyRoot)
for (const entry of await readdir(prebuildRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== target) await rm(path.join(prebuildRoot, entry.name), { recursive: true, force: true })
}
await removeDebugSymbols(path.join(prebuildRoot, target))

// npm install has already selected and validated the target prebuild. These
// directories contain only build inputs or TypeScript declarations and are not
// read by node-pty's runtime loader.
for (const name of ['deps', 'scripts', 'src', 'third_party', 'typings']) {
  await rm(path.join(ptyRoot, name), { recursive: true, force: true })
}
await rm(path.join(ptyRoot, 'binding.gyp'), { force: true })

const targetFiles = await readdir(path.join(prebuildRoot, target))
assert.equal(targetFiles.some((name) => name.endsWith('.node')), true, `node-pty target ${target} has no native module`)
assert.equal(targetFiles.some((name) => name.endsWith('.pdb')), false, `node-pty target ${target} retained debug symbols`)
const remainingTargets = (await readdir(prebuildRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
assert.deepEqual(remainingTargets, [target])

const after = await bytes(ptyRoot)
console.log(JSON.stringify({ target, before, after, saved: before - after }))
