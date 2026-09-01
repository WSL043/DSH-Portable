import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { buildDshEnv } from './portable-core.mjs'

const execFileAsync = promisify(execFile)
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const INSTALL_TIMEOUT_MS = 180_000
const COMPOSE_TIMEOUT_MS = 30_000
const RELEASE_AGE_VIOLATION = 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'

export function changedPluginProfiles(changed) {
  const profiles = new Set()
  for (const entry of changed ?? []) {
    if (entry?.category !== 'plugins') continue
    const match = /^data\/dsh-home\/profiles\/([^/]+)\//.exec(String(entry.path || ''))
    if (match && PROFILE_NAME.test(match[1])) profiles.add(match[1])
  }
  return [...profiles].sort((left, right) => left.localeCompare(right, 'en'))
}

function dependencyPath(profileRoot, name) {
  return path.join(profileRoot, 'node_modules', ...name.split('/'), 'package.json')
}

export async function discoverIncompleteProfiles(layout) {
  const profilesRoot = path.join(layout.dshHome, 'profiles')
  let entries
  try {
    entries = await readdir(profilesRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const incomplete = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !PROFILE_NAME.test(entry.name)) continue
    const profileRoot = path.join(profilesRoot, entry.name)
    let manifest
    try { manifest = JSON.parse(await readFile(path.join(profileRoot, 'package.json'), 'utf8')) } catch { continue }
    const dependencies = Object.keys(manifest?.dependencies || {})
    if (dependencies.length > 0 && dependencies.some(name => !existsSync(dependencyPath(profileRoot, name)))) incomplete.push(entry.name)
  }
  return incomplete.sort((left, right) => left.localeCompare(right, 'en'))
}

function importFailure(profile, phase, error) {
  const failure = new Error(`Imported plugin profile "${profile}" failed ${phase}; the data import was rolled back.`, { cause: error })
  failure.code = 'DSH_DATA_IMPORT_PROFILE_FAILED'
  return failure
}

export async function rehydrateImportedProfiles({
  layout,
  changed,
  transaction,
  run = execFileAsync,
  installTimeoutMs = INSTALL_TIMEOUT_MS,
  composeTimeoutMs = COMPOSE_TIMEOUT_MS,
  trace = () => {},
}) {
  const profiles = changedPluginProfiles(changed)
  trace('profiles-discovered', { profiles: profiles.length })
  if (profiles.length === 0) return { status: 'skipped', profiles }
  const environment = buildDshEnv(layout)

  for (const profile of profiles) {
    const profileRoot = path.join(layout.dshHome, 'profiles', profile)
    const packageFile = path.join(profileRoot, 'package.json')
    if (existsSync(packageFile)) {
      trace('profile-dependencies-begin', { profile })
      await transaction.prepareGeneratedPath(path.join(profileRoot, 'node_modules'))
      await transaction.prepareGeneratedPath(path.join(profileRoot, 'pnpm-lock.yaml'))
      const baseArgs = [layout.dshBin, 'plugin', '--profile', profile, 'install', '--force']
      try {
        await run(layout.nodeExe, baseArgs, {
          cwd: layout.workspace,
          env: environment,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          timeout: installTimeoutMs,
          windowsHide: true,
        })
      } catch (firstError) {
        const output = `${firstError?.stderr ?? ''}\n${firstError?.stdout ?? ''}`
        if (!output.includes(RELEASE_AGE_VIOLATION)) throw importFailure(profile, 'dependency restoration', firstError)
        try {
          await run(layout.nodeExe, [
            layout.dshBin,
            'plugin', '--profile', profile, 'install', '--config.minimumReleaseAge=0', '--force',
          ], {
            cwd: layout.workspace,
            env: environment,
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
            timeout: installTimeoutMs,
            windowsHide: true,
          })
        } catch (retryError) {
          throw importFailure(profile, 'dependency restoration', retryError)
        }
      }
      trace('profile-dependencies-complete', { profile })
    }

    trace('profile-compose-begin', { profile })
    try {
      await run(layout.nodeExe, [layout.dshBin, '--profile', profile, '--dump-config'], {
        cwd: layout.workspace,
        env: environment,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: composeTimeoutMs,
        windowsHide: true,
      })
    } catch (error) {
      throw importFailure(profile, 'startup validation', error)
    }
    trace('profile-compose-complete', { profile })
  }
  return { status: 'passed', profiles }
}

export async function repairIncompleteProfileDependencies({
  layout,
  trace = () => {},
  rehydrate = rehydrateImportedProfiles,
}) {
  const profiles = await discoverIncompleteProfiles(layout)
  if (profiles.length === 0) return { status: 'skipped', profiles }
  trace('profile-auto-repair-begin', { profiles: profiles.length })
  const generated = []
  const transaction = {
    prepareGeneratedPath: async (target) => {
      if (generated.some(entry => entry.target === target)) return
      const backup = `${target}.dsh-portable-recovery-${process.pid}-${Date.now()}`
      if (existsSync(target)) {
        await rename(target, backup)
        generated.push({ target, backup })
      } else generated.push({ target, backup: null })
    },
  }
  try {
    const result = await rehydrate({
      layout,
      changed: profiles.map(profile => ({ category: 'plugins', path: `data/dsh-home/profiles/${profile}/package.json` })),
      transaction,
      trace,
    })
    for (const entry of generated) if (entry.backup) await rm(entry.backup, { recursive: true, force: true })
    trace('profile-auto-repair-complete', { profiles: profiles.length })
    return { status: 'repaired', profiles: result.profiles }
  } catch (error) {
    for (const entry of [...generated].reverse()) {
      await rm(entry.target, { recursive: true, force: true }).catch(() => {})
      if (entry.backup && existsSync(entry.backup)) {
        await mkdir(path.dirname(entry.target), { recursive: true })
        await rename(entry.backup, entry.target)
      }
    }
    trace('profile-auto-repair-failed', { profiles: profiles.length, code: error?.code || 'none' })
    throw error
  }
}
