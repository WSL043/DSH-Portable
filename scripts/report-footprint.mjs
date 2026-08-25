import { lstat, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const result = { root: '', archive: '', platform: '', budget: '', output: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--') && result.root === '') {
      result.root = value
      continue
    }
    const key = value.slice(2)
    if (!Object.hasOwn(result, key)) throw new Error(`unknown option: ${value}`)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) throw new Error(`missing value for ${value}`)
    result[key] = next
    index += 1
  }
  if (result.root === '') {
    throw new Error('usage: node report-footprint.mjs <product-root> --platform <id> [--archive <file>] [--budget <file>] [--output <file>]')
  }
  return result
}

function addTotals(target, source) {
  target.bytes += source.bytes
  target.files += source.files
  target.directories += source.directories
  target.links += source.links
}

async function treeStats(root) {
  const info = await lstat(root)
  if (info.isSymbolicLink()) return { bytes: 0, files: 0, directories: 0, links: 1 }
  if (!info.isDirectory()) return { bytes: info.size, files: 1, directories: 0, links: 0 }
  const totals = { bytes: 0, files: 0, directories: 1, links: 0 }
  for (const entry of await readdir(root)) addTotals(totals, await treeStats(path.join(root, entry)))
  return totals
}

async function childBreakdown(root) {
  const rows = []
  for (const name of await readdir(root)) rows.push({ name, ...await treeStats(path.join(root, name)) })
  return rows.sort((left, right) => right.bytes - left.bytes || right.files - left.files || left.name.localeCompare(right.name))
}

async function packageRoots(nodeModules) {
  const roots = []
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const first = path.join(nodeModules, entry.name)
    if (!entry.name.startsWith('@')) {
      roots.push({ name: entry.name, root: first })
      continue
    }
    for (const child of await readdir(first, { withFileTypes: true })) {
      if (child.isDirectory()) roots.push({ name: `${entry.name}/${child.name}`, root: path.join(first, child.name) })
    }
  }
  return roots
}

async function packageBreakdown(nodeModules) {
  const rows = []
  for (const item of await packageRoots(nodeModules)) rows.push({ name: item.name, ...await treeStats(item.root) })
  return rows.sort((left, right) => right.bytes - left.bytes || right.files - left.files || left.name.localeCompare(right.name))
}

function metric(report, key) {
  const values = {
    archiveBytes: report.archiveBytes,
    extractedBytes: report.total.bytes,
    files: report.total.files,
    directories: report.total.directories,
    items: report.total.files + report.total.directories + report.total.links,
    appBytes: report.sections.find((item) => item.name === 'app')?.bytes ?? 0,
    appFiles: report.sections.find((item) => item.name === 'app')?.files ?? 0,
    appDirectories: report.sections.find((item) => item.name === 'app')?.directories ?? 0,
    appItems: (() => {
      const app = report.sections.find((item) => item.name === 'app')
      return app ? app.files + app.directories + app.links : 0
    })(),
    marketBytes: report.packages.find((item) => item.name === '@wsl043/dsh-portable-plugin-market')?.bytes ?? 0,
    marketFiles: report.packages.find((item) => item.name === '@wsl043/dsh-portable-plugin-market')?.files ?? 0,
  }
  return values[key]
}

async function verifyBudget(report, filename, platform) {
  const document = JSON.parse(await readFile(filename, 'utf8'))
  const budget = document.platforms?.[platform]
  if (!budget) throw new Error(`footprint budget has no platform entry: ${platform}`)
  const failures = []
  for (const [key, maximum] of Object.entries(budget)) {
    const actual = metric(report, key)
    if (!Number.isFinite(actual)) throw new Error(`unsupported footprint budget metric: ${key}`)
    if (!Number.isFinite(maximum) || maximum < 0) throw new Error(`invalid footprint budget for ${key}`)
    if (actual > maximum) failures.push(`${key}=${actual} exceeds ${maximum}`)
  }
  report.budget = { file: path.resolve(filename), platform, passed: failures.length === 0, failures }
  if (failures.length > 0) throw new Error(`footprint budget failed: ${failures.join('; ')}`)
}

export async function createFootprintReport(options) {
  const root = path.resolve(options.root)
  const report = {
    schemaVersion: 1,
    platform: options.platform || process.platform,
    total: await treeStats(root),
    archiveBytes: options.archive ? (await stat(path.resolve(options.archive))).size : null,
    sections: await childBreakdown(root),
    packages: await packageBreakdown(path.join(root, 'app', 'node_modules')),
  }
  if (options.budget) await verifyBudget(report, path.resolve(options.budget), report.platform)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs(process.argv.slice(2))
  const report = await createFootprintReport(options)
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) {
    await writeFile(path.resolve(options.output), serialized, 'utf8')
    process.stdout.write(`${JSON.stringify({
      platform: report.platform,
      archiveBytes: report.archiveBytes,
      extractedBytes: report.total.bytes,
      files: report.total.files,
      directories: report.total.directories,
      items: report.total.files + report.total.directories + report.total.links,
      marketBytes: report.packages.find((item) => item.name === '@wsl043/dsh-portable-plugin-market')?.bytes ?? 0,
      marketFiles: report.packages.find((item) => item.name === '@wsl043/dsh-portable-plugin-market')?.files ?? 0,
      budgetPassed: report.budget?.passed ?? null,
      output: path.resolve(options.output),
    })}\n`)
  } else {
    process.stdout.write(serialized)
  }
}
