import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { constants, createZstdCompress } from 'node:zlib'

const MAGIC = Buffer.from('DSHPACK1', 'ascii')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function listFiles(root, relative = '') {
  const result = []
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? path.posix.join(relative.replaceAll('\\', '/'), entry.name) : entry.name
    if (entry.isDirectory()) result.push(...await listFiles(root, child))
    else if (entry.isFile()) result.push(child)
    else throw new Error(`Runtime capsule does not support links or special files: ${child}`)
  }
  return result.sort((a, b) => a.localeCompare(b, 'en'))
}

export async function createRuntimeCapsule(appDir, capsuleFile, manifestFile, options = {}) {
  const files = await listFiles(appDir)
  const entries = []
  let rawBytes = 0
  for (const relative of files) {
    const bytes = await readFile(path.join(appDir, ...relative.split('/')))
    rawBytes += bytes.length
    entries.push({ path: `app/${relative}`, size: bytes.length, sha256: sha256(bytes) })
  }
  const header = Buffer.from(JSON.stringify({ schemaVersion: 1, files: entries }), 'utf8')
  const prefix = Buffer.alloc(MAGIC.length + 4)
  MAGIC.copy(prefix)
  prefix.writeUInt32LE(header.length, MAGIC.length)

  await mkdir(path.dirname(capsuleFile), { recursive: true })
  const rawFile = `${capsuleFile}.${process.pid}.raw`
  const handle = await open(rawFile, 'w')
  try {
    await handle.write(prefix)
    await handle.write(header)
    for (const relative of files) {
      await handle.write(await readFile(path.join(appDir, ...relative.split('/'))))
    }
  } finally {
    await handle.close()
  }
  try {
    await pipeline(
      createReadStream(rawFile),
      createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: options.level ?? 10 } }),
      createWriteStream(capsuleFile),
    )
  } finally {
    await rm(rawFile, { force: true })
  }

  const compressed = await readFile(capsuleFile)
  const manifest = {
    schemaVersion: 1,
    format: 'dshpack-zstd-v1',
    filename: path.relative(path.dirname(manifestFile), capsuleFile).replaceAll('\\', '/'),
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    sha256: sha256(compressed),
    bytes: compressed.length,
    rawBytes,
    fileCount: entries.length,
    required: [
      'app/package.json',
      'app/node_modules/@deepseek-ai/dsh/lib/bin.js',
      'app/node_modules/@wsl043/dsh-portable-desktop-bridge/cordis.patch.yml',
      'app/node_modules/@wsl043/dsh-portable-plugin-market/package.json',
      'app/node_modules/pnpm/bin/pnpm.cjs',
    ],
  }
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

async function main() {
  const [appDir, capsuleFile, manifestFile] = process.argv.slice(2)
  if (!appDir || !capsuleFile || !manifestFile) {
    throw new Error('Usage: node create-runtime-capsule.mjs <app-dir> <capsule-file> <manifest-file>')
  }
  const manifest = await createRuntimeCapsule(path.resolve(appDir), path.resolve(capsuleFile), path.resolve(manifestFile))
  process.stdout.write(`${JSON.stringify(manifest)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main()
}
