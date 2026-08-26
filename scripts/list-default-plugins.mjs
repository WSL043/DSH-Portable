import { readFileSync } from 'node:fs'

const lock = JSON.parse(readFileSync(process.argv[2], 'utf8'))
for (const plugin of Object.values(lock.defaultPlugins ?? {})) {
  process.stdout.write([
    plugin.package,
    plugin.version,
    plugin.filename,
    plugin.url,
    plugin.sha256,
  ].join('\t') + '\n')
}
