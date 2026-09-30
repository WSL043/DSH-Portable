import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { platformUpdateKey } from '../launcher/update-core.mjs'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')

async function compileUpdateExtractor(output) {
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  await execFileAsync(csc, [
    '/nologo', '/target:exe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
    `/out:${output}`,
    path.join(projectRoot, 'launcher', 'windows', 'DSH-UpdateExtractor.cs'),
  ])
}

function fakeDsh(version) {
  return `
import http from 'node:http'
const args = process.argv.slice(2)
if (args.includes('--version') || args.includes('-V')) {
  console.log(${JSON.stringify(version)})
} else if (args.includes('--dump-config')) {
  console.log('profile composed')
} else if (args.includes('web')) {
  const port = Number(args[args.indexOf('--port') + 1])
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body>DSH ${version}</body></html>')
  })
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  console.log('dsh web: http://127.0.0.1:' + port + '/')
} else {
  throw new Error('unexpected fake DSH command: ' + args.join(' '))
}
`.trimStart()
}

async function makeComponentArchive(root, version, portableVersion) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-component-'))
  const source = path.join(buildRoot, 'component-source')
  const dshBin = path.join(source, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const bridgePatch = path.join(source, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'cordis.patch.yml')
  await mkdir(path.dirname(dshBin), { recursive: true })
  await mkdir(path.dirname(bridgePatch), { recursive: true })
  await mkdir(path.join(source, 'licenses'), { recursive: true })
  await writeFile(dshBin, fakeDsh(version))
  await writeFile(path.join(path.dirname(path.dirname(dshBin)), 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh', version, dependencies: {},
  }))
  await writeFile(bridgePatch, '- insert: []\n')
  await writeFile(path.join(path.dirname(bridgePatch), 'package.json'), '{"name":"@wsl043/dsh-portable-desktop-bridge"}\n')
  await writeFile(path.join(source, 'app', 'package.json'), '{"name":"updated-fixture"}\n')
  const appBootDir = path.join(source, 'app', 'node_modules', '@deepseek-ai', 'dsh-app-boot')
  await mkdir(path.join(appBootDir, 'lib'), { recursive: true })
  await writeFile(path.join(appBootDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-app-boot',
    type: 'module',
    version,
    exports: './lib/index.js',
  })}\n`)
  await writeFile(path.join(appBootDir, 'lib', 'index.js'), [
    "import { readFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "export const PROFILE_COMPATIBILITY_FILENAME = 'compatibility.json';",
    "export function getDshRuntimeVersion() { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; }",
    'export function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {',
    "  if (!Object.hasOwn(manifest, 'peerDependencies')) return undefined;",
    '  const peers = Object.fromEntries(Object.entries(manifest.peerDependencies).filter(([name, range]) =>',
    "    (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) && range !== runtimeVersion));",
    '  if (Object.keys(peers).length === 0) return undefined;',
    "  const key = manifest.name + '@' + manifest.version;",
    '  return { name: manifest.name, version: manifest.version, runtimeVersion, peers, exempted: (exemptions[key] || []).includes(runtimeVersion) };',
    '}',
    'export function readProfileCompatibility(profileDir) {',
    '  try { return { exemptions: JSON.parse(readFileSync(path.join(profileDir, PROFILE_COMPATIBILITY_FILENAME), \'utf8\')) }; }',
    '  catch { return { exemptions: {} }; }',
    '}',
    "export function pluginCompatibilityWarning(issue) { return 'Plugin ' + issue.name + '@' + issue.version + ' is incompatible with dsh ' + issue.runtimeVersion + ': peerDependencies ' + JSON.stringify(issue.peers) + '. Running it may cause crashes or data loss. Exact-version exemption: ' + (issue.exempted ? 'active' : 'not active') + '.'; }",
  ].join('\n'))
  await writeFile(path.join(source, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
    product: 'DSH-Portable',
    portableVersion,
    releaseChannel: 'stable',
    platform: platformUpdateKey(),
    dshVersion: version,
    dshCommit: 'b'.repeat(40),
    updaterSchema: 1,
    shellSchema: 1,
    nodeVersion: process.versions.node,
    defaultPlugins: [],
  })}\n`)
  await writeFile(path.join(source, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'updated license\n')
  await writeFile(path.join(source, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'updated notices\n')
  await writeFile(path.join(source, 'licenses', 'dsh-market-LICENSE.txt'), 'updated market license\n')
  await writeFile(path.join(source, 'licenses', 'pnpm-LICENSE.txt'), 'updated pnpm license\n')
  await writeFile(path.join(source, 'component.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'dsh-app',
    portableVersion,
    releaseChannel: 'stable',
    dshVersion: version,
    dshCommit: 'b'.repeat(40),
  })}\n`)
  const archive = path.join(buildRoot, 'component.zip')
  if (process.platform === 'win32') {
    await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', source, '.'])
  } else if (process.platform === 'darwin') {
    await execFileAsync('ditto', ['-c', '-k', source, archive])
  } else {
    await execFileAsync('zip', ['-q', '-r', archive, '.'], { cwd: source })
  }
  return { archive, buildRoot }
}

test('legacy candidate Portable upgrades to the stable app component, health-checks it, and leaves DSH running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh update cli 中文 '))
  let componentBuildRoot
  let server
  let runtimeNode
  let cli
  try {
    runtimeNode = process.platform === 'win32'
      ? path.join(root, 'runtime', 'node', 'node.exe')
      : path.join(root, 'runtime', 'node', 'bin', 'node')
    const oldDsh = path.join(root, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const oldBridgePatch = path.join(root, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'cordis.patch.yml')
    await mkdir(path.dirname(runtimeNode), { recursive: true })
    await mkdir(path.dirname(oldDsh), { recursive: true })
    await mkdir(path.dirname(oldBridgePatch), { recursive: true })
    await mkdir(path.join(root, 'launcher'), { recursive: true })
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await mkdir(path.join(root, 'data'), { recursive: true })
    await mkdir(path.join(root, 'data', 'dsh-home', 'profiles', 'web'), { recursive: true })
    await copyFile(process.execPath, runtimeNode)
    for (const name of (await readdir(path.join(projectRoot, 'launcher'))).filter(name => name.endsWith('.mjs'))) {
      await copyFile(path.join(projectRoot, 'launcher', name), path.join(root, 'launcher', name))
    }
    if (process.platform === 'win32') await compileUpdateExtractor(path.join(root, 'launcher', 'DSH-UpdateExtractor.exe'))
    await writeFile(oldDsh, fakeDsh('0.1.0-rc.6'))
    await writeFile(path.join(path.dirname(path.dirname(oldDsh)), 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh', version: '0.1.0-rc.6', dependencies: {},
    }))
    await writeFile(oldBridgePatch, '- insert: []\n')
    await writeFile(path.join(path.dirname(oldBridgePatch), 'package.json'), '{"name":"@wsl043/dsh-portable-desktop-bridge"}\n')
    await writeFile(path.join(root, 'app', 'package.json'), '{"name":"old-fixture"}\n')
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      product: 'DSH-Portable',
      portableVersion: '0.1.0-rc.6-portable.5',
      releaseChannel: 'candidate',
      platform: platformUpdateKey(),
      dshVersion: '0.1.0-rc.6',
      dshCommit: 'a'.repeat(40),
      updaterSchema: 1,
      shellSchema: 1,
      nodeVersion: process.versions.node,
      defaultPlugins: [],
    })}\n`)
    await writeFile(path.join(root, 'data', 'private-session.txt'), 'keep me')
    const profileDir = path.join(root, 'data', 'dsh-home', 'profiles', 'web')
    await writeFile(path.join(profileDir, 'package.json'), `${JSON.stringify({ dependencies: { 'dsh-cli-fixture': '1.0.0' } })}\n`)
    await mkdir(path.join(profileDir, 'node_modules', 'dsh-cli-fixture'), { recursive: true })
    await writeFile(path.join(profileDir, 'node_modules', 'dsh-cli-fixture', 'package.json'), `${JSON.stringify({
      name: 'dsh-cli-fixture',
      version: '1.0.0',
      peerDependencies: { '@deepseek-ai/dsh': '^0.0.1' },
    })}\n`)

    const portableVersion = '0.1.0'
    const componentBuild = await makeComponentArchive(root, '0.1.0-rc.7', portableVersion)
    const archive = componentBuild.archive
    componentBuildRoot = componentBuild.buildRoot
    const archiveBytes = await readFile(archive)
    let origin
    let hostWasRunningWhenComponentDownloaded = false
    server = http.createServer((request, response) => {
      if (request.url === '/update.json') {
        const body = Buffer.from(JSON.stringify({
          schemaVersion: 1,
          portableVersion,
          releaseChannel: 'stable',
          platform: platformUpdateKey(),
          minimumUpdaterSchema: 1,
          requiredShellSchema: 1,
          component: {
            kind: 'dsh-app',
            dshVersion: '0.1.0-rc.7',
            dshCommit: 'b'.repeat(40),
            requiredNodeVersion: process.versions.node,
            bytes: archiveBytes.length,
            sha256: createHash('sha256').update(archiveBytes).digest('hex'),
            urls: [`${origin}/component.zip`],
          },
        }))
        response.writeHead(200, { 'content-length': body.length }).end(body)
      } else if (request.url === '/component.zip') {
        try {
          const state = JSON.parse(readFileSync(path.join(root, 'data', 'runtime', 'process.json'), 'utf8'))
          process.kill(state.pid, 0)
          hostWasRunningWhenComponentDownloaded = true
        } catch { /* assertion below reports a premature stop */ }
        response.writeHead(200, { 'content-length': archiveBytes.length }).end(archiveBytes)
      } else response.writeHead(404).end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`

    cli = path.join(root, 'launcher', 'portable-cli.mjs')
    const research = JSON.parse((await execFileAsync(runtimeNode, [cli, 'start', '--environment', 'research', '--no-browser', '--json'], {
      timeout: 30000,
      windowsHide: true,
    })).stdout.trim())
    assert.equal(research.environment, 'research')
    await assert.rejects(
      execFileAsync(runtimeNode, [cli, 'update', '--json', '--no-browser', '--force', '--allow-http', '--update-manifest', `${origin}/update.json`], {
        timeout: 30000,
        windowsHide: true,
      }),
      (error) => {
        const payload = JSON.parse(error.stderr.trim())
        return payload.type === 'portable-error' && payload.code === 'SHARED_COMPONENTS_BUSY'
      },
    )
    await execFileAsync(runtimeNode, [cli, 'stop', '--environment', 'research', '--no-browser', '--json'], {
      timeout: 30000,
      windowsHide: true,
    })
    const checkArgs = [cli, 'check-update', '--json', '--allow-http', '--update-manifest', `${origin}/update.json`]
    const checkStatus = async (extra = []) => JSON.parse((await execFileAsync(runtimeNode, [...checkArgs, ...extra], {
      timeout: 30000, windowsHide: true,
    })).stdout.trim()).status
    assert.equal(await checkStatus(['--force']), 'available')
    await execFileAsync(runtimeNode, [cli, 'defer-update', '--json'], { timeout: 30000, windowsHide: true })
    assert.equal(await checkStatus(), 'deferred', 'a manifest URL alone must not bypass deferred updates')
    assert.equal(await checkStatus(['--force']), 'available', 'an explicit user check can override deferral')
    await execFileAsync(runtimeNode, [cli, 'start', '--no-browser', '--json'], {
      timeout: 30000,
      windowsHide: true,
    })
    const updated = await execFileAsync(runtimeNode, [cli, 'update', '--json', '--progress-json', '--no-browser', '--force', '--allow-http', '--update-manifest', `${origin}/update.json`], {
      timeout: 60000,
      windowsHide: true,
    })
    const lines = updated.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))
    const progress = lines.filter((line) => line.type === 'update-progress')
    const result = lines.at(-1)
    assert.ok(progress.some((event) => event.phase === 'downloading' && event.percent === 100))
    assert.ok(progress.some((event) => event.phase === 'verifying'))
    assert.ok(progress.some((event) => event.phase === 'preflighting'))
    assert.ok(progress.some((event) => event.phase === 'installing'))
    const warnings = [{
      profile: 'web',
      plugin: 'dsh-cli-fixture',
      version: '1.0.0',
      row: 'dsh-cli-fixture',
      reason: 'Plugin dsh-cli-fixture@1.0.0 is incompatible with dsh 0.1.0-rc.7: peerDependencies {"@deepseek-ai/dsh":"^0.0.1"}. Running it may cause crashes or data loss. Exact-version exemption: not active.',
    }]
    assert.deepEqual(progress.find((event) => event.phase === 'complete').warnings, warnings)
    assert.equal(hostWasRunningWhenComponentDownloaded, true)
    assert.equal(result.status, 'updated')
    assert.equal(result.dshVersion, '0.1.0-rc.7')
    assert.deepEqual(result.warnings, warnings)
    assert.equal(JSON.parse(await readFile(path.join(root, 'licenses', 'COMPONENTS.json'), 'utf8')).portableVersion, portableVersion)
    assert.equal(await readFile(path.join(root, 'data', 'private-session.txt'), 'utf8'), 'keep me')

    const status = JSON.parse((await execFileAsync(runtimeNode, [cli, 'status', '--json'], { windowsHide: true })).stdout.trim())
    assert.equal(status.status, 'running')
    await execFileAsync(runtimeNode, [cli, 'stop', '--json'], { timeout: 30000, windowsHide: true })
  } finally {
    if (runtimeNode && cli) {
      await execFileAsync(runtimeNode, [cli, 'stop', '--json'], { timeout: 30000, windowsHide: true }).catch(() => {})
    }
    server?.closeAllConnections?.()
    if (server) await new Promise((resolve) => server.close(resolve))
    if (componentBuildRoot) await rm(componentBuildRoot, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})
