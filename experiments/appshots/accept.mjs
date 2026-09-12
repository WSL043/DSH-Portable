import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureAppshot } from './capture.mjs'

const directory = path.resolve(process.argv[2] || 'build/appshots-experiment')
const target = JSON.parse(await readFile(path.join(directory, 'fixture.json'), 'utf8'))
const started = performance.now()
let imageAt
const result = await captureAppshot(path.join(directory, 'appshot-capture.exe'), target, {
  onImage: () => { imageAt = performance.now() - started },
})
await writeFile(path.join(directory, 'capture.png'), Buffer.from(result.image.dataUrl.split(',')[1], 'base64'))
await writeFile(path.join(directory, 'capture-text.txt'), result.text)
const evidence = { imageAtMs: Math.round(imageAt), totalMs: Math.round(performance.now() - started),
  width: result.image.width, height: result.image.height, textPartial: result.textPartial,
  visibleText: result.text.includes('Visible acceptance text'), offscreenText: result.text.includes('OFFSCREEN_TEXT_SENTINEL'),
  passwordExcluded: !result.text.includes('PASSWORD_MUST_NOT_APPEAR'), warning: result.warning }
await writeFile(path.join(directory, 'result.json'), JSON.stringify(evidence, null, 2))
assert.ok(evidence.width > 500 && evidence.height > 300)
assert.ok(evidence.visibleText, 'Visible application text missing')
assert.ok(evidence.offscreenText, 'Offscreen text missing')
assert.ok(evidence.passwordExcluded, 'Password leaked into accessibility text')
await assert.rejects(captureAppshot(path.join(directory, 'appshot-capture.exe'), { ...target, pid: target.pid + 1 }), /Window/)
console.log(JSON.stringify(evidence))
