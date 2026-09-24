import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRuntimeCapsule } from './create-runtime-capsule.mjs'
import { ensureRuntimeCapsule } from '../launcher/runtime-capsule.mjs'

const PROGRAM_ENTRIES = [
  'launcher', 'default-plugins', 'docs', 'licenses',
  'DeepSeek-Herness.exe', 'DSH-Recovery.exe', 'dsh.exe', 'README.txt',
  'Microsoft.Toolkit.Uwp.Notifications.dll', 'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll', 'System.ValueTuple.dll', 'WebView2Loader.dll',
]

function isWithin(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function canonicalFuturePath(requested) {
  let existing = requested
  const missing = []
  while (true) {
    try { return path.join(await realpath(existing), ...missing) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      missing.unshift(path.basename(existing))
      existing = parent
    }
  }
}

function replacementPath(value) {
  if (typeof value !== 'string' || !/^[\w@.-][\w@./-]*$/.test(value)
    || value.split('/').some(segment => segment === '.' || segment === '..' || segment === '')) {
    throw new Error(`Unsafe preview replacement path: ${value}`)
  }
  return value
}

async function fileHash(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

async function optionalCopy(source, target) {
  let sourceStat
  try { sourceStat = await lstat(source) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (sourceStat.isSymbolicLink() || (!sourceStat.isDirectory() && !sourceStat.isFile())) {
    throw new Error(`Preview source has an unsupported program entry: ${source}`)
  }
  await cp(source, target, { recursive: sourceStat.isDirectory(), errorOnExist: true, force: false,
    filter: async entry => {
      const item = await lstat(entry)
      if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) {
        throw new Error(`Preview source contains an unsupported link or special file: ${entry}`)
      }
      return true
    },
  })
}

/** Build a disposable product with a new, content-addressed capsule. Never edit
 * the source installation or its shared runtime cache. outputParent must be a
 * disposable directory; the returned root is newly created and not replaced. */
export async function prepareIsolatedRuntimePreview({ baseRoot, outputParent, replacements }) {
  const base = await realpath(path.resolve(baseRoot))
  const requestedParent = path.resolve(outputParent)
  const prospectiveParent = await canonicalFuturePath(requestedParent)
  if (isWithin(base, prospectiveParent) || isWithin(prospectiveParent, base)) {
    throw new Error('Preview output and source installation must be disjoint.')
  }
  await mkdir(requestedParent, { recursive: true })
  const parent = await realpath(requestedParent)
  if (isWithin(base, parent) || isWithin(parent, base)) {
    throw new Error('Preview output and source installation must be disjoint.')
  }
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error('At least one preview replacement is required.')
  }
  const targets = new Set()
  for (const replacement of replacements) {
    const target = replacementPath(replacement.target)
    if (targets.has(target)) throw new Error(`Duplicate preview replacement: ${target}`)
    targets.add(target)
    if (!(await lstat(path.resolve(replacement.source))).isFile()) throw new Error('Preview replacement must be a regular file.')
  }
  const sourceManifest = JSON.parse(await readFile(path.join(base, 'runtime-capsule.json'), 'utf8'))
  if (sourceManifest.format !== 'dshpack-zstd-v1' || sourceManifest.filename !== 'runtime/DSH-App.dshpack'
    || !/^[a-f0-9]{64}$/.test(sourceManifest.sha256)) {
    throw new Error('Source installation has no valid content-addressed runtime capsule.')
  }
  const output = await mkdtemp(path.join(parent, 'preview-'))
  const staging = path.join(output, '.staging')
  let completed = false
  try {
    for (const entry of PROGRAM_ENTRIES) await optionalCopy(path.join(base, entry), path.join(output, entry))
    await mkdir(path.join(output, 'app'), { recursive: true })
    await optionalCopy(path.join(base, 'app', 'package.json'), path.join(output, 'app', 'package.json'))
    for (const entry of await readdir(path.join(base, 'runtime'))) {
      if (entry !== 'DSH-App.dshpack') {
        await optionalCopy(path.join(base, 'runtime', entry), path.join(output, 'runtime', entry))
      }
    }
    const prepared = await ensureRuntimeCapsule(base, {
      env: { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: path.join(staging, 'source-cache') },
    })
    if (prepared.mode !== 'capsule' || prepared.manifest.sha256 !== sourceManifest.sha256) {
      throw new Error('Source runtime identity changed while preparing the preview.')
    }
    const appDir = path.join(prepared.runtimeRoot, 'app')
    const applied = []
    for (const replacement of replacements) {
      const { source } = replacement
      const target = replacementPath(replacement.target)
      const destination = path.join(appDir, ...target.split('/'))
      const existing = await lstat(destination)
      if (!existing.isFile()) throw new Error(`Preview target is not a regular file: ${target}`)
      const sourceHash = await fileHash(path.resolve(source))
      const originalHash = await fileHash(destination)
      await cp(path.resolve(source), destination, { force: true })
      const resultHash = await fileHash(destination)
      if (resultHash !== sourceHash) throw new Error(`Preview replacement changed during copy: ${target}`)
      applied.push({ target, originalSha256: originalHash, previewSha256: resultHash })
    }
    const candidate = await createRuntimeCapsule(appDir,
      path.join(output, 'runtime', 'DSH-App.dshpack'), path.join(output, 'runtime-capsule.json'), {
        level: 3, platform: sourceManifest.platform, arch: sourceManifest.arch, required: sourceManifest.required,
      })
    if (candidate.sha256 === sourceManifest.sha256) throw new Error('Preview capsule did not receive a new identity.')
    const receipt = {
      schemaVersion: 1, kind: 'isolated-runtime-preview', createdAt: new Date().toISOString(),
      sourceCapsuleSha256: sourceManifest.sha256, previewCapsuleSha256: candidate.sha256,
      replacements: applied,
      disposal: 'Exit the preview and move this entire directory to the Recycle Bin.',
    }
    await writeFile(path.join(output, 'preview-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
    await writeFile(path.join(output, 'Launch preview.cmd'), [
      '@echo off', 'setlocal',
      'set "DSH_PORTABLE_STATE_ROOT=%~dp0"',
      'set "DSH_PORTABLE_RUNTIME_CACHE=%~dp0preview-runtime-cache"',
      'set "DSH_HOME=%~dp0data\\dsh-home"',
      'start "" "%~dp0DeepSeek-Herness.exe"', '',
    ].join('\r\n'))
    // This is a newly created, verified private staging directory; the
    // content-addressed candidate capsule now owns the preview bytes.
    if (!isWithin(output, staging)) throw new Error('Unsafe preview staging path.')
    await rm(staging, { recursive: true, force: true })
    completed = true
    return { output, receipt }
  } finally {
    if (!completed) {
      if (!isWithin(parent, output)) throw new Error('Unsafe incomplete preview path.')
      await rm(output, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [baseRoot, ...pairs] = process.argv.slice(2)
  if (!baseRoot || pairs.length === 0 || pairs.some(pair => !pair.includes('='))) {
    throw new Error('Usage: node scripts/prepare-isolated-runtime-preview.mjs <product-root> <app-relative-path>=<source-file> [...]')
  }
  const replacements = pairs.map(pair => {
    const separator = pair.indexOf('=')
    return { target: pair.slice(0, separator), source: pair.slice(separator + 1) }
  })
  const result = await prepareIsolatedRuntimePreview({ baseRoot,
    outputParent: path.resolve('build', 'runtime-previews'), replacements })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
