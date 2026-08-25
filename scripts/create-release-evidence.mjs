import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [assetsArg, runArg, jobsArg, outputArg, repository, expectedCommit, tag] = process.argv.slice(2)
if (!assetsArg || !runArg || !jobsArg || !outputArg || !repository || !expectedCommit || !tag) {
  throw new Error('usage: node create-release-evidence.mjs <user-assets> <run.json> <jobs.json> <output.json> <owner/repository> <commit> <tag>')
}
if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error('repository must use owner/name form')
if (!/^[a-f0-9]{40}$/.test(expectedCommit)) throw new Error('expected commit must be a full lowercase SHA-1')
if (!/^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(tag)) throw new Error('tag must be a stable or release-candidate version')

const assets = path.resolve(assetsArg)
const run = JSON.parse(await readFile(path.resolve(runArg), 'utf8'))
const jobResponse = JSON.parse(await readFile(path.resolve(jobsArg), 'utf8'))

if (run?.conclusion !== 'success') throw new Error('qualification workflow did not succeed')
if (run?.head_branch !== 'main') throw new Error('qualification workflow must run on main')
if (run?.head_sha !== expectedCommit) throw new Error('qualification workflow commit does not match the release commit')
if (run?.name !== 'Build and smoke test') throw new Error('unexpected qualification workflow')
if (!['push', 'workflow_dispatch'].includes(run?.event)) throw new Error('qualification workflow must be a main push or manual main run')
if (!Number.isSafeInteger(run?.id) || run.id <= 0) throw new Error('qualification workflow is missing its run ID')
if (run?.html_url !== `https://github.com/${repository}/actions/runs/${run.id}`) {
  throw new Error('qualification workflow URL does not belong to the release repository')
}

if (!Array.isArray(jobResponse?.jobs) || jobResponse.jobs.length === 0) throw new Error('qualification jobs are missing')
if (jobResponse?.total_count !== jobResponse.jobs.length) throw new Error('qualification job response is incomplete')
const seenJobs = new Set()
const jobs = jobResponse.jobs.map((job) => {
  const name = typeof job?.name === 'string' ? job.name.trim() : ''
  if (!name || seenJobs.has(name)) throw new Error('qualification job names must be present and unique')
  seenJobs.add(name)
  if (job?.conclusion !== 'success') throw new Error(`qualification job did not succeed: ${name}`)
  return { name, conclusion: 'success' }
}).sort((a, b) => a.name.localeCompare(b.name, 'en'))

const checksumPath = path.join(assets, 'checksums.txt')
const checksumLines = (await readFile(checksumPath, 'ascii')).trim().split(/\r?\n/)
const checksumByName = new Map()
for (const line of checksumLines) {
  const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line)
  if (match === null || checksumByName.has(match[2]) || match[2] === 'checksums.txt' || match[2] === 'release-evidence.json') {
    throw new Error('checksums.txt contains an invalid or duplicate release subject')
  }
  checksumByName.set(match[2], match[1])
}
const present = (await readdir(assets)).filter(name => name !== 'checksums.txt').sort()
if (present.length !== checksumByName.size || present.some(name => !checksumByName.has(name))) {
  throw new Error('checksums.txt does not describe exactly the curated user assets')
}
const subjects = []
for (const name of present) {
  const filename = path.join(assets, name)
  const info = await stat(filename)
  if (!info.isFile() || info.size === 0) throw new Error(`release subject is missing or empty: ${name}`)
  const bytes = await readFile(filename)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (checksumByName.get(name) !== digest) throw new Error(`release subject digest does not match checksums.txt: ${name}`)
  subjects.push({ name, bytes: info.size, sha256: digest })
}

const manifest = JSON.parse(await readFile(path.join(assets, 'portable-manifest.json'), 'utf8'))
const version = tag.slice(1)
const channel = tag.includes('-rc.') ? 'candidate' : 'stable'
if (manifest?.version !== version || manifest?.releaseChannel !== channel) {
  throw new Error('portable-manifest.json does not match the requested release tag and channel')
}

const evidence = {
  result: 'PASSED',
  configuration: [{
    name: `${repository}@${expectedCommit}`,
    downloadLocation: `https://github.com/${repository}/tree/${expectedCommit}`,
    digest: { gitCommit: expectedCommit },
    mediaType: 'application/vnd.git.commit',
  }],
  url: run.html_url,
  passedTests: jobs.map(job => job.name),
  warnedTests: [],
  failedTests: [],
}
const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`)
await writeFile(path.resolve(outputArg), evidenceBytes)

console.log(JSON.stringify({ product: 'DSH-Portable', version, channel, subjects: subjects.length, jobs: jobs.length, runId: run.id }))
