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

// This runs in the staged app directory so bare-package resolution uses the target
// core's own node_modules. It reads manifests only; plugin entry points are never loaded.
const PROFILE_COMPATIBILITY_CHECK_SCRIPT = String.raw`
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const unavailable = (reason) => emit({ items: [], checkUnavailable: String(reason).slice(0, 1000) });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const readJson = async (filename) => {
  try {
    const value = JSON.parse(await readFile(filename, 'utf8'));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
};

try {
  const boot = await import('@deepseek-ai/dsh-app-boot');
  const required = [
    'evaluatePluginCompatibility',
    'getDshRuntimeVersion',
    'readProfileCompatibility',
    'pluginCompatibilityWarning',
  ];
  const missing = required.filter((name) => typeof boot[name] !== 'function');
  if (typeof boot.PROFILE_COMPATIBILITY_FILENAME !== 'string') missing.push('PROFILE_COMPATIBILITY_FILENAME');
  if (missing.length) {
    unavailable('Target @deepseek-ai/dsh-app-boot is missing required compatibility exports: ' + missing.join(', '));
  } else {
    const profilesRoot = process.argv[1];
    const profiles = JSON.parse(process.argv[2]);
    const runtimeVersion = boot.getDshRuntimeVersion();
    const items = [];

    for (const profile of profiles) {
      const profileDir = path.join(profilesRoot, profile);
      const profileManifest = await readJson(path.join(profileDir, 'package.json'));
      const moduleRoot = path.join(profileDir, 'node_modules');
      const packageNames = new Set();

      if (profileManifest && isObject(profileManifest.dependencies)) {
        for (const name of Object.keys(profileManifest.dependencies)) {
          if (packageNamePattern.test(name)) packageNames.add(name);
        }
      }

      try {
        for (const entry of await readdir(moduleRoot, { withFileTypes: true })) {
          if (entry.name.startsWith('dsh-') && packageNamePattern.test(entry.name)) packageNames.add(entry.name);
          if (!entry.name.startsWith('@') || !packageNamePattern.test(entry.name + '/placeholder')) continue;
          try {
            for (const scoped of await readdir(path.join(moduleRoot, entry.name), { withFileTypes: true })) {
              const name = entry.name + '/' + scoped.name;
              if (scoped.name.startsWith('dsh-') && packageNamePattern.test(name)) packageNames.add(name);
            }
          } catch {
            // A broken or disappearing scope does not prevent checking other installed packages.
          }
        }
      } catch {
        // Profiles without node_modules simply have no installed packages to inspect.
      }

      let exemptions = {};
      try {
        const compatibility = boot.readProfileCompatibility(profileDir);
        if (isObject(compatibility?.exemptions)) exemptions = compatibility.exemptions;
      } catch {
        // Match the official profile reader's fail-closed behavior: no exemption is granted.
      }

      for (const plugin of packageNames) {
        const manifest = await readJson(path.join(moduleRoot, plugin, 'package.json'));
        if (!manifest) continue;
        try {
          const issue = boot.evaluatePluginCompatibility(manifest, exemptions, runtimeVersion);
          if (!issue) continue;
          items.push({
            profile,
            plugin: issue.name,
            version: issue.version,
            peers: issue.peers,
            exempted: issue.exempted === true,
            reason: boot.pluginCompatibilityWarning(issue),
          });
        } catch {
          // A malformed individual manifest cannot make the rest of the preflight fail.
        }
      }
    }

    emit({ items, checkUnavailable: null });
  }
} catch (error) {
  unavailable('Target core compatibility check unavailable: ' + (error?.message || String(error)));
}
`

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

function unavailableCheck(reason) {
  const detail = String(reason?.stderr || reason?.message || reason || 'unknown error').trim().slice(-1000)
  return `Target core plugin compatibility check unavailable: ${detail}`
}

export async function checkStagedDshProfileCompatibility({
  layout,
  profiles,
  timeoutMs = PROFILE_PREFLIGHT_TIMEOUT_MS,
  run = execFileAsync,
  environment = buildDshEnv(layout),
}) {
  if (profiles.length === 0) return { warnings: [], checkUnavailable: null }

  try {
    const result = await run(layout.nodeExe, [
      '--input-type=module',
      '-e',
      PROFILE_COMPATIBILITY_CHECK_SCRIPT,
      path.join(layout.dshHome, 'profiles'),
      JSON.stringify(profiles),
    ], {
      cwd: layout.appDir,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    })
    const output = String(result?.stdout ?? '').trim()
    const parsed = JSON.parse(output)
    if (!Array.isArray(parsed?.items)) {
      return { warnings: [], checkUnavailable: unavailableCheck('target checker returned an invalid result') }
    }
    if (typeof parsed.checkUnavailable === 'string' && parsed.checkUnavailable) {
      return { warnings: [], checkUnavailable: parsed.checkUnavailable.slice(0, 1000) }
    }

    const warnings = []
    for (const item of parsed.items) {
      if (item?.exempted === true) continue
      if (typeof item?.profile !== 'string'
        || typeof item?.plugin !== 'string'
        || typeof item?.version !== 'string'
        || typeof item?.reason !== 'string') {
        return { warnings: [], checkUnavailable: unavailableCheck('target checker returned an invalid warning') }
      }
      warnings.push({
        profile: item.profile,
        plugin: item.plugin,
        version: item.version,
        row: item.plugin,
        reason: item.reason.slice(0, 300),
      })
    }
    return { warnings, checkUnavailable: null }
  } catch (error) {
    return { warnings: [], checkUnavailable: unavailableCheck(error) }
  }
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
  if (profiles.length === 0) return { status: 'skipped', profiles, warnings: [], checkUnavailable: null }

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

    const compatibility = await checkStagedDshProfileCompatibility({
      layout: targetLayout,
      profiles,
      timeoutMs,
      run,
      environment,
    })
    return { status: 'passed', profiles, ...compatibility }
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
