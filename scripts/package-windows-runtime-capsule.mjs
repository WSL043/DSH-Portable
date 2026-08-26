import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRuntimeCapsule } from './create-runtime-capsule.mjs'

export async function copyCapsuleShell(source, target) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['app', 'data', 'workspace', 'runtime-capsule.json'].includes(entry.name)) continue
    await cp(path.join(source, entry.name), path.join(target, entry.name), { recursive: true, force: true })
  }
  // Mutable state never belongs in a distributable package. Recreate only the
  // empty portable roots even when the source stage has already been smoked.
  await mkdir(path.join(target, 'data'), { recursive: true })
  await mkdir(path.join(target, 'workspace'), { recursive: true })
  for (const relative of [path.join('data', 'README.txt'), path.join('workspace', 'README.txt')]) {
    try {
      await cp(path.join(source, relative), path.join(target, relative), { force: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  // Older full-package updaters use app/package.json as a conservative
  // completeness marker. Keep only that tiny marker outside the capsule so an
  // existing 0.4 installation can upgrade without retaining the expanded tree.
  await mkdir(path.join(target, 'app'), { recursive: true })
  await cp(path.join(source, 'app', 'package.json'), path.join(target, 'app', 'package.json'), { force: true })

  const componentsFile = path.join(target, 'licenses', 'COMPONENTS.json')
  const components = JSON.parse(await readFile(componentsFile, 'utf8'))
  components.runtimeLayout = 'capsule-v1'
  await writeFile(componentsFile, `${JSON.stringify(components, null, 2)}\n`, 'utf8')
}

async function countFiles(root) {
  let count = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) count += await countFiles(path.join(root, entry.name))
    else if (entry.isFile()) count += 1
  }
  return count
}

async function sha256File(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

export async function packageWindowsRuntimeCapsule(sourceStage, outputZip, options = {}) {
  const source = path.resolve(sourceStage)
  const output = path.resolve(outputZip)
  const temporaryParent = path.join(path.dirname(output), `.runtime-capsule-stage-${randomUUID()}`)
  const stage = path.join(temporaryParent, 'DSH-Portable')
  try {
    await copyCapsuleShell(source, stage)
    const capsuleFile = path.join(stage, 'runtime', 'DSH-App.dshpack')
    const manifestFile = path.join(stage, 'runtime-capsule.json')
    const manifest = await createRuntimeCapsule(
      path.join(source, 'app'),
      capsuleFile,
      manifestFile,
      { platform: 'win32', arch: 'x64', level: options.level ?? 10 },
    )
    await mkdir(path.dirname(output), { recursive: true })
    const tar = spawnSync('tar.exe', ['-a', '-c', '-f', output, '-C', temporaryParent, 'DSH-Portable'], {
      stdio: 'inherit',
      windowsHide: true,
    })
    if (tar.error) throw tar.error
    if (tar.status !== 0) throw new Error(`Capsule ZIP creation failed with exit code ${tar.status}.`)
    const archiveSha256 = await sha256File(output)
    await writeFile(`${output}.sha256`, `${archiveSha256}  ${path.basename(output)}`, 'ascii')
    return {
      archive: output,
      archiveBytes: (await stat(output)).size,
      archiveSha256,
      packageFiles: await countFiles(stage),
      runtimeFiles: manifest.fileCount,
      runtimeBytes: manifest.bytes,
      runtimeSha256: manifest.sha256,
    }
  } finally {
    if (!options.keepStage) await rm(temporaryParent, { recursive: true, force: true })
  }
}

async function main() {
  const [sourceStage, outputZip] = process.argv.slice(2)
  if (!sourceStage || !outputZip) {
    throw new Error('Usage: node package-windows-runtime-capsule.mjs <finished-windows-stage> <output-zip>')
  }
  process.stdout.write(`${JSON.stringify(await packageWindowsRuntimeCapsule(sourceStage, outputZip), null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main()
