import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
} else if (args.includes('web')) {
  const port = Number(args[args.indexOf('--port') + 1])
  const server = http.createServer((_request, response) => response.end('DSH ${version}'))
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
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
  await writeFile(bridgePatch, '- insert: []\n')
  await writeFile(path.join(path.dirname(bridgePatch), 'package.json'), '{"name":"@wsl043/dsh-portable-desktop-bridge"}\n')
  await writeFile(path.join(source, 'app', 'package.json'), '{"name":"updated-fixture"}\n')
  await writeFile(path.join(source, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
    product: 'DSH-Portable',
    portableVersion,
    platform: platformUpdateKey(),
    dshVersion: version,
    dshCommit: 'b'.repeat(40),
    updaterSchema: 1,
    shellSchema: 1,
    nodeVersion: process.versions.node,
  })}\n`)
  await writeFile(path.join(source, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'updated license\n')
  await writeFile(path.join(source, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'updated notices\n')
  await writeFile(path.join(source, 'licenses', 'pnpm-LICENSE.txt'), 'updated pnpm license\n')
  await writeFile(path.join(source, 'component.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'dsh-app',
    portableVersion,
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

test('portable CLI upgrades the app component, health-checks it, and leaves DSH running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh update cli 中文 '))
  let componentBuildRoot
  let server
  try {
    const runtimeNode = process.platform === 'win32'
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
    await copyFile(process.execPath, runtimeNode)
    for (const name of ['portable-core.mjs', 'portable-cli.mjs', 'portable-host.mjs', 'update-core.mjs']) {
      await copyFile(path.join(projectRoot, 'launcher', name), path.join(root, 'launcher', name))
    }
    if (process.platform === 'win32') await compileUpdateExtractor(path.join(root, 'launcher', 'DSH-UpdateExtractor.exe'))
    await writeFile(oldDsh, fakeDsh('0.1.0-rc.6'))
    await writeFile(oldBridgePatch, '- insert: []\n')
    await writeFile(path.join(path.dirname(oldBridgePatch), 'package.json'), '{"name":"@wsl043/dsh-portable-desktop-bridge"}\n')
    await writeFile(path.join(root, 'app', 'package.json'), '{"name":"old-fixture"}\n')
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      product: 'DSH-Portable',
      portableVersion: '0.1.0-rc.6-portable.5',
      platform: platformUpdateKey(),
      dshVersion: '0.1.0-rc.6',
      dshCommit: 'a'.repeat(40),
      updaterSchema: 1,
      shellSchema: 1,
      nodeVersion: process.versions.node,
    })}\n`)
    await writeFile(path.join(root, 'data', 'private-session.txt'), 'keep me')

    const portableVersion = '0.1.0-rc.7-portable.1'
    const componentBuild = await makeComponentArchive(root, '0.1.0-rc.7', portableVersion)
    const archive = componentBuild.archive
    componentBuildRoot = componentBuild.buildRoot
    const archiveBytes = await readFile(archive)
    let origin
    server = http.createServer((request, response) => {
      if (request.url === '/update.json') {
        const body = Buffer.from(JSON.stringify({
          schemaVersion: 1,
          portableVersion,
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
        response.writeHead(200, { 'content-length': archiveBytes.length }).end(archiveBytes)
      } else response.writeHead(404).end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`

    const cli = path.join(root, 'launcher', 'portable-cli.mjs')
    const updated = await execFileAsync(runtimeNode, [cli, 'update', '--json', '--no-browser', '--force', '--allow-http', '--update-manifest', `${origin}/update.json`], {
      timeout: 60000,
      windowsHide: true,
    })
    const result = JSON.parse(updated.stdout.trim())
    assert.equal(result.status, 'updated')
    assert.equal(result.dshVersion, '0.1.0-rc.7')
    assert.equal(JSON.parse(await readFile(path.join(root, 'licenses', 'COMPONENTS.json'), 'utf8')).portableVersion, portableVersion)
    assert.equal(await readFile(path.join(root, 'data', 'private-session.txt'), 'utf8'), 'keep me')

    const status = JSON.parse((await execFileAsync(runtimeNode, [cli, 'status', '--json'], { windowsHide: true })).stdout.trim())
    assert.equal(status.status, 'running')
    await execFileAsync(runtimeNode, [cli, 'stop', '--json'], { timeout: 30000, windowsHide: true })
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (componentBuildRoot) await rm(componentBuildRoot, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})
