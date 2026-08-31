import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { buildDshEnv, layoutForRoot } from './portable-core.mjs'
import { acquireRuntimeLease, cleanUnusedRuntimeCaches, ensureRuntimeCapsule } from './runtime-capsule.mjs'

const execFileAsync = promisify(execFile)
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PROFILE_PREFLIGHT_TIMEOUT_MS = 30000

export async function discoverExistingDshProfiles(layout) {
  const profilesRoot = path.join(layout.dshHome, 'profiles')
  let entries
  try {
    entries = await readdir(profilesRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory()
      && entry.name !== 'node_modules'
      && PROFILE_NAME.test(entry.name)
      && existsSync(path.join(profilesRoot, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function preflightFailure(profile, error) {
  const detail = String(error?.stderr || error?.message || error || 'unknown error').trim().slice(-2000)
  const failure = new Error(
    `The target DSH update cannot compose existing profile "${profile}"${detail ? `: ${detail}` : '.'}`,
    { cause: error },
  )
  failure.code = 'DSH_PROFILE_PREFLIGHT_FAILED'
  return failure
}

export async function preflightStagedDshProfiles({
  layout,
  stagedRoot,
  metadata,
  timeoutMs = PROFILE_PREFLIGHT_TIMEOUT_MS,
  run = execFileAsync,
  ensureCapsule = ensureRuntimeCapsule,
  acquireLease = acquireRuntimeLease,
  cleanCaches = cleanUnusedRuntimeCaches,
}) {
  const profiles = await discoverExistingDshProfiles(layout)
  if (profiles.length === 0) return { status: 'skipped', profiles }

  let runtimeRoot = stagedRoot
  let preparedCapsule = false
  let release = async () => {}
  let failed = false
  try {
    if (metadata.kind === 'dsh-runtime-capsule') {
      const prepared = await ensureCapsule(stagedRoot)
      if (prepared.mode !== 'capsule') throw new Error('The staged compact runtime did not prepare as a capsule.')
      runtimeRoot = prepared.runtimeRoot
      preparedCapsule = true
      release = await acquireLease(runtimeRoot)
    }
    const targetLayout = layoutForRoot(
      layout.root,
      layout.platform,
      layout.stateRoot,
      runtimeRoot,
      layout.environmentId,
    )
    if (!existsSync(targetLayout.dshBin)) throw new Error('The staged DSH command is missing after preparation.')
    const environment = {
      ...buildDshEnv(targetLayout),
      DSH_PORTABLE_VERSION: metadata.portableVersion,
      DSH_PORTABLE_DSH_VERSION: metadata.dshVersion,
      DSH_PORTABLE_DSH_COMMIT: metadata.dshCommit || '',
    }
    for (const profile of profiles) {
      try {
        await run(targetLayout.nodeExe, [targetLayout.dshBin, '--profile', profile, '--dump-config'], {
          cwd: targetLayout.workspace,
          env: environment,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          timeout: timeoutMs,
          windowsHide: true,
        })
      } catch (error) {
        throw preflightFailure(profile, error)
      }
    }
    return { status: 'passed', profiles }
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await release()
    } catch (releaseError) {
      if (!failed) throw releaseError
    }
    if (failed && preparedCapsule) await cleanCaches(layout.root).catch(() => {})
  }
}
