import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const repo = fileURLToPath(new URL('../', import.meta.url))
const source = join(repo, 'app/vendor/dsh-portable-plugin-market')
const output = resolve(repo, process.argv[2] ?? 'build/official-market-plugin')
await mkdir(output, { recursive: true })
const tool = join(source, 'node_modules/tsdown/dist/run.mjs')
for (const config of ['tsdown.server.config.ts', 'tsdown.config.ts']) {
  execFileSync(process.execPath, [tool, '--config', config], { cwd: source, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, DSH_MARKET_TARGET: 'official', DSH_MARKET_OUTPUT: output } })
}
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
manifest.version = '0.2.0-alpha.1'
manifest.description = 'Browse community plugins with screenshots, search and download totals; official DSH owns installation and activation.'
manifest.dependencies = {}
manifest.peerDependencies = { '@deepseek-ai/cordis': '^4.0.3' }
delete manifest.peerDependenciesMeta
delete manifest.devDependencies
delete manifest.scripts
manifest.dsh.client.inject = ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-plugin-manager', '@deepseek-ai/dsh-client-ui-primitives']
await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
for (const file of ['cordis.patch.yml', 'LICENSE', 'NOTICE.md']) await copyFile(join(source, file), join(output, file))
console.log(`Official-host market plugin: ${output}`)
