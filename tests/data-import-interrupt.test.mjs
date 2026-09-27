import assert from 'node:assert/strict'
import { execFile, fork } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createDataArchive } from '../launcher/data-transfer.mjs'
import { recoverInterruptedImport } from '../launcher/data-import-journal.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

const moduleUrl = name => pathToFileURL(path.resolve('launcher', name)).href

async function killImport(t, phase) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-hard-kill-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = layoutForRoot(path.join(root, 'source'), process.platform)
  const target = layoutForRoot(path.join(root, 'target'), process.platform)
  for (const [layout, value] of [[source, 'new'], [target, 'original']]) {
    await mkdir(path.join(layout.dshHome, 'profiles/web/node_modules'), { recursive: true })
    await writeFile(path.join(layout.dshHome, 'settings.yaml'), `locale: ${value}\n`)
    await writeFile(path.join(layout.dataDir, 'launcher-settings.json'), JSON.stringify({ value }))
    await writeFile(path.join(layout.dshHome, 'profiles/web/node_modules/retained'), value)
  }
  const archive = path.join(root, 'data.dshdata')
  await createDataArchive(source, archive, { categories: ['settings'] })
  const childFile = path.join(root, 'child.mjs')
  await writeFile(childFile, `
    import { restoreDataArchive } from ${JSON.stringify(moduleUrl('data-transfer.mjs'))};
    import { layoutForRoot } from ${JSON.stringify(moduleUrl('portable-core.mjs'))};
    import { mkdir, writeFile } from 'node:fs/promises';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import path from 'node:path';
    const layout = layoutForRoot(${JSON.stringify(target.root)}, process.platform);
    function stop(phase) {
      if (phase !== ${JSON.stringify(phase)}) return;
      process.send({ phase }, () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));
      return new Promise(() => {});
    }
    if (${JSON.stringify(phase)} === 'partial-write') {
      const originalOpen = fs.open;
      fs.open = async (filename, ...args) => {
        const handle = await originalOpen(filename, ...args);
        if (path.dirname(filename) === layout.dshHome && path.basename(filename).startsWith('.dsh-data-')) {
          const write = handle.writeFile.bind(handle);
          handle.writeFile = async bytes => { await write(bytes.subarray(0, 3)); await stop('partial-write'); };
        }
        return handle;
      };
      syncBuiltinESMExports();
    }
    await restoreDataArchive(layout, ${JSON.stringify(archive)}, {
      conflict: 'replace',
      trace: phase => { if (phase === ${JSON.stringify(phase)}) {
        // Synchronous stop keeps the importer exactly at the durable boundary.
        process.send({ phase });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      } },
      validate: async ({ transaction }) => {
        const generated = path.join(layout.dshHome, 'profiles/web/node_modules');
        await transaction.prepareGeneratedPath(generated);
        await mkdir(generated);
        await writeFile(path.join(generated, 'partial'), 'incomplete dependency output');
        if (${JSON.stringify(phase)} === 'live-worker') {
          const script = 'require("node:fs").writeFileSync(' + JSON.stringify(path.join(layout.dataDir, 'worker-started')) + ', String(process.pid)); setTimeout(() => {}, 1500)';
          await transaction.run(process.execPath, ['-e', script], { timeout: 5000 });
        }
        await stop('dependencies');
      }
    });
    process.exit(3);
  `)
  const child = fork(childFile, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  const closed = once(child, 'exit')
  const reached = phase === 'live-worker' ? (async () => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        if (Number(await readFile(path.join(target.dataDir, 'worker-started'), 'utf8')) > 0) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Dependency worker was not registered');
  })() : once(child, 'message').then(([message]) => assert.equal(message.phase, phase))
  await Promise.race([
    reached,
    closed.then(() => { throw new Error(`Importer exited before ${phase}: ${stderr}`) }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Importer did not reach kill boundary')), 10000); timer.unref() }),
  ])
  child.kill('SIGKILL')
  await closed
  return { root, target }
}

for (const phase of ['import-backup-written', 'import-plan-ready', 'partial-write', 'import-file-written', 'dependencies', 'commit-begin', 'commit-recorded']) {
  test(`hard-killed import at ${phase} recovers after moving the folder and is idempotent`, async t => {
    const { root, target } = await killImport(t, phase)
    const moved = path.join(root, 'moved-target')
    await rename(target.root, moved)
    const layout = layoutForRoot(moved, process.platform)
    const result = await recoverInterruptedImport(layout)
    const committed = phase === 'commit-recorded'
    assert.equal(result.status, committed ? 'committed' : 'recovered')
    assert.equal(await readFile(path.join(layout.dshHome, 'settings.yaml'), 'utf8'), `locale: ${committed ? 'new' : 'original'}\n`)
    assert.equal(JSON.parse(await readFile(path.join(layout.dataDir, 'launcher-settings.json'), 'utf8')).value, committed ? 'new' : 'original')
    if (!committed) assert.equal(await readFile(path.join(layout.dshHome, 'profiles/web/node_modules/retained'), 'utf8'), 'original')
    assert.deepEqual(await recoverInterruptedImport(layout), { status: 'none' })
    assert.equal((await readdir(layout.dataDir, { recursive: true })).some(item => item.endsWith('.tmp')), false)
  })
}

test('reentry recognizes a backup already renamed during interrupted rollback', async t => {
  const { target } = await killImport(t, 'dependencies')
  const journal = JSON.parse(await readFile(path.join(target.dataDir, 'runtime/data-import.json'), 'utf8'))
  const entry = journal.entries.find(item => item.kind === 'generated')
  await rm(path.join(target.stateRoot, entry.path), { recursive: true })
  await rename(path.join(target.stateRoot, entry.backup), path.join(target.stateRoot, entry.path))
  assert.equal((await recoverInterruptedImport(target)).status, 'recovered')
  assert.equal(await readFile(path.join(target.dshHome, 'profiles/web/node_modules/retained'), 'utf8'), 'original')
})

test('missing backup blocks reentry without removing imported files', async t => {
  const { target } = await killImport(t, 'dependencies')
  const journal = JSON.parse(await readFile(path.join(target.dataDir, 'runtime/data-import.json'), 'utf8'))
  const entry = journal.entries.find(item => item.kind === 'file')
  await rm(path.join(target.stateRoot, entry.backup))
  await assert.rejects(recoverInterruptedImport(target), { code: 'DSH_DATA_IMPORT_BACKUP_MISSING' })
  assert.equal(await readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: new\n')
  assert.equal(JSON.parse(await readFile(path.join(target.dataDir, 'runtime/data-import.json'), 'utf8')).phase, 'active')
})

test('interrupted import cannot roll back while its real dependency child is still writing', async t => {
  const { target } = await killImport(t, 'live-worker')
  const dependencyPid = Number(await readFile(path.join(target.dataDir, 'worker-started'), 'utf8'))
  let dependencyAlive = false
  try { process.kill(dependencyPid, 0); dependencyAlive = true } catch (error) { assert.equal(error.code, 'ESRCH') }
  if (!dependencyAlive) {
    // Windows can close the entire inherited hidden process job with the
    // importer. In that case recovery need not wait for a nonexistent writer.
    assert.equal((await recoverInterruptedImport(target)).status, 'recovered')
    assert.equal(await readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: original\n')
    return
  }
  await assert.rejects(recoverInterruptedImport(target), { code: 'DSH_DATA_IMPORT_WORKER_ACTIVE' })
  assert.equal(await readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: new\n')
  const deadline = Date.now() + 7000
  for (;;) {
    try { assert.equal((await recoverInterruptedImport(target)).status, 'recovered'); break }
    catch (error) {
      if (error.code !== 'DSH_DATA_IMPORT_WORKER_ACTIVE' || Date.now() > deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  assert.equal(await readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: original\n')
})

test('the actual repair CLI recovers an interrupted import even with an incomplete runtime', async t => {
  const { target } = await killImport(t, 'dependencies')
  const { stdout } = await promisify(execFile)(process.execPath, [path.resolve('launcher/portable-cli.mjs'), 'repair', '--json'], {
    windowsHide: true, timeout: 15000,
    env: { ...process.env, DSH_PORTABLE_STATE_ROOT: target.root, DSH_PORTABLE_RUNTIME_ROOT: target.root, DSH_PORTABLE_ENVIRONMENT: 'default' },
  }).catch(error => { assert.equal(error.code, 1); return error })
  const result = JSON.parse(stdout.trim())
  assert.equal(result.dataImportRecovery.status, 'recovered')
  assert.equal(result.needsFullPackage, true)
  assert.equal(await readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: original\n')
})

test('recovery does not overwrite user edits made after an interrupted import', async t => {
  const { target } = await killImport(t, 'dependencies')
  const settings = path.join(target.dshHome, 'settings.yaml')
  await writeFile(settings, 'locale: user-edited\n')
  await assert.rejects(recoverInterruptedImport(target), { code: 'DSH_DATA_IMPORT_RECOVERY_REQUIRED' })
  assert.equal(await readFile(settings, 'utf8'), 'locale: user-edited\n')
  assert.equal(JSON.parse(await readFile(path.join(target.dataDir, 'launcher-settings.json'), 'utf8')).value, 'new')
})

test('the shipped recovery entry restores data before attempting a missing capsule', async t => {
  const { target } = await killImport(t, 'dependencies')
  await mkdir(path.join(target.root, 'launcher'))
  for (const name of await readdir(path.resolve('launcher'))) {
    if (name.endsWith('.mjs')) await cp(path.resolve('launcher', name), path.join(target.root, 'launcher', name))
  }
  await writeFile(path.join(target.root, 'runtime-capsule.json'), JSON.stringify({ schemaVersion: 1, filename: 'runtime/missing.dshpack' }))
  await promisify(execFile)(process.execPath, [path.join(target.root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', 'repair', '--json'], {
    windowsHide: true, timeout: 15000,
    env: { ...process.env, DSH_PORTABLE_STATE_ROOT: target.root, DSH_PORTABLE_RUNTIME_ROOT: target.root,
      DSH_PORTABLE_ENVIRONMENT: 'default', DSH_PORTABLE_RUNTIME_CACHE: path.join(target.root, 'private-cache') },
  }).catch(error => { assert.equal(error.code, 1); return error })
  assert.equal(await readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: original\n')
  await assert.rejects(readFile(path.join(target.dataDir, 'runtime/data-import.json')), { code: 'ENOENT' })
})

test('an official profile lock blocks interrupted recovery without touching its owner or data', async t => {
  const { target } = await killImport(t, 'dependencies')
  const lock = path.join(target.dshHome, 'profiles/web/package.json.lock')
  await writeFile(lock, 'official writer')
  await assert.rejects(recoverInterruptedImport(target), { code: 'DSH_DATA_IMPORT_PROFILE_BUSY' })
  assert.equal(await readFile(lock, 'utf8'), 'official writer')
  assert.equal(await readFile(path.join(target.dshHome, 'settings.yaml'), 'utf8'), 'locale: new\n')
  await rm(lock)
  assert.equal((await recoverInterruptedImport(target)).status, 'recovered')
})

test('backup CLI cannot export a half-imported environment', async t => {
  const { root, target } = await killImport(t, 'dependencies')
  const output = path.join(root, 'should-not-exist.dshdata')
  await assert.rejects(promisify(execFile)(process.execPath, [path.resolve('launcher/portable-cli.mjs'), 'backup-data', '--output', output, '--json'], {
    windowsHide: true, timeout: 15000,
    env: { ...process.env, DSH_PORTABLE_STATE_ROOT: target.root, DSH_PORTABLE_RUNTIME_ROOT: target.root, DSH_PORTABLE_ENVIRONMENT: 'default' },
  }), error => error.code === 1 && `${error.stdout}${error.stderr}`.includes('DSH_DATA_IMPORT_RECOVERY_REQUIRED'))
  await assert.rejects(readFile(output), { code: 'ENOENT' })
})

test('a reused worker PID belonging to an unrelated process does not block recovery', async t => {
  const { target } = await killImport(t, 'dependencies')
  const filename = path.join(target.dataDir, 'runtime/data-import.json')
  const journal = JSON.parse(await readFile(filename, 'utf8'))
  journal.workers.push({ pid: process.pid, token: 'abcdef0123456789abcdef0123456789' })
  await writeFile(filename, JSON.stringify(journal))
  assert.equal((await recoverInterruptedImport(target)).status, 'recovered')
})
