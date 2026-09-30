import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { createFootprintReport } from '../scripts/report-footprint.mjs'
import { updateFootprintBaseline } from '../scripts/update-footprint-baseline.mjs'

const execFileAsync = promisify(execFile)

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
  await assert.rejects(createFootprintReport({ root: product, platform: 'test', budget: strict }), error => {
    assert.match(error.message, /extractedBytes=10 exceeds 9/)
    assert.equal(error.report.budget.passed, false)
    assert.equal(error.report.packages[0].bytes, 10)
    return true
  })
})

test('speech runtime has a separate ceiling and cannot hide other runtime growth', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-speech-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/sherpa-onnx-win-x64/onnx.dll', 20)
  await fixtureFile(product, 'app/node_modules/sherpa-onnx-node/index.js', 5)
  const budget = path.join(root, 'budget.json')
  const check = async limits => {
    await writeFile(budget, JSON.stringify({ platforms: { test: limits } }))
    return createFootprintReport({ root: product, platform: 'test', budget })
  }
  assert.equal((await check({ speechRuntimeBytes: 20, appBytesWithoutOfficeAndSpeechRuntime: 5 })).budget.passed, true)
  await assert.rejects(check({ speechRuntimeBytes: 19 }), /speechRuntimeBytes=20 exceeds 19/)
  await assert.rejects(check({ extractedBytesWithoutOfficeAndSpeechRuntime: 4 }), /extractedBytesWithoutOfficeAndSpeechRuntime=5 exceeds 4/)
})

test('footprint budget isolates Office runtime growth and excludes the wrapper from its exemption', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-office-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'runtime/node/node.exe', 3)
  await fixtureFile(product, 'app/node_modules/@deepseek-ai/libreoffice-kit-win32-x64/bin/runtime.dll', 20)
  await fixtureFile(product, 'app/node_modules/@deepseek-ai/libreoffice-kit-wasm/index.js', 30)
  await fixtureFile(product, 'app/node_modules/@deepseek-ai/libreoffice-kit/package.json', 7)
  await fixtureFile(product, 'app/node_modules/other/index.js', 11)
  await fixtureFile(product, 'workspace/example.txt', 5)

  const budget = path.join(root, 'budget.json')
  await writeFile(budget, JSON.stringify({
    platforms: {
      test: {
        appBytes: 1000,
        extractedBytes: 1000,
        officeRuntimeBytes: 50,
        appBytesWithoutOfficeRuntime: 18,
        extractedBytesWithoutOfficeRuntime: 26,
      },
    },
  }))
  const report = await createFootprintReport({ root: product, platform: 'test', budget })
  assert.equal(report.budget.passed, true)

  const officeStrict = path.join(root, 'office-strict.json')
  await writeFile(officeStrict, JSON.stringify({ platforms: { test: { officeRuntimeBytes: 49 } } }))
  await assert.rejects(
    createFootprintReport({ root: product, platform: 'test', budget: officeStrict }),
    /officeRuntimeBytes=50 exceeds 49/,
  )
})

test('footprint budget still catches non-Office app and extracted growth at the old thresholds', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-office-boundary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'runtime/node/node.exe', 4)
  await fixtureFile(product, 'app/node_modules/@deepseek-ai/libreoffice-kit-windows-x64/bin/runtime.dll', 40)
  await fixtureFile(product, 'app/node_modules/application/index.js', 21)
  await fixtureFile(product, 'workspace/example.txt', 5)

  const appBudget = path.join(root, 'app-budget.json')
  await writeFile(appBudget, JSON.stringify({
    platforms: {
      test: {
        appBytes: 1000,
        extractedBytes: 1000,
        officeRuntimeBytes: 40,
        appBytesWithoutOfficeRuntime: 20,
        extractedBytesWithoutOfficeRuntime: 30,
      },
    },
  }))
  await assert.rejects(
    createFootprintReport({ root: product, platform: 'test', budget: appBudget }),
    /appBytesWithoutOfficeRuntime=21 exceeds 20/,
  )

  const extractedBudget = path.join(root, 'extracted-budget.json')
  await writeFile(extractedBudget, JSON.stringify({
    platforms: {
      test: {
        officeRuntimeBytes: 40,
        appBytesWithoutOfficeRuntime: 21,
        extractedBytesWithoutOfficeRuntime: 29,
      },
    },
  }))
  await assert.rejects(
    createFootprintReport({ root: product, platform: 'test', budget: extractedBudget }),
    /extractedBytesWithoutOfficeRuntime=30 exceeds 29/,
  )
})

test('footprint baseline reports added, removed, and growing sections and packages', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-baseline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const baselineRoot = path.join(root, 'baseline-product')
  const currentRoot = path.join(root, 'current-product')
  await fixtureFile(baselineRoot, 'old/old.bin', 30)
  await fixtureFile(baselineRoot, 'shared/shared.bin', 10)
  await fixtureFile(baselineRoot, 'app/node_modules/changed/index.js', 10)
  await fixtureFile(baselineRoot, 'app/node_modules/removed/index.js', 20)
  await fixtureFile(currentRoot, 'new/new.bin', 40)
  await fixtureFile(currentRoot, 'shared/shared.bin', 25)
  await fixtureFile(currentRoot, 'app/node_modules/changed/index.js', 30)
  await fixtureFile(currentRoot, 'app/node_modules/added/index.js', 5)
  const baselineArchive = path.join(root, 'baseline.zip')
  const currentArchive = path.join(root, 'current.zip')
  await writeFile(baselineArchive, Buffer.alloc(10, 1))
  await writeFile(currentArchive, Buffer.alloc(16, 1))
  const baseline = await createFootprintReport({ root: baselineRoot, platform: 'test', archive: baselineArchive })
  const baselineFile = path.join(root, 'baseline.json')
  await writeFile(baselineFile, `${JSON.stringify(baseline)}\n`)

  const report = await createFootprintReport({ root: currentRoot, platform: 'test', archive: currentArchive, baseline: baselineFile })
  assert.deepEqual(report.comparison.total, { bytes: 30, files: 0 })
  assert.equal(report.comparison.archiveBytes, 6)
  assert.deepEqual(report.comparison.sections, {
    added: [{ name: 'new', bytes: 40, files: 1 }],
    removed: [{ name: 'old', bytes: -30, files: -1 }],
    changed: [
      { name: 'shared', bytes: 15, files: 0 },
      { name: 'app', bytes: 5, files: 0 },
    ],
  })
  assert.deepEqual(report.comparison.packages, {
    added: [{ name: 'added', bytes: 5, files: 1 }],
    removed: [{ name: 'removed', bytes: -20, files: -1 }],
    changed: [{ name: 'changed', bytes: 20, files: 0 }],
  })
})

test('footprint baseline rejects mismatched metadata and malformed reports', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-baseline-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 4)
  const baseline = await createFootprintReport({ root: product, platform: 'test' })
  const baselineFile = path.join(root, 'baseline.json')
  const writeBaseline = async (value, name = 'baseline.json') => {
    const filename = path.join(root, name)
    await writeFile(filename, typeof value === 'string' ? value : JSON.stringify(value))
    return filename
  }

  const platformFile = await writeBaseline({ ...baseline, platform: 'other' }, 'platform.json')
  await assert.rejects(createFootprintReport({ root: product, platform: 'test', baseline: platformFile }), /platform mismatch/)
  const schemaFile = await writeBaseline({ ...baseline, schemaVersion: 2 }, 'schema.json')
  await assert.rejects(createFootprintReport({ root: product, platform: 'test', baseline: schemaFile }), /schema mismatch/)
  await writeFile(baselineFile, JSON.stringify({ ...baseline, packages: [{ name: 'broken', bytes: 1 }] }))
  await assert.rejects(createFootprintReport({ root: product, platform: 'test', baseline: baselineFile }), /invalid footprint baseline.*packages\[0\]\.files/)
  const jsonFile = await writeBaseline('{', 'json.json')
  await assert.rejects(createFootprintReport({ root: product, platform: 'test', baseline: jsonFile }), /invalid footprint baseline/)
})

test('unchanged footprint baseline produces zero deltas and no rows', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-baseline-unchanged-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 4)
  const baseline = await createFootprintReport({ root: product, platform: 'test' })
  const baselineFile = path.join(root, 'baseline.json')
  await writeFile(baselineFile, JSON.stringify(baseline))

  const report = await createFootprintReport({ root: product, platform: 'test', baseline: baselineFile })
  assert.deepEqual(report.comparison, {
    total: { bytes: 0, files: 0 },
    archiveBytes: null,
    sections: { added: [], removed: [], changed: [] },
    packages: { added: [], removed: [], changed: [] },
  })
})

test('relative footprint budget accepts growth through five percent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-growth-pass-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 105)
  const budget = path.join(root, 'budget.json')
  const baseline = path.join(root, 'baseline.json')
  await writeFile(budget, JSON.stringify({ platforms: { test: { extractedBytes: 1000000 } } }))
  await writeFile(baseline, JSON.stringify({ schemaVersion: 1, platforms: { test: { extractedBytes: 100 } } }))

  const report = await createFootprintReport({ root: product, platform: 'test', budget, relativeBaseline: baseline })
  assert.equal(report.budget.passed, true)
  assert.equal(report.budget.growthLimitPercent, 5)
  assert.equal(report.budget.absoluteBudgetMultiplier, 1.15)
})

test('report-footprint CLI accepts the relative-baseline option', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-cli-growth-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 105)
  const budget = path.join(root, 'budget.json')
  const baseline = path.join(root, 'baseline.json')
  await writeFile(budget, JSON.stringify({ platforms: { test: { extractedBytes: 1000000 } } }))
  await writeFile(baseline, JSON.stringify({ schemaVersion: 1, platforms: { test: { extractedBytes: 100 } } }))

  const script = fileURLToPath(new URL('../scripts/report-footprint.mjs', import.meta.url))
  const { stdout } = await execFileAsync(process.execPath, [
    script, product, '--platform', 'test', '--budget', budget, '--relative-baseline', baseline,
  ])
  assert.equal(JSON.parse(stdout).budget.passed, true)
})

test('relative footprint budget rejects growth above five percent with baseline, actual, and growth', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-growth-fail-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 106)
  const budget = path.join(root, 'budget.json')
  const baseline = path.join(root, 'baseline.json')
  await writeFile(budget, JSON.stringify({ platforms: { test: { extractedBytes: 1000000 } } }))
  await writeFile(baseline, JSON.stringify({ schemaVersion: 1, platforms: { test: { extractedBytes: 100 } } }))

  await assert.rejects(
    createFootprintReport({ root: product, platform: 'test', budget, relativeBaseline: baseline }),
    (error) => {
      assert.match(error.message, /extractedBytes: baseline=100, actual=106, growth=6\.00%/)
      return true
    },
  )

})

test('relative footprint budget rejects an accidentally bundled 50 MB file', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-growth-large-file-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 100)
  await fixtureFile(product, 'app/node_modules/example/unexpected.bin', 50 * 1024 * 1024)
  const budget = path.join(root, 'budget.json')
  const baseline = path.join(root, 'baseline.json')
  await writeFile(budget, JSON.stringify({ platforms: { test: { extractedBytes: 100000000 } } }))
  await writeFile(baseline, JSON.stringify({ schemaVersion: 1, platforms: { test: { extractedBytes: 100 } } }))

  await assert.rejects(
    createFootprintReport({ root: product, platform: 'test', budget, relativeBaseline: baseline }),
    (error) => {
      assert.match(error.message, /extractedBytes: baseline=100, actual=52428900, growth=/)
      return true
    },
  )
})

test('relative footprint budget retains its absolute guard at 115 percent of the existing budget', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-absolute-guard-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 116)
  const budget = path.join(root, 'budget.json')
  const baseline = path.join(root, 'baseline.json')
  await writeFile(budget, JSON.stringify({ platforms: { test: { extractedBytes: 100 } } }))
  await writeFile(baseline, JSON.stringify({ schemaVersion: 1, platforms: { test: { extractedBytes: 200 } } }))

  await assert.rejects(
    createFootprintReport({ root: product, platform: 'test', budget, relativeBaseline: baseline }),
    (error) => {
      assert.match(error.message, /extractedBytes: baseline=200, actual=116, growth=-42\.00%/)
      assert.match(error.message, /absolute guard=115/)
      return true
    },
  )

  await fixtureFile(product, 'app/node_modules/example/index.js', 115)
  const atAbsoluteLimit = await createFootprintReport({ root: product, platform: 'test', budget, relativeBaseline: baseline })
  assert.equal(atAbsoluteLimit.budget.passed, true)
})

test('a platform without a footprint baseline retains its exact absolute-budget behavior', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-baseline-fallback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  await fixtureFile(product, 'app/node_modules/example/index.js', 100)
  const budget = path.join(root, 'budget.json')
  const baseline = path.join(root, 'baseline.json')
  await writeFile(budget, JSON.stringify({ platforms: { test: { extractedBytes: 99 } } }))
  await writeFile(baseline, JSON.stringify({ schemaVersion: 1, platforms: { 'macos-arm64': { extractedBytes: 1 } } }))

  await assert.rejects(
    createFootprintReport({ root: product, platform: 'test', budget, relativeBaseline: baseline }),
    /extractedBytes=100 exceeds 99/,
  )
})

test('explicit baseline update writes all stable metrics and preserves other platforms', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-baseline-update-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = path.join(root, 'product')
  const archive = path.join(root, 'portable.zip')
  await fixtureFile(product, 'app/node_modules/example/index.js', 100)
  await writeFile(archive, Buffer.alloc(200, 1))
  const report = await createFootprintReport({ root: product, platform: 'windows-x64', archive })
  report.budget = { platform: 'windows-x64', passed: true }
  const reportFile = path.join(root, 'footprint-windows-x64.json')
  const baselineFile = path.join(root, 'footprint-baseline.json')
  await writeFile(reportFile, JSON.stringify(report))

  const budgets = JSON.parse(await readFile(new URL('../config/footprint-budgets.json', import.meta.url), 'utf8'))
  const macosMetrics = Object.fromEntries(Object.keys(budgets.platforms['macos-arm64']).map((key) => [key, 0]))
  await writeFile(baselineFile, JSON.stringify({ schemaVersion: 1, platforms: { 'macos-arm64': macosMetrics } }))
  await updateFootprintBaseline(reportFile, baselineFile)

  const updated = JSON.parse(await readFile(baselineFile, 'utf8'))
  assert.deepEqual(Object.keys(updated.platforms['windows-x64']).sort(), Object.keys(budgets.platforms['windows-x64']).sort())
  assert.deepEqual(updated.platforms['macos-arm64'], macosMetrics)

  report.budget.passed = false
  await writeFile(reportFile, JSON.stringify(report))
  await assert.rejects(updateFootprintBaseline(reportFile, baselineFile), /must have a passing budget result/)
})

test('relative footprint baselines match each platform absolute-budget metric set', async () => {
  const [baseline, budgets] = await Promise.all([
    readFile(new URL('../config/footprint-baseline.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../config/footprint-budgets.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  assert.ok(baseline.platforms['windows-x64'], 'Windows starts from the supplied T35 measurement')
  for (const [platform, metrics] of Object.entries(baseline.platforms)) {
    assert.ok(budgets.platforms[platform], `${platform} has an absolute guard`)
    assert.deepEqual(Object.keys(metrics).sort(), Object.keys(budgets.platforms[platform]).sort())
  }
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
