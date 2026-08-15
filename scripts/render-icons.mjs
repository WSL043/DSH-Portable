import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [appDir, sourceSvg, outputDir] = process.argv.slice(2)
if (!appDir || !sourceSvg || !outputDir) {
  throw new Error('usage: render-icons.mjs <installed-app-dir> <source-svg> <output-dir>')
}

const sharpModule = path.join(path.resolve(appDir), 'node_modules', 'sharp', 'dist', 'index.mjs')
const { default: sharp } = await import(pathToFileURL(sharpModule).href)
const svg = await readFile(path.resolve(sourceSvg))
await mkdir(path.resolve(outputDir), { recursive: true })

async function png(size) {
  return sharp(svg, { density: 512 })
    .resize(size, size, { fit: 'contain' })
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size === 256 ? 0 : size, entry)
    header.writeUInt8(size === 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(bytes.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += bytes.length
  })
  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)])
}

function icns(chunks) {
  const body = chunks.map(({ type, bytes }) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(bytes.length + 8, 4)
    return Buffer.concat([header, bytes])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(8 + body.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([header, ...body])
}

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const icoImages = await Promise.all(icoSizes.map(async (size) => ({ size, bytes: await png(size) })))
await writeFile(path.join(outputDir, 'DSH-Portable.ico'), ico(icoImages))

const icnsSpecs = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256],
  ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
]
const icnsChunks = await Promise.all(icnsSpecs.map(async ([type, size]) => ({ type, bytes: await png(size) })))
await writeFile(path.join(outputDir, 'DSH-Portable.icns'), icns(icnsChunks))
await writeFile(path.join(outputDir, 'DSH-Portable-512.png'), await png(512))

console.log(JSON.stringify({ ico: 'DSH-Portable.ico', icns: 'DSH-Portable.icns', png: 'DSH-Portable-512.png' }))
