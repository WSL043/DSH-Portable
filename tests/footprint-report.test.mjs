import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFootprintReport } from '../scripts/report-footprint.mjs'

async function fixtureFile(root, relative, bytes) {
  const filename = path.join(root, ...relative.split('/'))
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, Buffer.alloc(bytes, 1))
}

test('footprint report ranks product sections and runtime packages deterministically', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await fixtureFile(root, 'runtime/node/node.exe', 100)
  await fixtureFile(root, 'app/node_modules/example/lib/index.js', 40)
  await fixtureFile(root, 'app/node_modules/@wsl043/dsh-portable-plugin-market/client/client.js', 20)
  await fixtureFile(root, 'app/node_modules/@wsl043/dsh-portable-plugin-market/package.json', 5)

  const report = await createFootprintReport({ root, platform: 'windows-x64' })
  assert.equal(report.total.bytes, 165)
  assert.equal(report.total.files, 4)
  assert.equal(report.total.directories, 10)
  assert.deepEqual(report.sections.map(({ name, bytes }) => ({ name, bytes })), [
    { name: 'runtime', bytes: 100 },
    { name: 'app', bytes: 65 },
  ])
  assert.deepEqual(report.packages.map(({ name, bytes }) => ({ name, bytes })), [
    { name: 'example', bytes: 40 },
    { name: '@wsl043/dsh-portable-plugin-market', bytes: 25 },
  ])
})

test('footprint budget blocks a regression and accepts a bounded product', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-budget-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/@wsl043/dsh-portable-plugin-market/lib/index.js', 10)
  const budget = path.join(root, 'budget.json')
  await writeFile(budget, JSON.stringify({
    platforms: {
      test: { extractedBytes: 10, files: 1, directories: 6, items: 7, appBytes: 10, appFiles: 1, appDirectories: 5, appItems: 6, marketBytes: 10, marketFiles: 1 },
    },
  }))

  const report = await createFootprintReport({ root: product, platform: 'test', budget })
  assert.equal(report.budget.passed, true)
  const strict = path.join(root, 'strict.json')
  await writeFile(strict, JSON.stringify({ platforms: { test: { extractedBytes: 9 } } }))
  await assert.rejects(createFootprintReport({ root: product, platform: 'test', budget: strict }), /extractedBytes=10 exceeds 9/)
})

test('every distributed platform has a bounded 0.5.0 footprint budget', async () => {
  const document = JSON.parse(await readFile(new URL('../config/footprint-budgets.json', import.meta.url), 'utf8'))
  const expected = ['windows-x64', 'macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']
  assert.deepEqual(Object.keys(document.platforms).sort(), expected.sort())
  for (const platform of expected) {
    const budget = document.platforms[platform]
    for (const metric of ['archiveBytes', 'extractedBytes', 'files', 'directories', 'items', 'marketBytes', 'marketFiles']) {
      assert.ok(Number.isSafeInteger(budget[metric]) && budget[metric] > 0, `${platform}.${metric} must be a positive integer`)
    }
  }
})
