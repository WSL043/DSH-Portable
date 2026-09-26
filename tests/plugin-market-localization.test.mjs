import assert from 'node:assert/strict'
import test from 'node:test'
import { localizedText, categoryText, safeScreenshots } from '../app/vendor/dsh-portable-plugin-market/src/client/market-data.ts'
import { en, zh } from '../app/vendor/dsh-portable-plugin-market/src/client/locales.ts'

test('catalog language follows the host and preserves missing translations', () => {
  assert.equal(localizedText({zh:'中文介绍',en:'English description'}, 'zh-CN'), '中文介绍')
  assert.equal(localizedText({zh:'中文介绍',en:'English description'}, 'en-US'), 'English description')
  assert.equal(localizedText({zh:'中文介绍',en:'  '}, 'en'), '中文介绍')
  assert.equal(localizedText({en:'English description'}, 'zh'), 'English description')
  assert.equal(localizedText(undefined, 'en'), '')
  assert.equal(categoryText(['ui','tools'], {ui:{zh:'界面',en:'UI'},tools:{zh:'工具',en:'Tools'}}, 'zh'), '界面 · 工具')
  assert.equal(categoryText(['ui','tools'], {ui:{zh:'界面',en:'UI'},tools:{zh:'工具',en:'Tools'}}, 'en'), 'UI / Tools')
})
test('all market UI labels have both language variants and matching placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const key of Object.keys(zh)) {
    assert.equal(Boolean(en[key].trim()), Boolean(zh[key].trim()), key)
    assert.deepEqual(en[key].match(/\{\d+\}/g)?.sort() || [], zh[key].match(/\{\d+\}/g)?.sort() || [], key)
  }
})
test('card images retain screenshot origin, deduplication and count boundaries', () => {
  const good='https://raw.githubusercontent.com/owner/repo/main/screen.png'
  assert.deepEqual(safeScreenshots([good,good,'https://evil.example/image.png','http://github.com/image.png','https://github.com/logo.svg']), [good])
  assert.equal(safeScreenshots(Array.from({length:30}, (_,i)=>good+'?n='+i)).length,6)
})
