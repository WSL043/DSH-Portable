import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/create-release-evidence.mjs', import.meta.url))
const commit = '4585624c27fea1c67503523b87d90eb9aaf71cfc'

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-release-evidence-'))
  const assets = path.join(root, 'user-assets')
  await mkdir(assets)
  const payloads = {
    'DSH-Portable-windows-x64-offline.zip': Buffer.from('windows'),
    'DSH-Portable-linux-x64.tar.gz': Buffer.from('linux'),
    'portable-manifest.json': Buffer.from(JSON.stringify({
      schemaVersion: 1,
      version: overrides.version ?? '0.4.14',
      releaseChannel: overrides.releaseChannel ?? 'stable',
      payloads: {},
    })),
  }
  const checksums = []
  for (const [name, bytes] of Object.entries(payloads)) {
    await writeFile(path.join(assets, name), bytes)
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
  }
  await writeFile(path.join(assets, 'checksums.txt'), `${checksums.join('\n')}\n`, 'ascii')
  const run = {
    id: 32818204437,
    name: 'Build and smoke test',
    event: 'push',
    head_branch: 'main',
    head_sha: commit,
    conclusion: 'success',
    html_url: 'https://github.com/WSL043/DSH-Portable/actions/runs/32818204437',
    ...overrides.run,
  }
  const jobs = {
    total_count: 3,
    jobs: [
      { name: 'Windows movable ZIP', conclusion: 'success' },
      { name: 'macOS portable (arm64)', conclusion: 'success' },
      { name: 'Linux movable package and component update (x64)', conclusion: 'success' },
    ],
    ...overrides.jobs,
  }
  const runFile = path.join(root, 'run.json')
  const jobsFile = path.join(root, 'jobs.json')
  const evidenceFile = path.join(root, 'release-qualification.json')
  await writeFile(runFile, JSON.stringify(run))
  await writeFile(jobsFile, JSON.stringify(jobs))
  return { root, assets, runFile, jobsFile, evidenceFile }
}

async function generate(value, tag = 'v0.4.14') {
  return execFileAsync(process.execPath, [
    script,
    value.assets,
    value.runFile,
    value.jobsFile,
    value.evidenceFile,
    'WSL043/DSH-Portable',
    commit,
    tag,
  ])
}

test('release evidence binds curated downloads to the exact successful main qualification run', async () => {
  const value = await fixture()
  try {
    await generate(value)
    const evidence = JSON.parse(await readFile(value.evidenceFile, 'utf8'))
    assert.deepEqual(evidence, {
      result: 'PASSED',
      configuration: [{
        name: `WSL043/DSH-Portable@${commit}`,
        downloadLocation: `https://github.com/WSL043/DSH-Portable/tree/${commit}`,
        digest: { gitCommit: commit },
        mediaType: 'application/vnd.git.commit',
      }],
      url: 'https://github.com/WSL043/DSH-Portable/actions/runs/32818204437',
      passedTests: [
        'Linux movable package and component update (x64)',
        'macOS portable (arm64)',
        'Windows movable ZIP',
      ],
      warnedTests: [],
      failedTests: [],
    })
    const checksums = await readFile(path.join(value.assets, 'checksums.txt'), 'ascii')
    assert.doesNotMatch(checksums, /release-(?:evidence|qualification)\.json/)
    assert.equal(checksums.trim().split(/\r?\n/).length, 3)
    assert.doesNotMatch(JSON.stringify(evidence), /[A-Z]:\\|\/home\/|runner\.temp|token|credential/i)
  } finally {
    await rm(value.root, { recursive: true, force: true })
  }
})

test('release evidence accepts conventional alpha and beta tags as candidate releases', async () => {
  for (const tag of ['v0.6.0-alpha.1', 'v0.6.0-beta.2']) {
    const value = await fixture({ version: tag.slice(1), releaseChannel: 'candidate' })
    try {
      const { stdout } = await generate(value, tag)
      assert.equal(JSON.parse(stdout).channel, 'candidate')
    } finally {
      await rm(value.root, { recursive: true, force: true })
    }
  }
})

test('release evidence rejects malformed conventional prerelease tags', async () => {
  for (const tag of ['v0.6.0-alpha.0', 'v0.6.0-beta', 'v0.6.0-preview.1']) {
    const value = await fixture({ version: tag.slice(1), releaseChannel: 'candidate' })
    try {
      await assert.rejects(generate(value, tag))
    } finally {
      await rm(value.root, { recursive: true, force: true })
    }
  }
})

test('release evidence refuses incomplete, failed, or mismatched qualification runs', async () => {
  for (const overrides of [
    { run: { conclusion: 'failure' } },
    { run: { head_sha: '0'.repeat(40) } },
    { run: { head_branch: 'feature/not-main' } },
    { jobs: { jobs: [{ name: 'Windows movable ZIP', conclusion: 'failure' }], total_count: 1 } },
    { jobs: { total_count: 4 } },
  ]) {
    const value = await fixture(overrides)
    try {
      await assert.rejects(generate(value))
    } finally {
      await rm(value.root, { recursive: true, force: true })
    }
  }
})


test('release evidence preserves both legacy split and consolidated macOS qualification identities', async () => {
  const commonNames = ['Product qualification', ...Array.from({ length: 30 }, (_, i) => 'Non-macOS product gate ' + i)]
  const legacyMacNames = ['Build macOS', 'macOS portable', 'macOS native desktop identity and lifecycle', 'macOS plugin portability']
    .flatMap(name => ['arm64', 'x64'].map(arch => name + ' (' + arch + ')'))
  const combinedMacNames = ['arm64', 'x64'].map(arch => 'Build and qualify macOS (' + arch + ')')
  for (const macNames of [legacyMacNames, combinedMacNames]) {
    const names = [...commonNames, ...macNames]
    const jobs = names.map(name => ({ name, conclusion: 'success' }))
    const value = await fixture({ jobs: { total_count: jobs.length, jobs } })
    try {
      const { stdout } = await generate(value)
      const evidence = JSON.parse(await readFile(value.evidenceFile, 'utf8'))
      assert.equal(JSON.parse(stdout).jobs, names.length)
      assert.deepEqual(evidence.passedTests, names.sort((a, b) => a.localeCompare(b, 'en')))
      assert.equal(evidence.configuration[0].digest.gitCommit, commit)
      // A skipped combined gate cannot become a passing release record.
      jobs.at(-1).conclusion = 'skipped'
      await writeFile(value.jobsFile, JSON.stringify({ total_count: jobs.length, jobs }))
      await assert.rejects(generate(value), /qualification job did not succeed/)
    } finally {
      await rm(value.root, { recursive: true, force: true })
    }
  }
})
