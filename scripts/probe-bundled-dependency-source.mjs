// Ephemeral source-build feasibility probe; does not authorize publication.
await (async function dependencyProbe() {
  const fs = await import('node:fs/promises');
  const fss = await import('node:fs');
  const cp = await import('node:child_process');
  const util = await import('node:util');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const http = await import('node:http');
  const assert = (await import('node:assert/strict')).default;
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({ options: { source: { type: 'string' }, pnpm: { type: 'string' }, output: { type: 'string' } } });
  const source = path.resolve(values.source), cli = path.resolve(values.pnpm), output = path.resolve(values.output);
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This source-build probe runs only in ephemeral CI');
  process.env.PATH = path.resolve(path.dirname(cli), '../../.bin') + path.delimiter + process.env.PATH;
  process.env.npm_config_enable_global_virtual_store = 'false';
  await fs.mkdir(output, { recursive: true });
  const report = { passed: false, sourceCommit: '8e1e4c0aaece387dfda16377b2ba31f7a1a2602c', originalVersion: '11.11.0', changes: [], commands: [] };
  const sha = async p => crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
  function run(exe, args, cwd, name) {
    const log = path.join(output, `${name}.log`), fd = fss.openSync(log, 'wx');
    try {
      cp.execFileSync(exe, args, { cwd, windowsHide: true, shell: false, timeout: 20 * 60 * 1000,
        env: { ...process.env, npm_config_manage_package_manager_versions: 'false', npm_config_package_manager_strict_version: 'false' },
        stdio: ['ignore', fd, fd] });
      report.commands.push({ name, passed: true });
    } catch (error) { report.commands.push({ name, passed: false, status: error.status }); throw error; }
    finally { fss.closeSync(fd); }
  }
  try {
    const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', windowsHide: true, shell: false }).trim();
    assert.equal(commit, report.sourceCommit);
    const rootFile = path.join(source, 'package.json'), workspace = path.join(source, 'pnpm-workspace.yaml');
    const before = await fs.readFile(rootFile, 'utf8'), manifest = JSON.parse(before);
    report.inputHashes = Object.fromEntries(await Promise.all(['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'].map(async n => [n, await sha(path.join(source, n))])));
    manifest.packageManager = 'pnpm@11.11.0';
    delete manifest.devEngines; // Build policy only: keep the explicitly selected patched Node, no automatic runtime download.
    await fs.writeFile(rootFile, JSON.stringify(manifest, null, 2) + '\n');
    const originalYaml = await fs.readFile(workspace, 'utf8');
    const overrides = "  'undici@>=6 <6.29.1': '6.29.1'\n  'undici@>=7 <7.30.1': '7.30.1'\n  'undici@>=8 <8.12.2': '8.12.2'\n";
    const anchors = originalYaml.match(/^overrides:\r?$/gm) ?? [];
    assert.ok(anchors.length <= 1, 'Ambiguous overrides');
    let yaml = anchors.length ? originalYaml.replace(/^overrides:\r?\n/m, `overrides:\n${overrides}`) : originalYaml + `\noverrides:\n${overrides}`;
    assert.match(yaml, /^  undici: \^7\.27\.2$/m, 'Reviewed catalog identity');
    yaml = yaml.replace(/^  undici: \^7\.27\.2$/m, '  undici: 7.30.1');
    await fs.writeFile(workspace, yaml);
    report.changes = ['build package manager pinned to stock 11.11.0; automatic dev runtime selection disabled', 'Undici dependency ranges override to fixed original same-major packages'];
    run(process.execPath, [cli, 'install', '--filter=pnpm...', '--ignore-scripts', '--no-frozen-lockfile', '--config.enable-global-virtual-store=false'], source, 'install');
    report.resolvedLockSha256 = await sha(path.join(source, 'pnpm-lock.yaml'));
    const diff = cp.execFileSync('git', ['diff', '--', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'], { cwd: source, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: false });
    await fs.writeFile(path.join(output, 'dependency-input.diff'), diff);
    const compiler = JSON.parse(await fs.readFile(path.join(source, 'node_modules/@typescript/native-preview/package.json'), 'utf8'));
    const compilerBin = typeof compiler.bin === 'string' ? compiler.bin : compiler.bin.tsgo;
    run(process.execPath, [path.join(source, 'node_modules/@typescript/native-preview', compilerBin), '--build', 'pnpm11/pnpm'], source, 'compile');
    const pkg = path.join(source, 'pnpm11/pnpm');
    const packageIdentity = JSON.parse(await fs.readFile(path.join(pkg, 'package.json'), 'utf8'));
    process.env.npm_package_name = packageIdentity.name;
    process.env.npm_package_version = packageIdentity.version;
    run(process.execPath, [path.join(pkg, 'bundle.ts')], pkg, 'bundle');
    for (const [from, to] of [['node-gyp-bin', 'dist/node-gyp-bin'], ['node_modules/@pnpm/tabtab/lib/templates', 'dist/templates'], ['node_modules/ps-list/vendor', 'dist/vendor']]) {
      await fs.cp(path.join(pkg, from), path.join(pkg, to), { recursive: true });
    }
    await fs.copyFile(path.join(pkg, 'pnpmrc'), path.join(pkg, 'dist/pnpmrc'));
    run(process.execPath, [path.join(pkg, 'bin/pnpm.cjs'), '--version'], output, 'version');
    assert.match(await fs.readFile(path.join(output, 'version.log'), 'utf8'), /11\.11\.0/);
    const actualBundle = await fs.readFile(path.join(pkg, 'dist/pnpm.mjs'), 'utf8');
    report.inlineUndiciVersions = [...new Set([...actualBundle.matchAll(/undici(?:@|\/)([678]\.\d+\.\d+)(?:\/|_)/g)].map(m => m[1]))];
    assert.deepEqual(report.inlineUndiciVersions, ['7.30.1'], 'Actual source resolved into the bundle');
    report.outputHashes = {};
    for (const name of ['pnpm.mjs', 'worker.js']) {
      report.outputHashes[name] = await sha(path.join(pkg, 'dist', name));
      await fs.copyFile(path.join(pkg, 'dist', name), path.join(output, name));
    }
    const preload = path.join(output, 'observe-fetch.cjs');
    await fs.writeFile(preload, `const fs=require('node:fs');let calls=0,uncaught=0;const original=globalThis.fetch;globalThis.fetch=function(...args){calls++;return original.apply(this,args)};process.on('uncaughtExceptionMonitor',()=>{uncaught++});process.on('exit',code=>fs.writeFileSync(process.env.PROBE_OBSERVATION,JSON.stringify({calls,uncaught,code})));`);
    const cwd = path.join(output, 'consumer'); await fs.mkdir(cwd, { recursive: true });
    report.consumers = [];
    for (const mode of ['normal', 'malformed']) {
      const server = http.createServer((_request, response) => {
        if (mode === 'normal') {
          const body = JSON.stringify({ name: 'portable-security-probe', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'portable-security-probe', version: '1.0.0' } } });
          response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); response.end(body);
        } else {
          response.writeHead(200, { 'Content-Encoding': 'gzip, deflate, br, gzip, deflate, br', 'Content-Length': '1024', 'Connection': 'close' });
          response.end('x');
        }
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const observation = path.join(output, `${mode}-observation.json`);
      try {
        const args = ['--require', preload, path.join(pkg, 'bin/pnpm.cjs'), 'view', 'portable-security-probe', 'version', '--registry', `http://127.0.0.1:${server.address().port}`, '--config.fetch-retries=0'];
        let code = 0, stdout = '', stderr = '';
        try { ({ stdout, stderr } = await util.promisify(cp.execFile)(process.execPath, args, { cwd, env: { ...process.env, PROBE_OBSERVATION: observation, npm_config_manage_package_manager_versions: 'false' }, timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false })); }
        catch (error) { code = error.code; stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; }
        await fs.writeFile(path.join(output, `${mode}-consumer.log`), stdout + '\n' + stderr);
        const observed = JSON.parse(await fs.readFile(observation, 'utf8'));
        assert.equal(observed.calls, 0, 'Exercise the actual bundled fetch, not Node global fetch');
        assert.equal(observed.uncaught, 0, 'No unhandled stream error');
        if (mode === 'normal') { assert.equal(code, 0); assert.match(stdout, /1\.0\.0/); }
        else assert.equal(code, 1, 'Malformed registry response is a handled CLI failure');
        report.consumers.push({ mode, ...observed, handled: true });
      } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    }
    run(process.execPath, [path.join(pkg, 'bundle-deps.ts')], pkg, 'bundle-external-dependencies');
    const distributedUndici = JSON.parse(await fs.readFile(path.join(pkg, 'dist/node_modules/undici/package.json'), 'utf8'));
    assert.equal(distributedUndici.version, '6.29.1');
    report.distributedUndici = distributedUndici.version;
    const provenance = { format: 1, upstreamVersion: report.originalVersion, sourceCommit: report.sourceCommit, inputHashes: report.inputHashes, resolvedLockSha256: report.resolvedLockSha256, outputHashes: report.outputHashes, inlineUndiciVersions: report.inlineUndiciVersions, distributedUndici: report.distributedUndici };
    await fs.writeFile(path.join(pkg, 'dist/portable-source-build.json'), JSON.stringify(provenance, null, 2) + '\n');
    run(process.execPath, [cli, '--config.ignore-scripts=true', 'pack', '--pack-destination', output], pkg, 'pack');
    report.packageFile = (await fs.readdir(output)).find(name => name.endsWith('.tgz'));
    assert.ok(report.packageFile);
    report.packageSha256 = await sha(path.join(output, report.packageFile));
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
})();
