import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { npmCliCandidates, productionPackageClosure } from '../scripts/stage-preview-runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the stable release explicitly promotes the reviewed candidate without mutating its lock format', async () => {
  const [stable, preview] = await Promise.all([
    readFile(path.join(root, 'upstream.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'upstream.preview.lock.json'), 'utf8').then(JSON.parse),
  ])
  assert.equal(stable.dsh.version, '0.1.2-rc.1')
  assert.equal(stable.dsh.version, preview.dsh.version)
  assert.equal(stable.dsh.integrity, preview.dsh.npmIntegrity)
  assert.equal(stable.dsh.reviewedCommit, preview.dsh.reviewedCommit)
  assert.equal(preview.channel, 'beta')
  assert.match(preview.dsh.version, /^\d+\.\d+\.\d+-(?:alpha|beta|rc)\.[1-9]\d*$/)
  assert.equal(preview.dsh.tag, `dsh-v${preview.dsh.version}`)
  assert.match(preview.dsh.npmIntegrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/)
  assert.match(preview.dsh.reviewedCommit, /^[0-9a-f]{40}$/)
  assert.equal(preview.dsh.buildProfile, 'official')
  assert.deepEqual(preview.dsh.packedFamilies, { dsh: 242, vendor: 9, landlock: 1 })
  assert.deepEqual(preview.defaultPlugins, stable.defaultPlugins)
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

test('Windows packaging consumes preview runtime only through an explicit receipt', async () => {
  const build = await readFile(path.join(root, 'scripts', 'build-windows.ps1'), 'utf8')
  assert.match(build, /\[string\]\$PreviewAppSource/)
  assert.match(build, /preview-runtime\.json/)
  assert.match(build, /upstream\.preview\.lock\.json/)
  assert.match(build, /Preview app receipt does not match/)
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
  assert.ok(preview.platforms['windows-x64'].archiveBytes < stable.platforms['windows-x64'].archiveBytes)
  assert.ok(preview.platforms['windows-x64'].appBytes > stable.platforms['windows-x64'].appBytes)
  for (const platform of ['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']) {
    assert.ok(preview.platforms[platform])
    assert.ok(
      preview.platforms[platform].archiveBytes <= stable.platforms[platform].archiveBytes * 1.01,
      `${platform} preview archive budget must stay within one percent of the stable ceiling`,
    )
  }
})
