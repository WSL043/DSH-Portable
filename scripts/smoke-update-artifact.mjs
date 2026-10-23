import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { readLogTail, redactDiagnosticText } from '../launcher/diagnostic-policy.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

const execFileAsync = promisify(execFile)

function diagnosticText(value) {
  const withoutCredentials = String(value).split('\n').map(line =>
    /control.?token|cookie|authorization/i.test(line) ? '[credential-bearing log line omitted]' : line).join('\n')
  return redactDiagnosticText(withoutCredentials).replace(/https?:\/\/[^\s"'<>]+/gi, source => {
    try { const url = new URL(source); return `${url.origin}${url.pathname}` } catch { return '[URL]' }
  })
}

function diagnosticScalar(value) {
  return typeof value === 'string' ? diagnosticText(value).slice(0, 512)
    : typeof value === 'number' || typeof value === 'boolean' ? value : undefined
}

function statusEvidence(value) {
  return {
    status: diagnosticScalar(value?.status),
    pid: Number.isSafeInteger(value?.pid) ? value.pid : undefined,
    port: Number.isSafeInteger(value?.port) ? value.port : undefined,
    urlPresent: typeof value?.url === 'string',
  }
}

// One later, first-response observation, not a retry of the failed product check or an acceptance gate.
function observeHttp(target) {
  const started = Date.now()
  let url
  try { url = new URL(target) } catch { return Promise.resolve({ skipped: 'no-url' }) }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return Promise.resolve({ skipped: 'non-loopback-url' })
  return new Promise(resolve => {
    let settled = false
    let timer
    const finish = fields => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ at: new Date().toISOString(), elapsedMs: Date.now() - started, timeoutMs: 1200, firstResponseOnly: true, ...fields })
    }
    // Match status()'s initial request path: preserve the one-use access token by omitting URL search/hash.
    const request = http.get({ hostname: url.hostname, port: url.port || 80, path: url.pathname || '/', timeout: 1200 }, response => {
      const statusCode = response.statusCode
      response.resume()
      response.once('end', () => finish({ statusCode }))
      response.once('aborted', () => finish({ statusCode, errorCode: 'RESPONSE_ABORTED' }))
      response.once('error', error => finish({ statusCode, errorCode: error.code || 'RESPONSE_ERROR' }))
    })
    request.once('timeout', () => { finish({ timedOut: true }); request.destroy() })
    request.once('error', error => finish({ errorCode: error.code || 'REQUEST_ERROR' }))
    timer = setTimeout(() => { finish({ timedOut: true }); request.destroy() }, 1200)
  })
}

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

  const portableVersion = manifest.updateKind === 'engine' ? manifest.portableVersion : '9999.0.0-rollback.1'
  const dshVersion = manifest.updateKind === 'engine' ? '9999.0.0-alpha.1' : `${manifest.component.dshVersion}-rollback-probe`
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
  const engine = manifest.updateKind === 'engine'
  const scopeArgs = engine ? ['--scope', 'engine', '--channel', manifest.releaseChannel] : []
  assert.equal(installed.platform, manifest.platform)
  assert.equal(installed.nodeVersion, manifest.component.requiredNodeVersion)

  // A core that names a shell contract is accepted by any shell with that contract. Present the installation as an
  // older Portable with a different fingerprint and expect the update to keep that identity.
  const contractCore = engine && manifest.requiredShellContract != null
  const skewedPortableVersion = '0.0.1'
  if (engine) {
    if (contractCore) {
      assert.equal(installed.shellContract, manifest.requiredShellContract, 'core must target this shell contract')
      installed.portableVersion = skewedPortableVersion
      installed.shellFingerprint = 'f'.repeat(64)
    } else {
      assert.equal(installed.portableVersion, manifest.portableVersion, 'core must target this exact product')
      assert.equal(installed.shellFingerprint, manifest.requiredShellFingerprint, 'core must target this exact shell')
    }
    // A same-version stable build exercises reinstallation; candidate builds keep the real prior core version.
    if (installed.dshVersion === manifest.component.dshVersion) installed.dshVersion = '0.0.0'
  } else installed.portableVersion = '0.0.0'
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

  const diagnosticLayout = layoutForRoot(root)
  const evidenceFile = path.join(diagnosticLayout.logsDir, 'update-smoke-evidence.json')
  const started = Date.now()
  const evidence = { schemaVersion: 1, status: 'running', phases: [] }
  let phase = 'setup'
  const checkpoint = async (next, fields = {}) => {
    phase = next
    evidence.phases.push({ phase, at: new Date().toISOString(), elapsedMs: Date.now() - started, ...fields })
    // Diagnostic I/O must not turn a product failure into a different exception or prevent normal cleanup.
    await mkdir(path.dirname(evidenceFile), { recursive: true }).then(() =>
      writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)).catch(() => {})
  }
  try {
    await checkpoint('baseline')
    let originalDependencies
    const profileManifestFile = path.join(root, 'data', 'dsh-home', 'profiles', 'web', 'package.json')
    if (engine) {
      const baseline = JSON.parse((await execFileAsync(node, [...cliPrefix, 'start', '--json', '--no-browser'], {
        encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      })).stdout.trim())
      assert.equal(baseline.status, 'started', 'start the previous core before upgrading')
      const baselineStatus = JSON.parse((await execFileAsync(node, [...cliPrefix, 'status', '--json'], {
        encoding: 'utf8', timeout: 30000, windowsHide: true,
      })).stdout.trim())
      assert.equal(baselineStatus.status, 'running', 'the previous core must be healthy before upgrading')
      originalDependencies = JSON.parse(await readFile(profileManifestFile, 'utf8')).dependencies
      for (const plugin of installed.defaultPlugins ?? []) {
        assert.equal(originalDependencies?.[plugin.package], plugin.version, 'baseline includes the reviewed default plugins')
      }
    }
    await checkpoint('apply-update')
    const updated = await execFileAsync(node, [
      ...cliPrefix,
      'update',
      ...scopeArgs,
      '--json',
      '--no-browser',
      '--force',
      '--allow-http',
      '--update-manifest',
      `${origin}/manifest.json`,
    ], { encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const result = JSON.parse(updated.stdout.trim())
    await checkpoint('update-returned', { result: {
      status: diagnosticScalar(result.status), portableVersion: diagnosticScalar(result.portableVersion),
      dshVersion: diagnosticScalar(result.dshVersion), cleanupPending: diagnosticScalar(result.cleanupPending),
      running: statusEvidence(result.running),
    } })
    assert.equal(result.status, 'updated')
    assert.equal(result.portableVersion, contractCore ? skewedPortableVersion : manifest.portableVersion)
    assert.equal(result.dshVersion, manifest.component.dshVersion)
    assert.equal(result.running?.status, 'running')
    await checkpoint('post-update-status')
    const status = JSON.parse((await execFileAsync(node, [...cliPrefix, 'status', '--json'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    })).stdout.trim())
    assert.equal(status.status, 'running')
    const after = JSON.parse(await readFile(installedFile, 'utf8'))
    assert.equal(after.portableVersion, contractCore ? skewedPortableVersion : manifest.portableVersion)
    if (contractCore) {
      assert.equal(after.shellFingerprint, 'f'.repeat(64), 'a core update keeps the installed shell fingerprint')
      assert.equal(after.shellContract, manifest.requiredShellContract)
    }
    if (engine) {
      assert.deepEqual(JSON.parse(await readFile(profileManifestFile, 'utf8')).dependencies, originalDependencies,
        'core upgrade preserves the installed plugin dependencies')
      const response = await fetch(new URL('/dsh-market/installed', status.url), { signal: AbortSignal.timeout(15000) })
      assert.equal(response.ok, true, 'plugin management remains available after core upgrade')
      const plugins = await response.json()
      for (const plugin of installed.defaultPlugins ?? []) {
        assert.ok(JSON.stringify(plugins.installed).includes(plugin.package), `${plugin.package} remains installed`)
      }
      const commandProbe = await execFileAsync(node, ['--input-type=module', '-e', `
        import path from 'node:path';
        import { pathToFileURL } from 'node:url';
        const root = process.argv[1];
        const { ensureRuntimeCapsule } = await import(pathToFileURL(path.join(root, 'launcher/runtime-capsule.mjs')));
        const prepared = await ensureRuntimeCapsule(root);
        const { default: Runtime } = await import(pathToFileURL(path.join(prepared.runtimeRoot, 'app/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js')));
        const runtime = new Runtime({ reflect: { provide: () => {} }, effect: () => () => {}, logger: { warn: message => console.error(message), debug: () => {}, info: () => {}, error: message => console.error(message) } });
        const handle = runtime.spawn({ argv: [process.execPath, '-e', 'process.stdout.write("portable-core-command-ok")'], cwd: root,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } }, graceMs: 1000 });
        const outcome = await handle.done;
        if (outcome.exitCode !== 0 || handle.collected.stdout.finalize().text !== 'portable-core-command-ok') throw new Error('Core subprocess execution failed');
        console.log('portable-core-command-ok');
      `, root], { encoding: 'utf8', timeout: 30000, windowsHide: true })
      if (commandProbe.stderr) process.stderr.write(commandProbe.stderr)
      assert.equal(commandProbe.stdout.trim(), 'portable-core-command-ok', 'updated core executes a real command')
    }
    for (const [filename, content] of sentinels) assert.equal(await readFile(filename, 'utf8'), content)

    await checkpoint('rollback-update')
    let rollbackDiagnostic = ''
    try {
      await execFileAsync(node, [
        ...cliPrefix,
        'update',
        ...scopeArgs,
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
      assert.equal(rollbackError.code, 'UPDATE_ROLLED_BACK', JSON.stringify(rollbackError))
      assert.doesNotMatch(rollbackDiagnostic, /(?:token|authorization|cookie)=/i)
    }
    await checkpoint('rollback-status')
    const rollbackStatus = JSON.parse((await execFileAsync(node, [...cliPrefix, 'status', '--json'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    })).stdout.trim())
    assert.equal(rollbackStatus.status, 'running')
    const afterRollback = JSON.parse(await readFile(installedFile, 'utf8'))
    assert.equal(afterRollback.portableVersion, contractCore ? skewedPortableVersion : manifest.portableVersion)
    assert.equal(afterRollback.dshVersion, manifest.component.dshVersion)
    if (engine) assert.deepEqual(JSON.parse(await readFile(profileManifestFile, 'utf8')).dependencies, originalDependencies)
    for (const [filename, content] of sentinels) assert.equal(await readFile(filename, 'utf8'), content)
    await checkpoint('check-deferred')
    const deferred = JSON.parse((await execFileAsync(node, [
      ...cliPrefix,
      'check-update',
      ...scopeArgs,
      '--json',
      '--allow-http',
      '--update-manifest',
      `${origin}/rollback-manifest.json`,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true })).stdout.trim())
    assert.equal(deferred.status, 'deferred')
    const rollbackVerified = true
    evidence.status = 'verified'
    await checkpoint('verified')
    process.stdout.write(`${JSON.stringify({
      status: 'verified',
      portableVersion: result.portableVersion,
      dshVersion: result.dshVersion,
      preserved: sentinels.length,
      rollbackVerified,
    })}\n`)
  } catch (error) {
    evidence.status = 'failed'
    evidence.failure = {
      phase, name: diagnosticScalar(error?.name), code: diagnosticScalar(error?.code),
      actual: diagnosticScalar(error?.actual), expected: diagnosticScalar(error?.expected),
    }
    // Observe before finally stops the fixture. These later observations never replace the original assertion.
    await checkpoint('failure')
    try {
      const readJson = async filename => readFile(filename, 'utf8').then(text => ({ value: JSON.parse(text) }))
        .catch(readError => ({ errorCode: readError.code || readError.name }))
      const processRead = await readJson(diagnosticLayout.processState)
      const journalRead = await readJson(diagnosticLayout.updateJournal)
      const componentsRead = await readJson(installedFile)
      const state = processRead.value
      evidence.beforeStop = {
        at: new Date().toISOString(),
        process: { ...statusEvidence(state), startedAt: diagnosticScalar(state?.startedAt), errorCode: processRead.errorCode },
        journal: { present: Boolean(journalRead.value), phase: diagnosticScalar(journalRead.value?.phase), errorCode: journalRead.errorCode },
        installed: { portableVersion: diagnosticScalar(componentsRead.value?.portableVersion),
          dshVersion: diagnosticScalar(componentsRead.value?.dshVersion), errorCode: componentsRead.errorCode },
      }
      try {
        const observed = await execFileAsync(node, [...cliPrefix, 'status', '--json'], {
          encoding: 'utf8', timeout: 30000, windowsHide: true,
        })
        evidence.beforeStop.status = statusEvidence(JSON.parse(observed.stdout.trim()))
      } catch (statusError) { evidence.beforeStop.status = { errorCode: diagnosticScalar(statusError?.code || statusError?.name) } }
      evidence.beforeStop.http = await observeHttp(state?.url)
      evidence.beforeStop.logTails = {}
      for (const name of ['launcher.log', 'startup-latest.jsonl', 'dsh.stdout.log', 'dsh.stderr.log', 'portable-errors.jsonl']) {
        try { evidence.beforeStop.logTails[name] = diagnosticText(readLogTail(path.join(diagnosticLayout.logsDir, name), 8192)) }
        catch (logError) { evidence.beforeStop.logTails[name] = { errorCode: logError.code || 'LOG_READ_FAILED' } }
      }
      await checkpoint('failure-observed-before-stop')
    } catch (diagnosticError) {
      evidence.diagnosticError = diagnosticScalar(diagnosticError?.code || diagnosticError?.name)
      await checkpoint('failure-evidence-incomplete')
    }
    throw error
  } finally {
    await execFileAsync(node, [...cliPrefix, 'stop', '--json'], { encoding: 'utf8', timeout: 30000, windowsHide: true }).catch(() => {})
    await new Promise((resolve) => server.close(resolve))
    await rm(rollbackProbe.temporary, { recursive: true, force: true })
  }
}

await main()
