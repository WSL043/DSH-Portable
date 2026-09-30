import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { footprintMetrics } from './report-footprint.mjs'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASELINE = path.join(PROJECT_ROOT, 'config', 'footprint-baseline.json')
const STABLE_BUDGET = path.join(PROJECT_ROOT, 'config', 'footprint-budgets.json')

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readExistingBaseline(filename) {
  try {
    const document = JSON.parse(await readFile(filename, 'utf8'))
    if (!isRecord(document) || document.schemaVersion !== 1 || !isRecord(document.platforms)) {
      throw new Error('expected schemaVersion 1 and a platforms object')
    }
    for (const [platform, metrics] of Object.entries(document.platforms)) {
      if (!isRecord(metrics)) throw new Error(`${platform} must be an object`)
      for (const [key, value] of Object.entries(metrics)) {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${platform}.${key} must be a non-negative safe integer`)
      }
    }
    return document
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, platforms: {} }
    throw new Error(`invalid footprint baseline ${filename}: ${error.message}`, { cause: error })
  }
}

export async function updateFootprintBaseline(reportFilename, baselineFilename = DEFAULT_BASELINE) {
  const reportPath = path.resolve(reportFilename)
  let report
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read footprint report ${reportPath}: ${error.message}`, { cause: error })
  }
  const metrics = footprintMetrics(report)
  if (report.budget?.platform !== report.platform || report.budget?.passed !== true) {
    throw new Error(`refusing to update ${report.platform} baseline: the footprint report must have a passing budget result`)
  }

  const budgetDocument = JSON.parse(await readFile(STABLE_BUDGET, 'utf8'))
  const budget = budgetDocument.platforms?.[report.platform]
  if (!isRecord(budget)) throw new Error(`stable footprint budget has no platform entry: ${report.platform}`)
  const nextMetrics = {}
  for (const key of Object.keys(budget)) {
    const value = metrics[key]
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`footprint report has no valid ${key} metric for ${report.platform}`)
    nextMetrics[key] = value
  }

  const destination = path.resolve(baselineFilename)
  const document = await readExistingBaseline(destination)
  document.platforms[report.platform] = nextMetrics
  const serialized = `${JSON.stringify(document, null, 2)}\n`
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, serialized, { flag: 'wx' })
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  return { platform: report.platform, baselineFile: destination, metrics: Object.keys(nextMetrics) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const reportFilename = process.argv[2]
  if (process.argv.length !== 3 || !reportFilename) {
    throw new Error('usage: node scripts/update-footprint-baseline.mjs <footprint.json>')
  }
  process.stdout.write(`${JSON.stringify(await updateFootprintBaseline(reportFilename))}\n`)
}
