import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dictionaries = JSON.parse(await readFile(path.join(root, 'desktop-bridge/locales.json'), 'utf8'))
const web = Object.fromEntries(Object.entries(dictionaries).map(([locale, { native, ...copy }]) => [locale, copy]))
const native = Object.fromEntries(Object.entries(dictionaries).map(([locale, copy]) => [locale, copy.native]))
const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
for (const group of [web, native]) {
  const keys = Object.keys(group.en).sort()
  for (const [locale, copy] of Object.entries(group)) {
    assert.deepEqual(Object.keys(copy).sort(), keys, `${locale}: translation keys differ`)
    for (const key of keys) {
      assert.ok(typeof copy[key] === 'string' && copy[key].trim(), `${locale}: empty ${key}`)
      assert.deepEqual(placeholders(copy[key]), placeholders(group.en[key]), `${locale}: placeholders differ for ${key}`)
    }
  }
}
const file = path.join(root, 'desktop-bridge/lib/client.js')
const source = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
const start = source.indexOf('    const copy = ')
const end = source.indexOf('\n    function format(', start)
assert.ok(start >= 0 && end > start, 'Portable dictionary boundaries changed')
const literal = JSON.stringify(web, null, 2).replace(/\n/g, '\n    ')
const result = source.slice(0, start) + '    const copy = ' + literal + '\n' + source.slice(end)
if (process.argv.includes('--write')) await writeFile(file, result)
else assert.equal(source, result, 'Run node scripts/sync-desktop-locales.mjs --write')
const output = process.argv.indexOf('--native-output')
if (output >= 0) await writeFile(process.argv[output + 1], JSON.stringify(native))
