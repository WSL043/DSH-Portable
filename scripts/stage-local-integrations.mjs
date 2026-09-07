import { cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
export async function stageLocalIntegrations(appDirectory, sourceRoot = root) {
  const app = path.resolve(appDirectory)
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
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: stage-local-integrations.mjs <staged-app>')
  await stageLocalIntegrations(process.argv[2])
}
