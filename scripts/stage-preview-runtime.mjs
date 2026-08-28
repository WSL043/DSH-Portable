import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.error?.message || result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function readPackedManifest(tarball) {
  return JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']))
}

async function sha256(filename) {
  const bytes = await readFile(filename)
  return createHash('sha256').update(bytes).digest('hex')
}

function npmCliFromRuntime(explicit) {
  if (explicit) return path.resolve(explicit)
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(path.dirname(process.execPath)), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  const candidate = candidates.find((filename) => existsSync(filename))
  if (!candidate) throw new Error(`npm CLI not found; pass --npm-cli. Checked:\n${candidates.join('\n')}`)
  return candidate
}

export async function inventoryPackedRuntime({ packedRoot, lock }) {
  const families = [
    ['dsh', 'npm'],
    ['vendor', 'npm-vendor'],
    ['landlock', 'npm-landlock'],
  ]
  const packages = []
  for (const [family, directoryName] of families) {
    const directory = path.join(packedRoot, directoryName)
    const filenames = (await readdir(directory)).filter((name) => name.endsWith('.tgz')).sort()
    assert.equal(filenames.length, lock.dsh.packedFamilies[family], `${family} packed package count`)
    for (const filename of filenames) {
      const tarball = path.join(directory, filename)
      const manifest = readPackedManifest(tarball)
      assert.match(manifest.name ?? '', /^@deepseek-ai\//, `${filename} package scope`)
      if (family === 'dsh') assert.equal(manifest.version, lock.dsh.version, `${manifest.name} preview version`)
      packages.push({ family, filename, tarball, name: manifest.name, version: manifest.version, manifest, sha256: await sha256(tarball) })
    }
  }
  const byName = new Map(packages.map((entry) => [entry.name, entry]))
  assert.equal(byName.size, packages.length, 'packed package names must be unique')
  assert.equal(byName.get(lock.dsh.package)?.version, lock.dsh.version, 'preview entry package')
  return packages
}

export function productionPackageClosure(packages, entryName) {
  const byName = new Map(packages.map((entry) => [entry.name, entry]))
  assert.equal(byName.has(entryName), true, `preview entry package is missing: ${entryName}`)
  const selected = new Map()
  const pending = [entryName]
  while (pending.length > 0) {
    const name = pending.pop()
    if (selected.has(name)) continue
    const entry = byName.get(name)
    if (!entry) continue
    selected.set(name, entry)
    const manifest = entry.manifest ?? {}
    const peerMeta = manifest.peerDependenciesMeta ?? {}
    const required = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}).filter((dependency) => peerMeta[dependency]?.optional !== true),
    ])
    for (const dependency of required) {
      if (byName.has(dependency) && !selected.has(dependency)) pending.push(dependency)
    }
  }
  return [...selected.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function stagePreviewRuntime({ packedRoot, output, npmCli }) {
  const [lock, stableLock] = await Promise.all([
    readFile(path.join(root, 'upstream.preview.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'upstream.lock.json'), 'utf8').then(JSON.parse),
  ])
  const packages = await inventoryPackedRuntime({ packedRoot, lock })
  const runtimePackages = productionPackageClosure(packages, lock.dsh.package)
  await rm(output, { recursive: true, force: true })
  await mkdir(path.join(output, 'vendor'), { recursive: true })
  const sourceFilter = (source) => !source.split(path.sep).includes('node_modules')
  await cp(path.join(root, 'desktop-bridge'), path.join(output, 'desktop-bridge'), { recursive: true, filter: sourceFilter })
  await cp(
    path.join(root, 'app', 'vendor', 'dsh-portable-plugin-market'),
    path.join(output, 'vendor', 'dsh-portable-plugin-market'),
    { recursive: true, filter: sourceFilter },
  )

  // The official dist directory also contains development fixtures and
  // separately installable providers. A normal npm install starts at the DSH
  // entry package and follows production dependencies; mirror that contract
  // instead of turning every packed tarball into a product dependency.
  const dependencies = Object.fromEntries(runtimePackages.map((entry) => [entry.name, pathToFileURL(entry.tarball).href]))
  dependencies['@wsl043/dsh-portable-desktop-bridge'] = 'file:desktop-bridge'
  dependencies[stableLock.pluginMarket.package] = 'file:vendor/dsh-portable-plugin-market'
  dependencies[stableLock.pnpm.package] = stableLock.pnpm.version
  const manifest = {
    name: 'deepseek-harness-portable-preview-runtime',
    version: lock.dsh.version,
    private: true,
    license: 'Apache-2.0',
    dependencies,
  }
  await writeFile(path.join(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const cli = npmCliFromRuntime(npmCli)
  run(process.execPath, [cli, 'install', '--no-audit', '--no-fund', '--install-links'], {
    cwd: output,
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
      DSH_TELEMETRY_DISABLED: '1',
    },
    timeout: 30 * 60 * 1000,
  })

  const installed = JSON.parse(await readFile(path.join(output, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  assert.equal(installed.version, lock.dsh.version, 'installed preview entry version')
  const runtimeManifest = {
    name: manifest.name,
    version: manifest.version,
    private: true,
    license: manifest.license,
    dependencies: {
      [lock.dsh.package]: lock.dsh.version,
      '@wsl043/dsh-portable-desktop-bridge': 'file:desktop-bridge',
      [stableLock.pluginMarket.package]: 'file:vendor/dsh-portable-plugin-market',
      [stableLock.pnpm.package]: stableLock.pnpm.version,
    },
  }
  await writeFile(path.join(output, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8')
  await rm(path.join(output, 'package-lock.json'), { force: true })
  const aggregate = createHash('sha256')
  for (const entry of packages) aggregate.update(`${entry.family}\0${entry.name}\0${entry.version}\0${entry.sha256}\n`)
  const receipt = {
    schemaVersion: 1,
    channel: lock.channel,
    dshVersion: lock.dsh.version,
    dshCommit: lock.dsh.reviewedCommit,
    packageCount: packages.length,
    runtimePackageCount: runtimePackages.length,
    packageSetSha256: aggregate.digest('hex'),
    packages: packages.map(({ family, name, version, sha256: digest }) => ({ family, name, version, sha256: digest })),
  }
  await writeFile(path.join(output, 'preview-runtime.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  return receipt
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'packed-root': { type: 'string' },
      output: { type: 'string' },
      'npm-cli': { type: 'string' },
    },
  })
  if (!values['packed-root'] || !values.output) {
    throw new Error('usage: node scripts/stage-preview-runtime.mjs --packed-root <dist> --output <app> [--npm-cli <npm-cli.js>]')
  }
  const receipt = await stagePreviewRuntime({
    packedRoot: path.resolve(values['packed-root']),
    output: path.resolve(values.output),
    npmCli: values['npm-cli'],
  })
  console.log(JSON.stringify(receipt, null, 2))
}
