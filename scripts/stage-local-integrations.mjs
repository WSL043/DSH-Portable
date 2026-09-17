import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
export async function stageLocalIntegrations(appDirectory, sourceRoot = root) {
  const app = path.resolve(appDirectory)
  const managedDependencies = {}
  for (const [relativeSource, name] of [
    ['desktop-bridge', 'dsh-portable-desktop-bridge'],
    ['app/vendor/dsh-portable-plugin-market', 'dsh-portable-plugin-market'],
  ]) {
    const target = path.join(app, 'node_modules', '@wsl043', name)
    await rm(target, { recursive: true, force: true })
    await cp(path.join(sourceRoot, relativeSource), target, {
      recursive: true,
      filter: source => !source.split(path.sep).includes('node_modules'),
    })
    const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'))
    if (manifest.name !== `@wsl043/${name}` || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
      throw new Error(`Invalid managed integration identity: ${name}`)
    }
    managedDependencies[manifest.name] = manifest.version
  }
  // alpha.2 resolves plugins from the installation's declared dependency
  // closure, not from profiles/node_modules. Declare the integrations owned
  // by this community build instead of modifying user profiles or disabling
  // the official runtime resolver. Only the staged manifest is extended.
  const filename = path.join(app, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const manifest = JSON.parse(await readFile(filename, 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh') throw new Error('Invalid DSH installation anchor')
  manifest.dependencies = { ...manifest.dependencies, ...managedDependencies }
  manifest.dshPortable = { ...manifest.dshPortable, managedDependencies }
  await writeFile(filename, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: stage-local-integrations.mjs <staged-app>')
  await stageLocalIntegrations(process.argv[2])
}
