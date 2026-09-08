import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { compareFootprintReports } from './report-footprint.mjs'

const exec = promisify(execFile)
const [filename] = process.argv.slice(2)
if (!filename) throw new Error('usage: node compare-ci-footprint.mjs <footprint-report.json>')
const current = JSON.parse(await readFile(filename, 'utf8'))
const repository = process.env.GITHUB_REPOSITORY
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('GITHUB_REPOSITORY is required')
const api = async endpoint => JSON.parse((await exec('gh', ['api', endpoint], {
  windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
})).stdout)
const runs = await api(`repos/${repository}/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=5`)
let baselineRun
for (const run of runs.workflow_runs || []) {
  if (String(run.id) === process.env.GITHUB_RUN_ID) continue
  const artifacts = await api(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`)
  if (artifacts.artifacts?.some(artifact => artifact.name === `footprint-${current.platform}` && !artifact.expired)) {
    baselineRun = run
    break
  }
}
let result = { status: 'baseline-unavailable', platform: current.platform,
  reason: 'No retained footprint snapshot in the last five successful main builds.' }
if (baselineRun) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-footprint-baseline-'))
  await exec('gh', ['run', 'download', String(baselineRun.id), '--repo', repository,
    '--name', `footprint-${current.platform}`, '--dir', directory], { windowsHide: true, timeout: 60000 })
  const baseline = JSON.parse(await readFile(path.join(directory, path.basename(filename)), 'utf8'))
  result = { status: 'compared', platform: current.platform, baselineRun: baselineRun.id,
    baselineCommit: baselineRun.head_sha, comparison: compareFootprintReports(current, baseline) }
}
await writeFile(filename.replace(/\.json$/, '-comparison.json'), `${JSON.stringify(result, null, 2)}\n`)
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `\n### Package footprint: ${current.platform}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`)
}
console.log(JSON.stringify(result))
