import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { descriptorV2PatchIdentity, prepareHistoricalDescriptor } from './patch-historical-descriptor.mjs'

const app = path.resolve(process.argv[2] ?? '')
if (!process.argv[3]) throw new Error('usage: verify-historical-session.mjs <staged-app> <selected-upstream-lock>')
const lockBytes = await readFile(path.resolve(process.argv[3]), 'utf8')
const lock = JSON.parse(lockBytes)
const core = JSON.parse(await readFile(path.join(app, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
assert.equal(core.version, lock.dsh.version)
assert.match(lock.dsh.reviewedCommit, /^[a-f0-9]{40}$/)
const npmIntegrity = lock.dsh.npmIntegrity ?? lock.dsh.integrity
assert.match(npmIntegrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/)
const coreProvenance = { version: core.version, reviewedCommit: lock.dsh.reviewedCommit, npmIntegrity, lockSha256: createHash('sha256').update(lockBytes).digest('hex') }
const identity = await prepareHistoricalDescriptor(app, { verifyOnly: true })
// An unpatched newer core still has to pass the same fixtures; never interpret
// 'patch not applicable' as 'historical data is compatible'.
{
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  // Outside the entire stage, not merely outside app/: shell packaging includes
  // other stage children. This directory contains generated test data only.
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-historical-acceptance-'))
  try {
  const writer = await mkdtemp(path.join(root, 'writer-'))
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    await copyFile(path.join(repo, 'experiments/descriptor-v2/writer', file), path.join(writer, file))
  }
  function run(args) {
    return execFileSync(process.execPath, args, { cwd: root, windowsHide: true, timeout: 120000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  }
  run([path.join(app, 'node_modules/pnpm/bin/pnpm.cjs'), '--dir', writer, 'install', '--frozen-lockfile', '--ignore-scripts'])
  const fixtures = path.join(root, 'fixtures')
  run([path.join(repo, 'experiments/descriptor-v2/writer-probe.mjs'), writer, app, '-', fixtures])
  const continuation = path.join(root, 'continuation')
  run([path.join(repo, 'experiments/descriptor-v2/continuation-probe.mjs'), app, fixtures, continuation])
  const result = { status: 'passed', coreProvenance, compatibilityPatch: identity.applied ? descriptorV2PatchIdentity : null,
    writer: JSON.parse(await readFile(path.join(fixtures, 'result.json'), 'utf8')),
    continuation: JSON.parse(await readFile(path.join(continuation, 'result.json'), 'utf8')) }
  console.log(JSON.stringify(result))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
