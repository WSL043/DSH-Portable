import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { discoverExistingDshProfiles, preflightStagedDshProfiles } from '../launcher/update-preflight.mjs'

const execFileAsync = promisify(execFile)

// Minimal equivalent of the official compatibility logic in
// app/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:259-323.
const FAKE_APP_BOOT = [
  "import { readFileSync } from 'node:fs';",
  "import path from 'node:path';",
  'export const PROFILE_COMPATIBILITY_FILENAME = \'compatibility.json\';',
  'export function getDshRuntimeVersion() {',
  "  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;",
  '}',
  'function satisfies(runtime, requirement) {',
  "  if (requirement === runtime || requirement === 'workspace:^' || requirement === 'workspace:~' || requirement === 'workspace:*') return true;",
  "  if (!requirement.startsWith('^')) return false;",
  '  const base = requirement.slice(1).split(/[+-]/, 1)[0].split(\'.\').map(Number);',
  '  const current = runtime.split(/[+-]/, 1)[0].split(\'.\').map(Number);',
  '  if (base[0] !== current[0]) return false;',
  '  if (base[0] === 0 && base[1] !== current[1]) return false;',
  '  if (base[0] === 0 && base[1] === 0 && base[2] !== current[2]) return false;',
  '  return true; // Fixtures use prerelease ranges; production enables includePrerelease.',
  '}',
  'export function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {',
  '  if (!Object.hasOwn(manifest, \'peerDependencies\')) return undefined;',
  '  const peers = {};',
  '  for (const [name, range] of Object.entries(manifest.peerDependencies)) {',
  "    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue;",
  "    const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtimeVersion : range;",
  '    if (!satisfies(runtimeVersion, requirement)) peers[name] = range;',
  '  }',
  '  if (Object.keys(peers).length === 0) return undefined;',
  "  const name = manifest.name; const version = manifest.version; const key = name + '@' + version;",
  '  return { name, version, runtimeVersion, peers, exempted: (exemptions[key] || []).includes(runtimeVersion) };',
  '}',
  'export function readProfileCompatibility(profileDir) {',
  '  try { return { exemptions: JSON.parse(readFileSync(path.join(profileDir, PROFILE_COMPATIBILITY_FILENAME), \'utf8\')) }; }',
  '  catch { return { exemptions: {} }; }',
  '}',
  'export function pluginCompatibilityWarning(issue) {',
  "  return 'Plugin ' + issue.name + '@' + issue.version + ' is incompatible with dsh ' + issue.runtimeVersion + ': peerDependencies ' + JSON.stringify(issue.peers) + '. Running it may cause crashes or data loss. Exact-version exemption: ' + (issue.exempted ? 'active' : 'not active') + '.';",
  '}',
].join('\n')

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`)
}

async function createPreflightFixture({ appBootSource = FAKE_APP_BOOT } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-preflight-'))
  const layout = layoutForRoot(root)
  const stagedRoot = path.join(root, '.dsh-portable-update', 'operation', 'staged')
  const stagedLayout = layoutForRoot(root, process.platform, root, stagedRoot)
  await mkdir(path.dirname(stagedLayout.dshBin), { recursive: true })
  await writeFile(stagedLayout.dshBin, '// fixture\n')
  const bootDir = path.join(stagedLayout.appDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot')
  await writeJson(path.join(bootDir, 'package.json'), {
    name: '@deepseek-ai/dsh-app-boot',
    type: 'module',
    version: '0.2.0-rc.1',
    exports: './lib/index.js',
  })
  await mkdir(path.join(bootDir, 'lib'), { recursive: true })
  await writeFile(path.join(bootDir, 'lib', 'index.js'), appBootSource)
  return { root, layout, stagedRoot, stagedLayout }
}

async function writePlugin(profileDir, folder, manifest) {
  const filename = path.join(profileDir, 'node_modules', folder, 'package.json')
  await writeJson(filename, manifest)
}

function targetNodeRunner(calls = []) {
  return async (command, args, options) => {
    calls.push({ command, args, options })
    if (args.includes('--dump-config')) return { stdout: '{}\n', stderr: '' }
    // In tests the host Node process stands in for the staged Node binary while
    // the target app cwd and target app-boot fixture remain real.
    return execFileAsync(process.execPath, args, options)
  }
}

async function createCompatibilityProfile(layout) {
  const profileDir = path.join(layout.dshHome, 'profiles', 'web')
  const dependencyNames = [
    'dsh-compatible',
    'dsh-incompatible',
    'dsh-exempted',
    'dsh-workspace',
    'dsh-no-peer',
    'dsh-broken',
    '@scope/dsh-scoped',
    'ordinary-dependency',
  ]
  await writeJson(path.join(profileDir, 'package.json'), {
    dependencies: Object.fromEntries(dependencyNames.map((name) => [name, '1.0.0'])),
  })
  await writeJson(path.join(profileDir, 'compatibility.json'), {
    'dsh-exempted@1.0.0': ['0.2.0-rc.1'],
  })
  await writePlugin(profileDir, 'dsh-compatible', {
    name: 'dsh-compatible', version: '1.0.0',
    peerDependencies: { '@deepseek-ai/dsh': '^0.2.0-rc.1', '@deepseek-ai/dsh-addon': 'workspace:*' },
  })
  await writePlugin(profileDir, 'dsh-incompatible', {
    name: 'dsh-incompatible', version: '2.1.0',
    peerDependencies: { '@deepseek-ai/dsh-compaction-basic': '^0.1.1-rc.2' },
  })
  await writePlugin(profileDir, 'dsh-exempted', {
    name: 'dsh-exempted', version: '1.0.0',
    peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.1-rc.2' },
  })
  await writePlugin(profileDir, 'dsh-workspace', {
    name: 'dsh-workspace', version: '1.0.0',
    peerDependencies: { '@deepseek-ai/dsh': 'workspace:*' },
  })
  await writePlugin(profileDir, 'dsh-no-peer', { name: 'dsh-no-peer', version: '1.0.0' })
  await mkdir(path.join(profileDir, 'node_modules', 'dsh-broken'), { recursive: true })
  await writeFile(path.join(profileDir, 'node_modules', 'dsh-broken', 'package.json'), '{broken')
  await writePlugin(profileDir, '@scope/dsh-scoped', {
    name: '@scope/dsh-scoped', version: '3.0.0',
    peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.1-rc.2' },
  })
  await writePlugin(profileDir, 'ordinary-dependency', {
    name: 'ordinary-dependency', version: '4.0.0',
    peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.1-rc.2' },
  })
  // This package is discovered by its installed dsh-* name, not package.json dependencies.
  await writePlugin(profileDir, 'dsh-top-level', {
    name: 'dsh-top-level', version: '5.0.0',
    peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.1-rc.2' },
  })
  const marker = path.join(layout.root, 'plugin-code-was-imported')
  await writeFile(path.join(profileDir, 'node_modules', 'dsh-incompatible', 'index.js'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'no');\n`)
  return { profileDir, marker }
}

test('profile discovery includes only initialized profiles in stable name order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-profiles-'))
  const layout = layoutForRoot(root)
  try {
    for (const profile of ['web', 'headless']) {
      await mkdir(path.join(layout.dshHome, 'profiles', profile), { recursive: true })
      await writeFile(path.join(layout.dshHome, 'profiles', profile, 'package.json'), '{}\n')
    }
    await mkdir(path.join(layout.dshHome, 'profiles', 'empty'), { recursive: true })
    await mkdir(path.join(layout.dshHome, 'profiles', 'node_modules'), { recursive: true })
    await writeFile(path.join(layout.dshHome, 'profiles', 'node_modules', 'package.json'), '{}\n')

    assert.deepEqual(await discoverExistingDshProfiles(layout), ['headless', 'web'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preflight uses the target app-boot compatibility API and excludes compatible or exempted plugins', async () => {
  const fixture = await createPreflightFixture()
  const calls = []
  try {
    const { marker } = await createCompatibilityProfile(fixture.layout)
    const result = await preflightStagedDshProfiles({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      metadata: { kind: 'dsh-app', dshVersion: '0.2.0-rc.1', portableVersion: '0.8.0' },
      run: targetNodeRunner(calls),
    })

    assert.equal(result.status, 'passed')
    assert.equal(result.checkUnavailable, null)
    assert.deepEqual(result.profiles, ['web'])
    assert.deepEqual(result.warnings.map(({ plugin }) => plugin).sort(), [
      '@scope/dsh-scoped',
      'dsh-incompatible',
      'dsh-top-level',
      'ordinary-dependency',
    ])
    const scopedWarning = result.warnings.find(({ plugin }) => plugin === '@scope/dsh-scoped')
    assert.deepEqual({
      profile: scopedWarning.profile,
      plugin: scopedWarning.plugin,
      version: scopedWarning.version,
      row: scopedWarning.row,
    }, {
      profile: 'web',
      plugin: '@scope/dsh-scoped',
      version: '3.0.0',
      row: '@scope/dsh-scoped',
    })
    assert.match(scopedWarning.reason, /^Plugin @scope\/dsh-scoped@3\.0\.0 is incompatible with dsh 0\.2\.0-rc\.1:/)
    assert.equal(result.warnings.every(({ reason }) => reason.length <= 300), true)
    assert.equal(result.warnings.some(({ plugin }) => plugin === 'dsh-exempted'), false)
    assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].args.slice(1), ['--profile', 'web', '--dump-config'])
    assert.equal(calls[1].args[0], '--input-type=module')
    assert.equal(calls[1].options.cwd, fixture.stagedLayout.appDir)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('missing target app-boot exports make compatibility checking unavailable without failing preflight', async () => {
  const fixture = await createPreflightFixture({ appBootSource: "export const other = true;\n" })
  try {
    await createCompatibilityProfile(fixture.layout)
    const result = await preflightStagedDshProfiles({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      metadata: { kind: 'dsh-app', dshVersion: '0.2.0-rc.1', portableVersion: '0.8.0' },
      run: targetNodeRunner(),
    })

    assert.equal(result.status, 'passed')
    assert.deepEqual(result.warnings, [])
    assert.match(result.checkUnavailable, /missing required compatibility exports/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('checker process failures and timeouts are non-fatal and reported as unavailable', async () => {
  for (const error of [
    Object.assign(new Error('checker process failed'), { code: 'ERR_CHILD_PROCESS' }),
    Object.assign(new Error('checker process timed out'), { code: 'ETIMEDOUT' }),
  ]) {
    const fixture = await createPreflightFixture()
    try {
      await mkdir(path.join(fixture.layout.dshHome, 'profiles', 'web'), { recursive: true })
      await writeFile(path.join(fixture.layout.dshHome, 'profiles', 'web', 'package.json'), '{}\n')
      const run = async (_command, args) => {
        if (args.includes('--dump-config')) return { stderr: '' }
        throw error
      }
      const result = await preflightStagedDshProfiles({
        layout: fixture.layout,
        stagedRoot: fixture.stagedRoot,
        metadata: { kind: 'dsh-app', dshVersion: '0.2.0-rc.1', portableVersion: '0.8.0' },
        run,
      })
      assert.equal(result.status, 'passed')
      assert.deepEqual(result.warnings, [])
      assert.match(result.checkUnavailable, /Target core plugin compatibility check unavailable/)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  }
})

test('--dump-config composition failures retain DSH_PROFILE_PREFLIGHT_FAILED semantics', async () => {
  const fixture = await createPreflightFixture()
  try {
    await mkdir(path.join(fixture.layout.dshHome, 'profiles', 'web'), { recursive: true })
    await writeFile(path.join(fixture.layout.dshHome, 'profiles', 'web', 'package.json'), '{}\n')
    await assert.rejects(preflightStagedDshProfiles({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      metadata: { kind: 'dsh-app', dshVersion: '0.2.0-rc.1', portableVersion: '0.8.0' },
      run: async () => { throw new Error('missing settingsNamespace export') },
    }), (error) => error.code === 'DSH_PROFILE_PREFLIGHT_FAILED' && /web/.test(error.message))
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('failed capsule composition preflight releases its lease and removes the unused target cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-capsule-preflight-'))
  const runtimeRoot = path.join(root, 'runtime-cache', 'b'.repeat(64))
  const layout = layoutForRoot(root, process.platform, root, path.join(root, 'runtime-cache', 'a'.repeat(64)))
  const stagedRoot = path.join(root, '.dsh-portable-update', 'operation', 'staged')
  let released = false
  let cleaned = false
  try {
    await mkdir(path.join(layout.dshHome, 'profiles', 'web'), { recursive: true })
    await writeFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json'), '{}\n')
    await mkdir(path.join(runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await writeFile(path.join(runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '// fixture\n')

    await assert.rejects(preflightStagedDshProfiles({
      layout,
      stagedRoot,
      metadata: { kind: 'dsh-runtime-capsule', dshVersion: '0.1.2-alpha.2', portableVersion: '0.6.0-rc.4' },
      ensureCapsule: async () => ({ mode: 'capsule', runtimeRoot }),
      acquireLease: async () => async () => { released = true },
      cleanCaches: async (portableRoot) => {
        assert.equal(portableRoot, layout.root)
        assert.equal(released, true)
        cleaned = true
      },
      run: async () => { throw new Error('missing settingsNamespace export') },
    }), (error) => error.code === 'DSH_PROFILE_PREFLIGHT_FAILED' && /web/.test(error.message))
    assert.equal(released, true)
    assert.equal(cleaned, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
