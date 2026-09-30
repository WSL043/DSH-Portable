import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url)), '..')
const powershell = process.env.SystemRoot
  ? resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  : 'powershell.exe'
const onWindows = process.platform === 'win32'
const literal = value => `'${String(value).replaceAll("'", "''")}'`

function runPowerShell(source) {
  const env = { ...process.env }
  delete env.PSModulePath
  return execFileSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(source, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 30000, env }).trim()
}

function tarArchive(entries) {
  const blocks = []
  for (const [name, value] of entries) {
    const body = Buffer.from(value)
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, 'utf8')
    header.write('0000644\0', 100, 8, 'ascii')
    header.write('0000000\0', 108, 8, 'ascii')
    header.write('0000000\0', 116, 8, 'ascii')
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
    header.write('00000000000\0', 136, 12, 'ascii')
    header.fill(0x20, 148, 156)
    header[156] = 0x30
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii')
    header[154] = 0
    header[155] = 0x20
    blocks.push(header, body)
    const padding = (512 - (body.length % 512)) % 512
    if (padding) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function testPluginArchive() {
  return tarArchive([
    ['package/package.json', JSON.stringify({ name: 'test-plugin', version: '1.2.3' })],
    ['package/cordis.patch.yml', '- insert:\n    - id: test-plugin-entry\n      name: test-plugin\n'],
  ])
}

test('seed.json manifest generation reads package metadata and Cordis id from tgz and hashes the archive', { skip: !onWindows }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'official-seed-manifest-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const archive = join(temp, 'sample.tgz')
  const bytes = testPluginArchive()
  await writeFile(archive, bytes)
  const module = resolve(root, 'experiments/official-payload/SeedPluginPackaging.psm1')
  const core = resolve(root, 'experiments/official-payload/seed-plugins-core.psm1')
  const output = runPowerShell(`Import-Module ${literal(module)} -Force; $manifest=New-SeedManifest -ArchivePath @(${literal(archive)}); Import-Module ${literal(core)} -Force; [ordered]@{manifest=$manifest;runtimeSha512=(Get-SeedSha512 -Path ${literal(archive)})} | ConvertTo-Json -Depth 8 -Compress`)
  const result = JSON.parse(output)
  const manifest = result.manifest
  assert.equal(manifest.schemaVersion, 1)
  assert.deepEqual(manifest.plugins, [{
    name: 'test-plugin',
    file: 'test-plugin-1.2.3.tgz',
    entryId: 'test-plugin-entry',
    sha512: createHash('sha512').update(bytes).digest('hex'),
  }])
  assert.equal(result.runtimeSha512, createHash('sha512').update(bytes).digest('hex'))
})

test('seed helpers preserve patches, honor recorded names, and rewrite lockfile paths', { skip: !onWindows }, () => {
  const module = resolve(root, 'experiments/official-payload/seed-plugins-core.psm1')
  const seed = join(tmpdir(), 'portable seed space', 'data', 'dsh-home', 'profiles', 'desktop', 'seed', 'test-plugin-1.2.3.tgz')
  const output = runPowerShell(`
    Import-Module ${literal(module)} -Force
    $old = ([string]::Join([char]10, @('# preserve this comment', '- id: existing', '  disabled: false')) + [char]10)
    $first = Merge-SeedCordisPatch -Content $old -EntryId 'new-entry'
    $again = Merge-SeedCordisPatch -Content $first.content -EntryId 'new-entry'
    $keep = Merge-SeedCordisPatch -Content $old -EntryId 'existing'
    $seeded = '{"schemaVersion":1,"plugins":[{"name":"new-plugin","version":"1.0.0","nameVersion":"new-plugin@1.0.0"}]}' | ConvertFrom-Json
    $absolute = 'file:' + [IO.Path]::GetFullPath(${literal(seed)}).Replace('\\', '/')
    $lock = [string]::Join([char]10, @('importers:', '  .:', '    dependencies:', '      new-plugin:', "        specifier: $absolute", '        version: file:seed/test-plugin-1.2.3.tgz')) + [char]10
    $rewritten = Rewrite-SeedLockfilePackagePath -Content $lock -AbsolutePackagePath ${literal(seed)} -RelativePackagePath './seed/test-plugin-1.2.3.tgz'
    $modules = [string]::Join([char]10, @('"virtualStoreDir": "C:\\old\\profile\\node_modules\\.pnpm"', '"virtualStoreDirMaxLength": 60')) + [char]10
    $relativeModules = Rewrite-SeedVirtualStorePath -Content $modules
    [ordered]@{ first=$first.content; second=$again.content; repeated=$again.existed; kept=$keep.content; recorded=(Test-SeedRecordedName -Seeded $seeded -Name 'new-plugin'); relative=$rewritten.relativeSpecifier; lock=$rewritten.content; replacements=$rewritten.replacements; modules=$relativeModules.content } | ConvertTo-Json -Depth 8 -Compress
  `)
  const result = JSON.parse(output)
  assert.ok(result.first.startsWith('# preserve this comment\n- id: existing\n  disabled: false\n'))
  assert.match(result.first, /- id: new-entry\n  disabled: true\n$/)
  assert.equal(result.second, result.first)
  assert.equal(result.repeated, true)
  assert.equal(result.kept, '# preserve this comment\n- id: existing\n  disabled: false\n')
  assert.equal(result.recorded, true)
  assert.equal(result.relative, 'file:./seed/test-plugin-1.2.3.tgz')
  assert.match(result.lock, /specifier: file:\.\/seed\/test-plugin-1\.2\.3\.tgz/)
  assert.match(result.lock, /version: file:seed\/test-plugin-1\.2\.3\.tgz/)
  assert.equal(result.replacements, 1)
  assert.match(result.modules, /"virtualStoreDir": "\.pnpm"/)
  assert.match(result.modules, /"virtualStoreDirMaxLength": 60/)
})

test('seed script is a no-op before the desktop profile exists', { skip: !onWindows }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'official-seed-no-profile-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const script = resolve(root, 'launcher/seed-plugins.ps1')
  runPowerShell(`& ${literal(script)} -Root ${literal(temp)}`)
  await assert.rejects(readFile(join(temp, 'data/launcher/seed-status.json')))
  await assert.rejects(readFile(join(temp, 'data/launcher/seeded.json')))
})

test('seed orchestration is transactional and never reapplies a recorded plugin choice', { skip: !onWindows }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'official-seed-idempotent-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const profile = join(temp, 'data', 'dsh-home', 'profiles', 'desktop')
  const seedDirectory = join(temp, 'launcher', 'seed')
  const appDirectory = join(temp, 'app', '0.2.0-rc.2', 'resources', 'runtime', 'cli', 'bin')
  await mkdir(profile, { recursive: true })
  await mkdir(seedDirectory, { recursive: true })
  await mkdir(appDirectory, { recursive: true })

  const archive = testPluginArchive()
  const packageFile = 'test-plugin-1.2.3.tgz'
  await writeFile(join(seedDirectory, packageFile), archive)
  await writeFile(join(seedDirectory, 'seed.json'), JSON.stringify({
    schemaVersion: 1,
    plugins: [{ name: 'test-plugin', file: packageFile, entryId: 'test-plugin-entry', sha512: createHash('sha512').update(archive).digest('hex') }],
  }))
  await writeFile(join(temp, 'app', 'current.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    dependencies: { 'test-plugin': 'file:old-location.tgz' },
    dsh: { profile: { bundles: ['official-base'] } },
  }))
  const initialPatch = '# preserve comment\n- id: another-entry\n  disabled: false\n'
  await writeFile(join(profile, 'cordis.patch.yml'), initialPatch)
  const fakeAdd = String.raw`
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const profile = process.cwd()
const relative = process.argv.at(-1).replaceAll('\\', '/')
const archive = resolve(profile, relative)
const packagePath = join(profile, 'package.json')
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
pkg.dependencies ??= {}
pkg.dependencies['test-plugin'] = 'file:' + archive.replaceAll('\\', '/')
pkg.dsh ??= {}
pkg.dsh.profile ??= {}
pkg.dsh.profile.bundles ??= []
if (!pkg.dsh.profile.bundles.includes('test-plugin')) pkg.dsh.profile.bundles.push('test-plugin')
await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n')
await mkdir(join(profile, 'node_modules', 'test-plugin'), { recursive: true })
await writeFile(join(profile, 'node_modules', 'test-plugin', 'package.json'), JSON.stringify({ name: 'test-plugin', version: '1.2.3' }))
const lock = "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      test-plugin:\n        specifier: file:" + archive.replaceAll('\\', '/') + "\n        version: file:" + relative.replace(/^\.\//, '') + "\n\npackages: {}\n"
await writeFile(join(profile, 'pnpm-lock.yaml'), lock)
const virtualStoreDir = join(profile, 'node_modules', '.pnpm').replaceAll('\\', '\\\\')
await writeFile(join(profile, 'node_modules', '.modules.yaml'), '"virtualStoreDir": "' + virtualStoreDir + '"\n')
console.log('official add complete')
`
  await writeFile(join(appDirectory, 'fake-dsh-add.mjs'), fakeAdd)
  await writeFile(join(appDirectory, 'dsh.cmd'), [
    '@echo off',
    'echo add>>plugin-add-count.txt',
    `"${process.execPath}" "${join(appDirectory, 'fake-dsh-add.mjs')}" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n'))

  const script = resolve(root, 'launcher/seed-plugins.ps1')
  const firstCode = Number(runPowerShell(`
    . ${literal(script)} -Root ${literal(temp)} -LibraryOnly
    function Test-SeedOfficialProcess { return $false }
    $first = Invoke-SeedPlugins -Root ${literal(temp)}
    Write-Output $first
  `))
  const firstStatus = JSON.parse(await readFile(join(temp, 'data', 'launcher', 'seed-status.json'), 'utf8'))
  assert.equal(firstCode, 0, JSON.stringify(firstStatus))

  const seededPackage = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.equal(seededPackage.dependencies['test-plugin'], 'file:./seed/test-plugin-1.2.3.tgz')
  // Installed but off, the way the official Plugins page records it: a dependency outside profile bundles.
  assert.deepEqual(seededPackage.dsh.profile.bundles, ['official-base'])
  assert.deepEqual(await readFile(join(profile, 'seed', 'test-plugin-1.2.3.tgz')), archive)
  const seededLock = await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8')
  assert.match(seededLock, /specifier: file:\.\/seed\/test-plugin-1\.2\.3\.tgz/)
  assert.match(seededLock, /version: file:seed\/test-plugin-1\.2\.3\.tgz/)
  assert.doesNotMatch(seededLock, /specifier:\s*file:[A-Za-z]:\//i)
  const modulesMetadata = await readFile(join(profile, 'node_modules', '.modules.yaml'), 'utf8')
  assert.match(modulesMetadata, /"virtualStoreDir": "\.pnpm"/)
  const seededPatch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.equal(seededPatch, initialPatch, 'seeding no longer writes Cordis disable entries')
  const markerPath = join(temp, 'data', 'launcher', 'seeded.json')
  const marker = JSON.parse(await readFile(markerPath, 'utf8'))
  assert.deepEqual(marker.plugins.map(item => item.nameVersion), ['test-plugin@1.2.3'])
  assert.equal(JSON.parse(await readFile(join(temp, 'data', 'launcher', 'seed-status.json'), 'utf8')).status, 'complete')

  // Simulate an intentional later uninstall and enablement choice: a recorded name is never replayed.
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['official-base'] } } }))
  await writeFile(join(profile, 'cordis.patch.yml'), seededPatch + '- id: user-choice\n  disabled: false\n')
  await rm(join(profile, 'node_modules', 'test-plugin'), { recursive: true, force: true })
  runPowerShell(`. ${literal(script)} -Root ${literal(temp)} -LibraryOnly; function Test-SeedOfficialProcess { return $false }; $second = Invoke-SeedPlugins -Root ${literal(temp)}; if ($second -ne 0) { throw "second seed failed with $second" }`)

  const afterPackage = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.deepEqual(afterPackage.dependencies, {})
  assert.deepEqual(afterPackage.dsh.profile.bundles, ['official-base'])
  assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), seededPatch + '- id: user-choice\n  disabled: false\n')
  await assert.rejects(readFile(join(profile, 'node_modules', 'test-plugin', 'package.json')))
  assert.equal((await readFile(join(profile, 'plugin-add-count.txt'), 'utf8')).trim(), 'add')
})

test('a failed plugin add restores package, patch, and pre-existing node_modules', { skip: !onWindows }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'official-seed-rollback-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const profile = join(temp, 'data', 'dsh-home', 'profiles', 'desktop')
  const seedDirectory = join(temp, 'launcher', 'seed')
  const appDirectory = join(temp, 'app', '0.2.0-rc.2', 'resources', 'runtime', 'cli', 'bin')
  await mkdir(join(profile, 'node_modules', '.pnpm'), { recursive: true })
  await mkdir(join(profile, 'node_modules', 'test-plugin'), { recursive: true })
  await mkdir(seedDirectory, { recursive: true })
  await mkdir(appDirectory, { recursive: true })
  const archive = testPluginArchive()
  const packageFile = 'test-plugin-1.2.3.tgz'
  await writeFile(join(seedDirectory, packageFile), archive)
  await writeFile(join(seedDirectory, 'seed.json'), JSON.stringify({
    schemaVersion: 1,
    plugins: [{ name: 'test-plugin', file: packageFile, entryId: 'test-plugin-entry', sha512: createHash('sha512').update(archive).digest('hex') }],
  }))
  await writeFile(join(temp, 'app', 'current.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
  const originalPackage = '{"dependencies":{"test-plugin":"file:old.tgz"},"dsh":{"profile":{"bundles":["official-base"]}}}\n'
  const originalPatch = '# retain me\n- id: another-entry\n  disabled: false\n'
  await writeFile(join(profile, 'package.json'), originalPackage)
  await writeFile(join(profile, 'cordis.patch.yml'), originalPatch)
  const originalLock = "lockfileVersion: '9.0'\nimporters: {}\n"
  await writeFile(join(profile, 'pnpm-lock.yaml'), originalLock)
  const originalModules = '"virtualStoreDir": ".pnpm"\n'
  await writeFile(join(profile, 'node_modules', '.modules.yaml'), originalModules)
  await writeFile(join(profile, 'node_modules', 'test-plugin', 'package.json'), '{"name":"test-plugin","version":"0.9.0"}')
  await writeFile(join(profile, 'node_modules', '.pnpm', 'original.txt'), 'keep')
  await writeFile(join(profile, 'node_modules', 'untouched.txt'), 'keep')
  await writeFile(join(appDirectory, 'dsh.cmd'), [
    '@echo off',
    'echo add>>plugin-add-count.txt',
    'mkdir node_modules\\test-plugin',
    'echo partial>node_modules\\test-plugin\\package.json',
    'mkdir node_modules\\new-dependency',
    'mkdir node_modules\\.pnpm\\new-partial',
    '>pnpm-lock.yaml echo partial lock',
    '>node_modules\\.modules.yaml echo partial modules',
    'exit /b 7',
    '',
  ].join('\r\n'))

  const script = resolve(root, 'launcher/seed-plugins.ps1')
  const result = Number(runPowerShell(`. ${literal(script)} -Root ${literal(temp)} -LibraryOnly; function Test-SeedOfficialProcess { return $false }; Invoke-SeedPlugins -Root ${literal(temp)}`))
  assert.equal(result, 1)
  assert.equal(await readFile(join(profile, 'package.json'), 'utf8'), originalPackage)
  assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), originalPatch)
  assert.equal(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8'), originalLock)
  assert.equal(await readFile(join(profile, 'node_modules', '.modules.yaml'), 'utf8'), originalModules)
  assert.equal(await readFile(join(profile, 'node_modules', 'test-plugin', 'package.json'), 'utf8'), '{"name":"test-plugin","version":"0.9.0"}')
  assert.equal(await readFile(join(profile, 'node_modules', '.pnpm', 'original.txt'), 'utf8'), 'keep')
  assert.equal(await readFile(join(profile, 'node_modules', 'untouched.txt'), 'utf8'), 'keep')
  await assert.rejects(readFile(join(profile, 'node_modules', 'new-dependency')))
  await assert.rejects(readFile(join(profile, 'node_modules', '.pnpm', 'new-partial')))
  await assert.rejects(readFile(join(profile, 'seed', 'test-plugin-1.2.3.tgz')))
  await assert.rejects(readFile(join(temp, 'data', 'launcher', 'seeded.json')))
  const status = JSON.parse(await readFile(join(temp, 'data', 'launcher', 'seed-status.json'), 'utf8'))
  assert.equal(status.plugins[0].status, 'failed')
  assert.match(status.plugins[0].error, /exit code 7/)
})

test('packaging gates all seed payload changes on the optional SeedPlugin parameter', async () => {
  const packageScript = await readFile(resolve(root, 'experiments/official-payload/package-pure.ps1'), 'utf8')
  assert.match(packageScript, /\[string\[\]\]\$SeedPlugin=@\(\)/)
  assert.match(packageScript, /if \(\$SeedPlugin\.Count -gt 0\)[\s\S]+New-SeedManifest/)
  assert.match(packageScript, /if \(\$null -ne \$seedManifest\)[\s\S]+seed\.json[\s\S]+seed-plugins\.ps1/)
})

test('the official first-run patch file (header comments plus an empty list) stays valid YAML after seeding', { skip: !onWindows }, () => {
  const module = resolve(root, 'experiments/official-payload/seed-plugins-core.psm1')
  const output = runPowerShell(`
    Import-Module ${literal(module)} -Force
    $official = ([string]::Join([char]10, @('# Your patch layer for this dsh profile, applied after every bundle layer:', '# a top-level YAML array of load overrides, disables, and inserts.', '[]')) + [char]10)
    $one = Merge-SeedCordisPatch -Content $official -EntryId 'first-entry'
    $two = Merge-SeedCordisPatch -Content $one.content -EntryId 'second-entry'
    $crlf = Merge-SeedCordisPatch -Content ($official.Replace([string][char]10, [string][char]13 + [char]10)) -EntryId 'first-entry'
    [ordered]@{ one=$one.content; two=$two.content; crlf=$crlf.content } | ConvertTo-Json -Compress
  `)
  const result = JSON.parse(output.split(/\r?\n/).at(-1))
  assert.equal(result.two, '# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of load overrides, disables, and inserts.\n- id: first-entry\n  disabled: true\n- id: second-entry\n  disabled: true\n')
  assert.doesNotMatch(result.one, /^\[\]/m)
  assert.doesNotMatch(result.crlf, /^\[\]/m)
  const requireApp = createRequire(new URL('../app/package.json', import.meta.url))
  const parsed = requireApp('js-yaml').load(result.two)
  assert.deepEqual(parsed, [{ id: 'first-entry', disabled: true }, { id: 'second-entry', disabled: true }])
})
