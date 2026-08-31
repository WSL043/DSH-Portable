import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function runtimeNode(root) {
  return process.platform === 'win32'
    ? path.join(root, 'runtime', 'node', 'node.exe')
    : path.join(root, 'runtime', 'node', 'bin', 'node')
}

async function sha256(filename) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest('hex')
}

async function buildRollbackProbe(archive, manifest) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-rollback-'))
  const source = path.join(temporary, 'component')
  const probeArchive = path.join(temporary, 'rollback-component.zip')
  await mkdir(source, { recursive: true })
  if (process.platform === 'win32') {
    await execFileAsync('tar.exe', ['-x', '-f', archive, '-C', source])
  } else if (process.platform === 'darwin') {
    await execFileAsync('ditto', ['-x', '-k', archive, source])
  } else {
    await execFileAsync('unzip', ['-q', archive, '-d', source])
  }

  const portableVersion = '9999.0.0-rollback.1'
  const dshVersion = `${manifest.component.dshVersion}-rollback-probe`
  const componentFile = path.join(source, 'component.json')
  const componentsFile = path.join(source, 'licenses', 'COMPONENTS.json')
  const component = JSON.parse(await readFile(componentFile, 'utf8'))
  const components = JSON.parse(await readFile(componentsFile, 'utf8'))
  component.portableVersion = portableVersion
  component.dshVersion = dshVersion
  components.portableVersion = portableVersion
  components.dshVersion = dshVersion
  await writeFile(componentFile, `${JSON.stringify(component, null, 2)}\n`)
  await writeFile(componentsFile, `${JSON.stringify(components, null, 2)}\n`)

  if (process.platform === 'win32') {
    await execFileAsync('tar.exe', ['-a', '-c', '-f', probeArchive, '-C', source, '.'])
  } else if (process.platform === 'darwin') {
    await execFileAsync('ditto', ['-c', '-k', '--norsrc', source, probeArchive])
  } else {
    await execFileAsync('zip', ['-q', '-y', '-r', probeArchive, '.'], { cwd: source })
  }
  const probeManifest = structuredClone(manifest)
  probeManifest.portableVersion = portableVersion
  probeManifest.component.dshVersion = dshVersion
  probeManifest.component.bytes = (await stat(probeArchive)).size
  probeManifest.component.sha256 = await sha256(probeArchive)
  return { temporary, archive: probeArchive, manifest: probeManifest }
}

async function main() {
  const [rootValue, manifestFile, archive] = process.argv.slice(2)
  if (!rootValue || !manifestFile || !archive) {
    throw new Error('Usage: node scripts/smoke-update-artifact.mjs <portable-root> <manifest.json> <component.zip>')
  }
  const root = path.resolve(rootValue)
  const cli = path.join(root, 'launcher', 'portable-cli.mjs')
  const node = runtimeNode(root)
  const capsule = await access(path.join(root, 'runtime-capsule.json')).then(() => true, () => false)
  const cliPrefix = capsule
    ? [path.join(root, 'launcher', 'runtime-entry.mjs'), 'portable-cli.mjs']
    : [cli]
  const installedFile = path.join(root, 'licenses', 'COMPONENTS.json')
  const installed = JSON.parse(await readFile(installedFile, 'utf8'))
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  assert.equal(installed.platform, manifest.platform)
  assert.equal(installed.nodeVersion, manifest.component.requiredNodeVersion)

  installed.portableVersion = '0.0.0'
  await writeFile(installedFile, `${JSON.stringify(installed, null, 2)}\n`)

  const sentinels = [
    [path.join(root, 'data', 'update-smoke-session.txt'), 'session survives'],
    [path.join(root, 'workspace', 'update-smoke-workspace.txt'), 'workspace survives'],
    [path.join(root, 'data', 'dsh-home', 'update-smoke-config.txt'), 'config survives'],
  ]
  for (const [filename, content] of sentinels) {
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }

  let origin
  const localManifest = structuredClone(manifest)
  const rollbackProbe = await buildRollbackProbe(archive, manifest)
  const server = http.createServer((request, response) => {
    if (request.url === '/manifest.json') {
      const body = Buffer.from(JSON.stringify(localManifest))
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length }).end(body)
      return
    }
    if (request.url === '/component.zip') {
      const stream = createReadStream(archive)
      stream.on('error', (error) => response.destroy(error))
      response.writeHead(200, { 'content-type': 'application/zip', 'content-length': manifest.component.bytes })
      stream.pipe(response)
      return
    }
    if (request.url === '/rollback-manifest.json') {
      const body = Buffer.from(JSON.stringify(rollbackProbe.manifest))
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length }).end(body)
      return
    }
    if (request.url === '/rollback-component.zip') {
      const stream = createReadStream(rollbackProbe.archive)
      stream.on('error', (error) => response.destroy(error))
      response.writeHead(200, { 'content-type': 'application/zip', 'content-length': rollbackProbe.manifest.component.bytes })
      stream.pipe(response)
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  localManifest.component.urls = [`${origin}/component.zip`]
  rollbackProbe.manifest.component.urls = [`${origin}/rollback-component.zip`]

  try {
    const updated = await execFileAsync(node, [
      ...cliPrefix,
      'update',
      '--json',
      '--no-browser',
      '--force',
      '--allow-http',
      '--update-manifest',
      `${origin}/manifest.json`,
    ], { encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const result = JSON.parse(updated.stdout.trim())
    assert.equal(result.status, 'updated')
    assert.equal(result.portableVersion, manifest.portableVersion)
    assert.equal(result.dshVersion, manifest.component.dshVersion)
    assert.equal(result.running?.status, 'running')
    const status = JSON.parse((await execFileAsync(node, [...cliPrefix, 'status', '--json'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    })).stdout.trim())
    assert.equal(status.status, 'running')
    const after = JSON.parse(await readFile(installedFile, 'utf8'))
    assert.equal(after.portableVersion, manifest.portableVersion)
    for (const [filename, content] of sentinels) assert.equal(await readFile(filename, 'utf8'), content)

    let rollbackDiagnostic = ''
    try {
      await execFileAsync(node, [
        ...cliPrefix,
        'update',
        '--json',
        '--no-browser',
        '--force',
        '--allow-http',
        '--update-manifest',
        `${origin}/rollback-manifest.json`,
      ], { encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
      assert.fail('The rollback probe unexpectedly succeeded.')
    } catch (error) {
      rollbackDiagnostic = `${error?.stderr ?? ''}\n${error?.stdout ?? ''}`
      const rollbackError = JSON.parse(rollbackDiagnostic.trim().split(/\r?\n/).filter(Boolean).at(-1))
      assert.equal(rollbackError.type, 'portable-error')
      assert.equal(rollbackError.code, 'UPDATE_ROLLED_BACK')
      assert.doesNotMatch(rollbackDiagnostic, /(?:token|authorization|cookie)=/i)
    }
    const rollbackStatus = JSON.parse((await execFileAsync(node, [...cliPrefix, 'status', '--json'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    })).stdout.trim())
    assert.equal(rollbackStatus.status, 'running')
    const afterRollback = JSON.parse(await readFile(installedFile, 'utf8'))
    assert.equal(afterRollback.portableVersion, manifest.portableVersion)
    assert.equal(afterRollback.dshVersion, manifest.component.dshVersion)
    for (const [filename, content] of sentinels) assert.equal(await readFile(filename, 'utf8'), content)
    const deferred = JSON.parse((await execFileAsync(node, [
      ...cliPrefix,
      'check-update',
      '--json',
      '--allow-http',
      '--update-manifest',
      `${origin}/rollback-manifest.json`,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true })).stdout.trim())
    assert.equal(deferred.status, 'deferred')
    const rollbackVerified = true
    process.stdout.write(`${JSON.stringify({
      status: 'verified',
      portableVersion: result.portableVersion,
      dshVersion: result.dshVersion,
      preserved: sentinels.length,
      rollbackVerified,
    })}\n`)
  } finally {
    await execFileAsync(node, [...cliPrefix, 'stop', '--json'], { encoding: 'utf8', timeout: 30000, windowsHide: true }).catch(() => {})
    await new Promise((resolve) => server.close(resolve))
    await rm(rollbackProbe.temporary, { recursive: true, force: true })
  }
}

await main()
