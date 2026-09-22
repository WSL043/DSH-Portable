import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../app/vendor/dsh-portable-plugin-market/src/client/primitives.ts', import.meta.url), 'utf8')
const mappings = [...source.matchAll(/export const (\w+) = host\.(\w+) \?\? host\.(\w+)/g)]
for (const modern of [false, true]) {
  test(`market icon compatibility resolves ${modern ? 'regular artwork' : 'sized artwork'} without modifying host exports`, () => {
    const host = Object.freeze(Object.fromEntries(mappings.map(([, old, current]) => [modern ? current : old, () => {}])))
    const script = source.replace(/^import .*$/gm, '').replace(/^export \* .*$/gm, '').replaceAll('export const ', 'const ')
    const context = { host }
    vm.runInNewContext(`${script}\nthis.icons = { ${mappings.map(m => m[1]).join(',')} }`, context)
    for (const [, old, current] of mappings) assert.equal(context.icons[old], host[modern ? current : old])
  })
}
