import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRuntimeCapsule } from './create-runtime-capsule.mjs'

const LICENSES = [
  'COMPONENTS.json',
  'DeepSeek-Harness-LICENSE.txt',
  'DeepSeek-Harness-THIRD_PARTY_NOTICES.md',
  'dsh-market-LICENSE.txt',
  'pnpm-LICENSE.txt',
]

async function sha256File(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

export async function createWindowsCapsuleUpdate(sourceStage, outputZip, options = {}) {
  const source = path.resolve(sourceStage)
  const output = path.resolve(outputZip)
  const temporary = path.join(path.dirname(output), `.capsule-update-${randomUUID()}`)
  try {
    await mkdir(path.join(temporary, 'runtime'), { recursive: true })
    await mkdir(path.join(temporary, 'licenses'), { recursive: true })
    const components = JSON.parse(await readFile(path.join(source, 'licenses', 'COMPONENTS.json'), 'utf8'))
    components.runtimeLayout = 'capsule-v1'
    await writeFile(
      path.join(temporary, 'licenses', 'COMPONENTS.json'),
      `${JSON.stringify(components, null, 2)}\n`,
      'utf8',
    )
    for (const name of LICENSES.slice(1)) {
      await cp(path.join(source, 'licenses', name), path.join(temporary, 'licenses', name), { force: true })
    }
    const runtimeManifest = await createRuntimeCapsule(
      path.join(source, 'app'),
      path.join(temporary, 'runtime', 'DSH-App.dshpack'),
      path.join(temporary, 'runtime-capsule.json'),
      { platform: 'win32', arch: 'x64', level: options.level ?? 10 },
    )
    await writeFile(path.join(temporary, 'component.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'dsh-runtime-capsule',
      portableVersion: components.portableVersion,
      releaseChannel: components.releaseChannel,
      dshVersion: components.dshVersion,
      dshCommit: components.dshCommit,
    }, null, 2)}\n`, 'utf8')
    await mkdir(path.dirname(output), { recursive: true })
    const packed = spawnSync('tar.exe', [
      '-a', '-c', '-f', output, '-C', temporary,
      'component.json', 'runtime-capsule.json', 'runtime', 'licenses',
    ], { stdio: 'inherit', windowsHide: true })
    if (packed.error) throw packed.error
    if (packed.status !== 0) throw new Error(`Capsule update creation failed with exit code ${packed.status}.`)
    return {
      archive: output,
      bytes: (await stat(output)).size,
      sha256: await sha256File(output),
      runtimeSha256: runtimeManifest.sha256,
      runtimeFiles: runtimeManifest.fileCount,
    }
  } finally {
    if (!options.keepStage) await rm(temporary, { recursive: true, force: true })
  }
}

async function main() {
  const [sourceStage, outputZip] = process.argv.slice(2)
  if (!sourceStage || !outputZip) {
    throw new Error('Usage: node create-windows-capsule-update.mjs <finished-windows-stage> <output-zip>')
  }
  process.stdout.write(`${JSON.stringify(await createWindowsCapsuleUpdate(sourceStage, outputZip), null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main()
