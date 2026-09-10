import path from 'node:path'
import { createRuntimeCapsule } from './create-runtime-capsule.mjs'

const [source, destination] = process.argv.slice(2)
if (!source || !destination) throw new Error('Provide the verified WebView2 directory and output directory.')
const manifest = await createRuntimeCapsule(path.resolve(source), path.resolve(destination, 'WebView2.dshpack'),
  path.resolve(destination, 'runtime-capsule.json'), {
    // This browser is an on-demand fallback: spend build time to reduce downloads,
    // without changing the core capsule's faster, frequently used compression policy.
    level: 22,
    platform: 'win32', arch: 'x64', required: ['app/msedgewebview2.exe', 'app/msedge.dll'],
  })
console.log(JSON.stringify({bytes:manifest.bytes,rawBytes:manifest.rawBytes,fileCount:manifest.fileCount}))
