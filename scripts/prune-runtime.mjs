import assert from 'node:assert/strict'
import { access, readFile, readdir, rm, stat } from 'node:fs/promises'
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
const nativeRoot = path.join(prebuildRoot, target)
const requiredNativeFiles = platform === 'win32'
  ? ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']
  : platform === 'darwin'
    ? ['pty.node', 'spawn-helper']
    : ['pty.node']
for (const relative of requiredNativeFiles) await access(path.join(nativeRoot, ...relative.split('/')))

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
const sourceOnlyPackages = [
  ['@mistralai', 'mistralai', 'src'],
  ['@anthropic-ai', 'sdk', 'src'],
  ['openai', 'src'],
  ['zod', 'src'],
  ['ajv', 'lib'],
  ['@wsl043', 'dsh-portable-plugin-market', 'src'],
]
const reviewedPackagingOnlyPayloads = [
  {
    packagePath: ['@mistralai', 'mistralai'],
    runtimeEntry: /^\.\/esm\/index\.js$/,
    remove: ['packages', 'examples', 'tests', 'FUNCTIONS.md', 'RUNTIMES.md', 'jsr.json'],
  },
  {
    packagePath: ['@mixmark-io', 'domino'],
    runtimeEntry: /^\.\/lib\/?$/,
    remove: ['test', '.yarn'],
  },
]
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
  if (entry.isDirectory() && entry.name !== target) {
    await removeTree(path.join(prebuildRoot, entry.name))
  }
}
await removeDebugSymbols(nativeRoot)

if (platform === 'linux') {
  // Koffi publishes both glibc and musl binaries in the same Linux package.
  // DSH-Portable is built and supported on Ubuntu/glibc; retaining the unused
  // musl binary makes linuxdeploy try to resolve libc.musl-*.so.1 and abort.
  const koffiNativeRoot = path.join(nodeModules, '@koromix', `koffi-linux-${architecture}`)
  const koffiGlibcRoot = path.join(koffiNativeRoot, `linux_${architecture}`)
  const koffiMuslRoot = path.join(koffiNativeRoot, `musl_${architecture}`)
  await access(path.join(koffiGlibcRoot, 'koffi.node'))
  try {
    await removeTree(koffiMuslRoot)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

// npm install has already selected and validated the target prebuild. These
// directories contain only build inputs or TypeScript declarations and are not
// read by node-pty's runtime loader.
const removablePtyDirectories = ['benchmark', 'benchmarks', 'build', 'deps', 'examples', 'scripts', 'src', 'test', 'tests', 'third_party', 'typings']
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
for (const segments of sourceOnlyPackages) {
  const packageRoot = path.join(nodeModules, ...segments.slice(0, -1))
  const sourceRoot = path.join(nodeModules, ...segments)
  try {
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    const runtimeEntry = String(manifest.main ?? manifest.module ?? '')
    if (/\.tsx?$/i.test(runtimeEntry)) continue
    await removeTree(sourceRoot)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
for (const rule of reviewedPackagingOnlyPayloads) {
  const packageRoot = path.join(nodeModules, ...rule.packagePath)
  try {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    if (!rule.runtimeEntry.test(String(manifest.main ?? ''))) {
      throw new Error(`refusing to prune an unreviewed ${manifest.name ?? rule.packagePath.join('/')} runtime layout`)
    }
    for (const relative of rule.remove) {
      try {
        await removeTree(path.join(packageRoot, relative))
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
const typePackages = path.join(nodeModules, '@types')
try {
  await removeTree(typePackages)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

// Local package sources are installation inputs only. npm has already copied
// and validated their runtime products in node_modules, so keeping a second
// source tree in every portable package only increases transfer and extraction
// cost. Future component updates deliver a complete, verified app directory.
const vendorRoot = path.join(appDir, 'vendor')
try {
  await access(path.join(nodeModules, '@wsl043', 'dsh-portable-plugin-market', 'package.json'))
  await removeTree(vendorRoot)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const targetFiles = await readdir(nativeRoot)
assert.equal(targetFiles.some((name) => name.endsWith('.node')), true, `node-pty target ${target} has no native module`)
assert.equal(targetFiles.some((name) => name.endsWith('.pdb')), false, `node-pty target ${target} retained debug symbols`)
const remainingTargets = (await readdir(prebuildRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
assert.deepEqual(remainingTargets, [target])
if (platform === 'linux') {
  await access(path.join(nodeModules, '@koromix', `koffi-linux-${architecture}`, `linux_${architecture}`, 'koffi.node'))
  await assert.rejects(access(path.join(nodeModules, '@koromix', `koffi-linux-${architecture}`, `musl_${architecture}`)), { code: 'ENOENT' })
}

const after = await bytes(ptyRoot)
console.log(JSON.stringify({
  target,
  before,
  after,
  saved: removed.bytes,
  removedFiles: removed.files,
  removedDirectories: removed.directories,
}))
