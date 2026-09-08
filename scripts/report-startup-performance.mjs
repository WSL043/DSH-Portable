import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const METRICS = ['importDurationMs', 'capsuleDurationMs', 'interactiveElapsedMs', 'maxHeartbeatAgeMs']
const GROUP_NAMES = ['prepared-new-runtime', 'reused-runtime', 'unknown']

function emptyStats() {
  return { count: 0, median: null, p95: null, max: null }
}

function emptyGroup() {
  return {
    runs: 0,
    failed: 0,
    readiness: 0,
    notRecorded: Object.fromEntries(METRICS.map(metric => [metric, 0])),
    stats: Object.fromEntries(METRICS.map(metric => [metric, emptyStats()])),
  }
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function summarizeValues(values) {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) return emptyStats()
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
  return { count: sorted.length, median, p95, max: sorted[sorted.length - 1] }
}

function groupName(value) {
  if (value === false) return 'prepared-new-runtime'
  if (value === true) return 'reused-runtime'
  return 'unknown'
}

export function summarizeStartupPerformance(report) {
  const groups = Object.fromEntries(GROUP_NAMES.map(name => [name, emptyGroup()]))
  const values = Object.fromEntries(GROUP_NAMES.map(name => [name,
    Object.fromEntries(METRICS.map(metric => [metric, []]))]))
  const runs = Array.isArray(report?.startupHistory?.runs) ? report.startupHistory.runs : []
  for (const run of runs) {
    const source = run?.summary && typeof run.summary === 'object' && !Array.isArray(run.summary) ? run.summary : {}
    const name = groupName(source.capsuleReused)
    const group = groups[name]
    group.runs += 1
    if (source.failureObserved === true) group.failed += 1
    if (source.readinessObserved === true) group.readiness += 1
    for (const metric of METRICS) {
      if (isNumber(source[metric])) values[name][metric].push(source[metric])
      else group.notRecorded[metric] += 1
    }
  }
  for (const name of GROUP_NAMES) {
    for (const metric of METRICS) groups[name].stats[metric] = summarizeValues(values[name][metric])
  }
  return {
    scope: 'sample-based diagnostic summaries; not a benchmark or OS-cold-start measurement',
    groups,
  }
}

function parseArgs(argv) {
  let input = ''
  let output = ''
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') {
      output = argv[++index]
      if (!output || output.startsWith('--')) throw new Error('missing value for --output')
    } else if (value.startsWith('--')) {
      throw new Error(`unknown option: ${value}`)
    } else if (input === '') {
      input = value
    } else {
      throw new Error(`unexpected argument: ${value}`)
    }
  }
  if (input === '') throw new Error('usage: node report-startup-performance.mjs <support.json> [--output <file>]')
  return { input, output }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs(process.argv.slice(2))
  const report = JSON.parse(await readFile(path.resolve(options.input), 'utf8'))
  const serialized = `${JSON.stringify(summarizeStartupPerformance(report), null, 2)}\n`
  if (options.output) await writeFile(path.resolve(options.output), serialized, 'utf8')
  process.stdout.write(serialized)
}
