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
const allowed = new Set(['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
assert.equal(allowed.has(target), true, `unsupported runtime prune target: ${target}`)
const linuxNativeRoot = path.join(ptyRoot, 'build', 'Release')
const nativeRoot = platform === 'linux' ? linuxNativeRoot : path.join(prebuildRoot, target)
await access(path.join(nativeRoot, 'pty.node'))

async function bytes(root) {
  const info = await stat(root)
  if (info.isFile()) return info.size
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) total += await bytes(path.join(root, entry.name))
  return total
}

async function treeStats(root) {
  const info = await stat(root)
  if (info.isFile()) return { bytes: info.size, files: 1, directories: 0 }
  const result = { bytes: 0, files: 0, directories: 1 }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = await treeStats(path.join(root, entry.name))
    result.bytes += child.bytes
    result.files += child.files
    result.directories += child.directories
  }
  return result
}

const removableDocument = /^(?:readme|changelog|changes|history|contributing|code_of_conduct)(?:\..*)?$/i
const removableBuildArtifact = /(?:\.map|\.d\.(?:ts|mts|cts)|\.tsbuildinfo)$/i
const removed = { bytes: 0, files: 0, directories: 0 }

async function removeTree(filename) {
  const totals = await treeStats(filename)
  await rm(filename, { recursive: true, force: true })
  removed.bytes += totals.bytes
  removed.files += totals.files
  removed.directories += totals.directories
}

async function prunePackagePayload(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name)
    if (entry.isDirectory()) {
      await prunePackagePayload(filename)
      continue
    }
    if (removableBuildArtifact.test(entry.name) || removableDocument.test(entry.name)) {
      await removeTree(filename)
    }
  }
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
  if (entry.isDirectory() && (platform === 'linux' || entry.name !== target)) {
    await removeTree(path.join(prebuildRoot, entry.name))
  }
}
await removeDebugSymbols(nativeRoot)

if (platform === 'linux') {
  const buildRoot = path.join(ptyRoot, 'build')
  for (const entry of await readdir(buildRoot, { withFileTypes: true })) {
    if (entry.name !== 'Release') await removeTree(path.join(buildRoot, entry.name))
  }
  for (const entry of await readdir(linuxNativeRoot, { withFileTypes: true })) {
    if (!['pty.node', 'spawn-helper'].includes(entry.name)) {
      await removeTree(path.join(linuxNativeRoot, entry.name))
    }
  }
}

// npm install has already selected and validated the target prebuild. These
// directories contain only build inputs or TypeScript declarations and are not
// read by node-pty's runtime loader.
const removablePtyDirectories = ['benchmark', 'benchmarks', 'deps', 'examples', 'scripts', 'src', 'test', 'tests', 'third_party', 'typings']
if (platform !== 'linux') removablePtyDirectories.push('build')
for (const name of removablePtyDirectories) {
  const filename = path.join(ptyRoot, name)
  try {
    await removeTree(filename)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
await rm(path.join(ptyRoot, 'binding.gyp'), { force: true })

// Package directory names are not a runtime contract. Some dependencies load
// JavaScript or data from folders named `doc`, `test`, or `examples`, so never
// remove a directory across all of node_modules merely because its name looks
// like development material. Only remove file formats that Node cannot execute
// at runtime, plus the package-specific node-pty build inputs above.
await prunePackagePayload(nodeModules)
const typePackages = path.join(nodeModules, '@types')
try {
  await removeTree(typePackages)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const targetFiles = await readdir(nativeRoot)
assert.equal(targetFiles.some((name) => name.endsWith('.node')), true, `node-pty target ${target} has no native module`)
assert.equal(targetFiles.some((name) => name.endsWith('.pdb')), false, `node-pty target ${target} retained debug symbols`)
const remainingTargets = (await readdir(prebuildRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
assert.deepEqual(remainingTargets, platform === 'linux' ? [] : [target])

const after = await bytes(ptyRoot)
console.log(JSON.stringify({
  target,
  before,
  after,
  saved: removed.bytes,
  removedFiles: removed.files,
  removedDirectories: removed.directories,
}))
