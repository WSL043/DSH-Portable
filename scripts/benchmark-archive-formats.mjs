import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { constants, createZstdCompress, createZstdDecompress } from 'node:zlib'

import { createFootprintReport } from './report-footprint.mjs'

const [rootArg, zipArg, outputArg] = process.argv.slice(2)
if (!rootArg || !zipArg || !outputArg) {
  throw new Error('usage: node benchmark-archive-formats.mjs <product-root> <zip-file> <output-directory>')
}

const root = path.resolve(rootArg)
const zip = path.resolve(zipArg)
const output = path.resolve(outputArg)
const tarZstd = path.join(output, 'DSH-Portable.tar.zst')
await mkdir(output, { recursive: true })

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${label} exited ${code}: ${stderr.trim()}`)))
  })
}

async function createTarZstd() {
  const started = performance.now()
  const tar = spawn('tar.exe', ['-cf', '-', '-C', path.dirname(root), path.basename(root)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  await Promise.all([
    pipeline(
      tar.stdout,
      createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: 10 } }),
      createWriteStream(tarZstd),
    ),
    waitForExit(tar, 'tar creation'),
  ])
  return Math.round(performance.now() - started)
}

async function extractZip() {
  const destination = await mkdtemp(path.join(os.tmpdir(), 'dsh-zip-benchmark-'))
  const started = performance.now()
  const tar = spawn('tar.exe', ['-xf', zip, '-C', destination], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  await waitForExit(tar, 'ZIP extraction')
  const elapsedMs = Math.round(performance.now() - started)
  const report = await createFootprintReport({ root: path.join(destination, path.basename(root)), platform: 'benchmark' })
  await rm(destination, { recursive: true, force: true })
  return { elapsedMs, bytes: report.total.bytes, files: report.total.files }
}

async function extractTarZstd() {
  const destination = await mkdtemp(path.join(os.tmpdir(), 'dsh-zstd-benchmark-'))
  const started = performance.now()
  const tar = spawn('tar.exe', ['-xf', '-', '-C', destination], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  await Promise.all([
    pipeline(createReadStream(tarZstd), createZstdDecompress(), tar.stdin),
    waitForExit(tar, 'tar+zstd extraction'),
  ])
  const elapsedMs = Math.round(performance.now() - started)
  const report = await createFootprintReport({ root: path.join(destination, path.basename(root)), platform: 'benchmark' })
  await rm(destination, { recursive: true, force: true })
  return { elapsedMs, bytes: report.total.bytes, files: report.total.files }
}

const zstdCreateMs = await createTarZstd()
const zipExtract = await extractZip()
const zstdExtract = await extractTarZstd()
if (zipExtract.bytes !== zstdExtract.bytes || zipExtract.files !== zstdExtract.files) {
  throw new Error('archive formats extracted different product trees')
}

const result = {
  schemaVersion: 1,
  product: { bytes: zipExtract.bytes, files: zipExtract.files },
  zip: { bytes: (await stat(zip)).size, extractMs: zipExtract.elapsedMs },
  tarZstd: { bytes: (await stat(tarZstd)).size, createMs: zstdCreateMs, extractMs: zstdExtract.elapsedMs, compressionLevel: 10 },
}
await writeFile(path.join(output, 'archive-benchmark.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify(result)}\n`)
