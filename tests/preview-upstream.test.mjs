import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { installedDependencyManifest, npmCliCandidates, productionPackageClosure } from '../scripts/stage-preview-runtime.mjs'
import { DEFAULT_PLUGINS, PREVIEW_DEFAULT_PLUGINS, defaultsForProduct } from '../launcher/default-plugins.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('stable and candidate cores have independently pinned official source locks', async () => {
  const [stable, preview] = await Promise.all([
    readFile(path.join(root, 'upstream.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'upstream.preview.lock.json'), 'utf8').then(JSON.parse),
  ])
  const app = JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8'))
  assert.equal(app.overrides['@deepseek-ai/libreoffice-kit@0.1.0']?.fflate, '0.8.3',
    'the RC Office kit must retain the reviewed ZIP parser fix')
  assert.equal(app.overrides['@deepseek-ai/libreoffice-kit@0.1.1']?.fflate, '0.8.3',
    'the newer RC Office kit must retain the reviewed ZIP parser fix')
  assert.equal(stable.dsh.version, app.dependencies['@deepseek-ai/dsh'])
  assert.match(stable.dsh.integrity, /^sha512-/)
  assert.match(stable.dsh.reviewedCommit, /^[0-9a-f]{40}$/)
  for (const family of ['dsh', 'vendor']) assert.ok(Number.isSafeInteger(stable.dsh.packedFamilies[family]) && stable.dsh.packedFamilies[family] > 0)
  assert.ok([0, 1].includes(stable.dsh.packedFamilies.landlock))
  assert.equal(preview.channel, 'beta')
  assert.match(preview.dsh.version, /^\d+\.\d+\.\d+-(?:alpha|beta|rc)\.[1-9]\d*$/)
  assert.equal(preview.dsh.tag, `dsh-v${preview.dsh.version}`)
  assert.match(preview.dsh.npmIntegrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/)
  assert.match(preview.dsh.reviewedCommit, /^[0-9a-f]{40}$/)
  assert.equal(preview.dsh.buildProfile, 'official')
  for (const family of ['dsh', 'vendor']) {
    const count = preview.dsh.packedFamilies[family]
    assert.ok(Number.isSafeInteger(count) && count > 0)
  }
  assert.ok([0, 1].includes(preview.dsh.packedFamilies.landlock), 'standalone landlock is optional in newer official sources')
  assert.deepEqual(Object.keys(preview.defaultPlugins).sort(), Object.keys(stable.defaultPlugins).sort())
  for (const [lock, reviewed] of [[stable, DEFAULT_PLUGINS], [preview, PREVIEW_DEFAULT_PLUGINS]]) {
    const entries = Object.values(lock.defaultPlugins)
    const selected = defaultsForProduct({ root }, { existsSync: () => true,
      readFileSync: () => JSON.stringify({ defaultPlugins: entries }),
    })
    assert.deepEqual(selected, reviewed)
    for (const entry of entries) {
      assert.equal(entry.spec, entry.version)
      assert.match(entry.sha256, /^[a-f0-9]{64}$/)
      assert.match(entry.reviewedCommit, /^[a-f0-9]{40}$/)
    }
  }
})

test('preview staging is an explicit build input and never rewrites the stable app lock', async () => {
  const script = await readFile(path.join(root, 'scripts', 'stage-preview-runtime.mjs'), 'utf8')
  assert.match(script, /--packed-root/)
  assert.match(script, /preview-runtime\.json/)
  assert.match(script, /packageSetSha256/)
  assert.doesNotMatch(script, /writeFile\([^\n]+upstream\.lock\.json/)
  assert.doesNotMatch(script, /writeFile\([^\n]+app[^\n]+package-lock\.json/)
})

test('preview staging follows the production dependency closure instead of every packed package', () => {
  const packages = [
    { name: '@deepseek-ai/dsh', manifest: { dependencies: { '@deepseek-ai/runtime': '1' }, devDependencies: { '@deepseek-ai/dev-only': '1' } } },
    { name: '@deepseek-ai/runtime', manifest: { peerDependencies: { '@deepseek-ai/peer': '1', '@deepseek-ai/optional-peer': '1' }, peerDependenciesMeta: { '@deepseek-ai/optional-peer': { optional: true } } } },
    { name: '@deepseek-ai/peer', manifest: {} },
    { name: '@deepseek-ai/optional-peer', manifest: {} },
    { name: '@deepseek-ai/dev-only', manifest: {} },
    { name: '@deepseek-ai/separate-provider', manifest: {} },
  ]
  assert.deepEqual(
    productionPackageClosure(packages, '@deepseek-ai/dsh').map((entry) => entry.name),
    ['@deepseek-ai/dsh', '@deepseek-ai/peer', '@deepseek-ai/runtime'],
  )
})

test('preview staging resolves npm from standard Windows and Unix Node layouts', () => {
  const candidates = npmCliCandidates(process.execPath, undefined)
  assert.ok(candidates.some((candidate) => candidate.endsWith(path.join('node_modules', 'npm', 'bin', 'npm-cli.js'))))
  assert.ok(candidates.some((candidate) => candidate.endsWith(path.join('lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))))
})

test('preview staging reads the installed Office parser version when its package manifest is not exported', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'dsh-preview-export-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const owner = path.join(fixture, 'office')
  const parser = path.join(owner, 'node_modules', 'fflate')
  await mkdir(parser, { recursive: true })
  const ownerManifest = path.join(owner, 'package.json')
  await writeFile(ownerManifest, JSON.stringify({ name: 'office' }))
  await writeFile(path.join(parser, 'package.json'), JSON.stringify({
    name: 'fflate', version: '0.8.3', exports: { '.': './index.cjs' },
  }))
  await writeFile(path.join(parser, 'index.cjs'), 'module.exports = {}\n')
  assert.equal((await installedDependencyManifest(ownerManifest, 'fflate')).version, '0.8.3')
})

test('Windows packaging consumes preview runtime only through an explicit receipt', async () => {
  const build = await readFile(path.join(root, 'scripts', 'build-windows.ps1'), 'utf8')
  assert.match(build, /\[string\]\$PreviewAppSource/)
  assert.match(build, /preview-runtime\.json/)
  assert.match(build, /upstream\.preview\.lock\.json/)
  assert.match(build, /Source-pack receipt does not match selected upstream lock/)
  assert.match(build, /if \(-not \$PreviewAppSource\) \{[\s\S]+verify-lock\.mjs[\s\S]+npm ci failed/)
  assert.match(build, /dshChannel = if \(\$ReleaseChannel -eq 'candidate'\) \{ 'preview' \} else \{ 'stable' \}/)
  assert.match(build, /footprint-budgets-preview\.json/)
  assert.match(build, /Candidate builds require -PreviewAppSource/)
  assert.match(build, /Stable source-pack receipt does not match upstream\.lock\.json/)
  assert.match(build, /\$ReleaseChannel -eq 'candidate'[\s\S]+footprint-budgets-preview\.json/)
})

test('macOS and Linux packaging fail closed unless the staged official source pack matches the selected lock', async () => {
  for (const filename of ['build-macos.sh', 'build-linux.sh']) {
    const build = await readFile(path.join(root, 'scripts', filename), 'utf8')
    assert.match(build, /PREVIEW_APP_SOURCE/)
    assert.match(build, /Candidate builds require PREVIEW_APP_SOURCE/)
    assert.match(build, /preview-runtime\.json/)
    assert.match(build, /upstream\.preview\.lock\.json/)
    assert.match(build, /source-pack receipt does not match selected upstream lock/i)
    assert.match(build, /dshPackageSetSha256/)
    assert.match(build, /footprint-budgets-preview\.json/)
  }
})

test('CI builds one immutable official source package set and stages it natively on every platform', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(workflow, /preview-packed-runtime:/)
  assert.match(workflow, /repository: deepseek-ai\/deepseek-harness/)
  assert.match(workflow, /ref: \$\{\{ steps\.preview\.outputs\.commit \}\}/)
  assert.match(workflow, /pnpm --dir upstream run build:official/)
  assert.match(workflow, /pnpm --dir upstream run release:pack --family dsh --out dist\/npm --concurrency 8/)
  assert.match(workflow, /pnpm --dir upstream run release:pack --family vendor --out dist\/npm-vendor --concurrency 8/)
  assert.match(workflow, /pnpm --dir upstream\/native\/landlock-run\/packages\/entry pack --pack-destination/)
  assert.equal((workflow.match(/stage-preview-runtime\.mjs/g) ?? []).length, 3)
  assert.equal((workflow.match(/--packed-root preview-packed(?:\s|$)/gm) ?? []).length, 3)
  assert.doesNotMatch(workflow, /if: steps\.preview\.outputs\.channel == 'candidate'/)
  assert.match(workflow, /build-windows\.ps1 -PreviewAppSource preview-app/)
  assert.match(workflow, /PREVIEW_APP_SOURCE="\$PWD\/preview-app" bash scripts\/build-macos\.sh/)
  assert.match(workflow, /PREVIEW_APP_SOURCE="\$PWD\/preview-app" bash scripts\/build-linux\.sh/)
})

test('preview footprint has a separate reviewed budget without weakening stable releases', async () => {
  const [stable, preview] = await Promise.all([
    readFile(path.join(root, 'config', 'footprint-budgets.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'config', 'footprint-budgets-preview.json'), 'utf8').then(JSON.parse),
  ])
  for (const platform of ['windows-x64', 'macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']) {
    assert.ok(preview.platforms[platform])
    const budget = preview.platforms[platform]
    assert.ok(budget.officeRuntimeBytes > 0 && budget.officeRuntimeBytes <= 350000000)
    assert.ok(budget.speechRuntimeBytes > 0 && budget.speechRuntimeBytes <= 41000000)
    assert.ok(budget.extractedBytesWithoutOfficeAndSpeechRuntime <= stable.platforms[platform].extractedBytes * 1.01 + 10000000,
      `${platform} unrelated growth is limited to the reviewed document-preview allowance`)
    assert.ok(budget.extractedBytesWithoutOfficeRuntime <= budget.extractedBytesWithoutOfficeAndSpeechRuntime + budget.speechRuntimeBytes)
    assert.ok(budget.extractedBytes <= budget.extractedBytesWithoutOfficeRuntime + budget.officeRuntimeBytes)
    assert.ok(budget.archiveBytes < budget.extractedBytes)
  }
})

test('promoted stable source packs retain realistic headroom from candidate qualification', async (t) => {
  const [stableLock, previewLock, stable, preview] = await Promise.all([
    readFile(path.join(root, 'upstream.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'upstream.preview.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'config', 'footprint-budgets.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'config', 'footprint-budgets-preview.json'), 'utf8').then(JSON.parse),
  ])
  if (stableLock.dsh.reviewedCommit !== previewLock.dsh.reviewedCommit) {
    t.skip('Stable and candidate target different commits; this promotion-only comparison does not apply.')
    return
  }
  for (const platform of Object.keys(preview.platforms)) {
    for (const metric of ['archiveBytes', 'extractedBytes', 'files', 'directories', 'items']) {
      assert.ok(
        stable.platforms[platform][metric] >= preview.platforms[platform][metric] * 0.95,
        `${platform} stable ${metric} budget must retain at least 95% of its qualified candidate headroom`,
      )
    }
  }
})
