import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { patchPortableHeroContext } from '../scripts/patch-portable-hero-context.mjs'

const upstream = `\t\t\t\t\trenderSlot("conversation.hero.agentPreset", {})\n\t\t\t\t\t"conversation.hero.agentPreset": {\n\t\t\t\t\t\tkind: "single",\n\t\t\t\t\t\tscope: "root"\n\t\t\t\t\t}`

test('Portable adds a dedicated Hero context seat after the official mode selector', () => {
  const output = patchPortableHeroContext(upstream)
  assert.match(output, /dsh-portable-hero-context-v1/)
  assert.ok(output.indexOf('conversation.hero.agentPreset') < output.indexOf('conversation.hero.portableContext'))
  assert.match(output, /"conversation\.hero\.portableContext": \{\s+kind: "list",\s+scope: "root"/)
  assert.equal(patchPortableHeroContext(output), output)
})

test('every platform build exposes the same Portable Hero context seat', async () => {
  for (const filename of ['build-windows.ps1', 'build-linux.sh', 'build-macos.sh']) {
    const source = await readFile(new URL(`../scripts/${filename}`, import.meta.url), 'utf8')
    assert.match(source, /patch-portable-hero-context\.mjs/, filename)
  }
})
