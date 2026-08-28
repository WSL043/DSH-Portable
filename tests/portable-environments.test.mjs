import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  DEFAULT_ENVIRONMENT_ID,
  acquireProductMutationLock,
  environmentStateRoot,
  findRunningPortableEnvironments,
  layoutForRoot,
  listEnvironmentLayouts,
  normalizeEnvironmentId,
  parseCli,
} from '../launcher/portable-core.mjs'

test('the legacy Portable data root remains the default environment without migration', () => {
  const root = 'C:\\Portable\\DSH-Portable'
  assert.equal(DEFAULT_ENVIRONMENT_ID, 'default')
  assert.equal(environmentStateRoot(root, undefined, 'win32'), path.win32.resolve(root))
  assert.equal(environmentStateRoot(root, 'default', 'win32'), path.win32.resolve(root))

  const layout = layoutForRoot(root, 'win32', environmentStateRoot(root, 'default', 'win32'), root, 'default')
  assert.equal(layout.environmentId, 'default')
  assert.equal(layout.baseStateRoot, path.win32.resolve(root))
  assert.equal(layout.dataDir, path.win32.join(root, 'data'))
  assert.equal(layout.workspace, path.win32.join(root, 'workspace'))
})

test('named environments share the product root while isolating every mutable path', () => {
  const root = 'C:\\Portable\\DSH-Portable'
  const researchRoot = environmentStateRoot(root, 'research', 'win32')
  const personalRoot = environmentStateRoot(root, 'personal', 'win32')
  const research = layoutForRoot(root, 'win32', researchRoot, root, 'research')
  const personal = layoutForRoot(root, 'win32', personalRoot, root, 'personal')

  assert.equal(researchRoot, path.win32.join(root, 'environments', 'research'))
  assert.equal(research.baseStateRoot, path.win32.resolve(root))
  assert.equal(research.appDir, personal.appDir)
  assert.equal(research.runtimeDir, personal.runtimeDir)
  assert.notEqual(research.dataDir, personal.dataDir)
  assert.notEqual(research.workspace, personal.workspace)
  assert.notEqual(research.processState, personal.processState)
  assert.notEqual(research.browserProfile, personal.browserProfile)
  assert.equal(research.productStateDir, personal.productStateDir)
  assert.equal(research.updateJournal, personal.updateJournal)
  assert.equal(research.productUpdateCheckCache, personal.productUpdateCheckCache)
  assert.equal(research.engineUpdateCheckCache, personal.engineUpdateCheckCache)
  assert.equal(research.productOperationLock, personal.productOperationLock)
})

test('the environment registry enumerates only bounded environment directories', async (t) => {
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises')
  const os = await import('node:os')
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-environment-layouts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'environments', 'research'), { recursive: true })
  await mkdir(path.join(root, 'environments', 'personal'), { recursive: true })
  await mkdir(path.join(root, 'environments', 'name with spaces'), { recursive: true })

  const current = layoutForRoot(root, process.platform, root, root, 'default')
  const layouts = await listEnvironmentLayouts(current)
  assert.deepEqual(layouts.map((item) => item.environmentId), ['default', 'personal', 'research'])
})

test('shared product mutation sees every live environment and uses one exclusive lock', async (t) => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises')
  const os = await import('node:os')
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-environment-running-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const current = layoutForRoot(root, process.platform, root, root, 'default')
  const research = layoutForRoot(
    root,
    process.platform,
    environmentStateRoot(root, 'research', process.platform),
    root,
    'research',
  )
  await mkdir(path.dirname(current.processState), { recursive: true })
  await mkdir(path.dirname(research.processState), { recursive: true })
  await writeFile(current.processState, JSON.stringify({ pid: 41001, port: 3080 }))
  await writeFile(research.processState, JSON.stringify({ pid: 41002, port: 3081 }))

  const running = await findRunningPortableEnvironments(current, {
    processQuery(pid) {
      if (pid === 41001) return { executablePath: current.nodeExe, commandLine: `\"${current.nodeExe}\" \"${current.hostBin}\" \"${current.dshBin}\" --port 3080` }
      if (pid === 41002) return { executablePath: research.nodeExe, commandLine: `\"${research.nodeExe}\" \"${research.hostBin}\" \"${research.dshBin}\" --port 3081` }
      return null
    },
  })
  assert.deepEqual(running.map((item) => item.environmentId), ['default', 'research'])

  const release = await acquireProductMutationLock(current, {
    processQuery: () => null,
    pidExists: () => false,
  })
  await assert.rejects(
    acquireProductMutationLock(research, {
      processQuery: () => ({
        executablePath: research.nodeExe,
        commandLine: `\"${research.nodeExe}\" \"${research.portableCli}\" update`,
      }),
      pidExists: () => true,
    }),
    /shared Portable components are being changed/i,
  )
  await release()
})

test('environment identifiers are bounded slugs and cannot escape the product root', () => {
  assert.equal(normalizeEnvironmentId(' Research-01 '), 'research-01')
  for (const value of ['', '.', '..', '../other', 'a/b', 'a\\b', 'CON', 'name with spaces']) {
    assert.throws(() => normalizeEnvironmentId(value), /environment/i)
  }
})

test('Portable commands accept an explicit environment without changing the default contract', () => {
  assert.equal(parseCli([]).environment, undefined)
  assert.equal(parseCli(['start', '--environment', 'research']).environment, 'research')
  assert.equal(parseCli(['--environment', 'research', 'status', '--json']).environment, 'research')
  assert.throws(() => parseCli(['start', '--environment']), /requires a value/)
  assert.throws(() => parseCli(['start', '--environment', '../escape']), /environment/i)
})

test('the Windows host keys state and single-instance signaling by environment', async () => {
  const host = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  assert.match(host, /ResolveEnvironmentId/)
  assert.match(host, /ResolveStateRoot/)
  assert.match(host, /RegisterWindowMessage/)
  assert.match(host, /RegisterEnvironmentExitMessage/)
  assert.match(host, /desktop-host\.pid/)
  assert.match(host, /Path\.Combine\(stateRoot, "data", "runtime"/)
  assert.match(host, /Mutex/)
  assert.match(host, /--environment/)
  assert.match(host, /dsh-portable\/open-environment/)
  assert.match(host, /dsh-portable\/open-environment-result/)
  assert.match(host, /StartDetachedProcess\(Application\.ExecutablePath/)
  assert.match(host, /OtherRunningEnvironmentHosts/)
})
