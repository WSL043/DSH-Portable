import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

import {
  acquireLaunchLock,
  browserLaunchSpec,
  buildDshEnv,
  isOwnedDshProcess,
  isOwnedLauncherProcess,
  layoutForRoot,
  migratePortableRoot,
  parseCli,
  projectKey,
  queryWindowsProcess,
} from '../launcher/portable-core.mjs'

const usbRoot = path.win32.resolve('R:\\AI Tools\\深度求索 Harness')

test('all durable application paths stay under the movable root', () => {
  const layout = layoutForRoot(usbRoot, 'win32')
  for (const [name, value] of Object.entries(layout)) {
    if (name === 'root' || name === 'platform') continue
    const relative = path.win32.relative(usbRoot, value)
    assert.equal(path.win32.isAbsolute(relative), false, name)
    assert.equal(relative.startsWith('..'), false, `${name}: ${relative}`)
  }
  assert.equal(layout.dshHome, path.win32.join(usbRoot, 'data', 'dsh-home'))
  assert.equal(layout.browserProfile, path.win32.join(usbRoot, 'data', 'browser'))
  assert.equal(layout.workspace, path.win32.join(usbRoot, 'workspace'))
})

test('macOS layout keeps its runtime and state inside the movable root', () => {
  const macRoot = '/Volumes/Portable Disk/DSH-Portable'
  const layout = layoutForRoot(macRoot, 'darwin')
  assert.equal(layout.nodeExe, path.posix.join(macRoot, 'runtime', 'node', 'bin', 'node'))
  assert.equal(layout.dshHome, path.posix.join(macRoot, 'data', 'dsh-home'))
  assert.equal(layout.browserProfile, path.posix.join(macRoot, 'data', 'browser'))
  assert.equal(layout.workspace, path.posix.join(macRoot, 'workspace'))
})

test('installed mode keeps executable files separate from durable user state', () => {
  const layout = layoutForRoot(
    '/Applications/DeepSeek-Herness.app/Contents/Resources',
    'darwin',
    '/Users/example/Library/Application Support/DeepSeek-Herness',
  )
  assert.equal(layout.nodeExe, '/Applications/DeepSeek-Herness.app/Contents/Resources/runtime/node/bin/node')
  assert.equal(layout.dshBin, '/Applications/DeepSeek-Herness.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js')
  assert.equal(layout.dataDir, '/Users/example/Library/Application Support/DeepSeek-Herness/data')
  assert.equal(layout.workspace, '/Users/example/Library/Application Support/DeepSeek-Herness/workspace')
  assert.equal(layout.stateRoot, '/Users/example/Library/Application Support/DeepSeek-Herness')
})

test('DSH receives only root-relative state and the official runtime entry', () => {
  const layout = layoutForRoot(usbRoot)
  const env = buildDshEnv(layout, { PATH: 'C:\\Windows\\System32' })
  assert.equal(env.DSH_HOME, layout.dshHome)
  assert.equal(env.DSH_TELEMETRY_MODE, 'DISABLED')
  assert.equal(env.DSH_PORTABLE, '1')
  assert.equal(env.PATH.startsWith(layout.nodeDir), true)
  assert.match(layout.dshBin, /app[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/)
})

test('browser app profile moves with the portable folder', () => {
  const layout = layoutForRoot(usbRoot)
  const executable = path.win32.join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  const spec = browserLaunchSpec(executable, 'http://127.0.0.1:3080', layout)
  assert.equal(spec.command, executable)
  assert.ok(spec.args.includes('--app=http://127.0.0.1:3080'))
  assert.ok(spec.args.includes(`--user-data-dir=${layout.browserProfile}`))
  assert.ok(spec.args.includes('--no-first-run'))
})

test('CLI defaults to start and supports bounded automation flags', () => {
  assert.deepEqual(parseCli([]), { command: 'start', noBrowser: false, json: false })
  assert.deepEqual(parseCli(['start', '--no-browser', '--json']), {
    command: 'start',
    noBrowser: true,
    json: true,
  })
  assert.throws(() => parseCli(['start', 'stop']), /more than one command/)
  assert.throws(() => parseCli(['erase-data']), /Unknown command/)
})

test('a stale or recycled PID is never treated as our DSH host', () => {
  const layout = layoutForRoot(usbRoot, 'win32')
  const expected = {
    executablePath: layout.nodeExe,
    commandLine: `\"${layout.nodeExe}\" \"${layout.hostBin}\" \"${layout.dshBin}\" web --host 127.0.0.1 --port 31234`,
  }
  assert.equal(isOwnedDshProcess(expected, layout, 31234), true)
  assert.equal(isOwnedDshProcess({ ...expected, executablePath: 'C:\\Windows\\System32\\notepad.exe' }, layout, 31234), false)
  assert.equal(isOwnedDshProcess({ ...expected, commandLine: 'node unrelated.js' }, layout, 31234), false)
})

test('macOS ownership uses the complete portable host command, not PID existence alone', () => {
  const layout = layoutForRoot('/Volumes/USB/DSH-Portable', 'darwin')
  const expected = {
    executablePath: layout.nodeExe,
    commandLine: `${layout.nodeExe} ${layout.hostBin} ${layout.dshBin} web --host 127.0.0.1 --port 31234`,
  }
  assert.equal(isOwnedDshProcess(expected, layout, 31234), true)
  assert.equal(isOwnedDshProcess({ ...expected, commandLine: `${layout.nodeExe} unrelated.mjs --port 31234` }, layout, 31234), false)
})

test('Windows process inspection preserves Unicode command-line paths', { skip: process.platform !== 'win32' }, async (t) => {
  const marker = 'USB 移动 后 DSH'
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)', marker], {
    stdio: 'ignore',
    windowsHide: true,
  })
  t.after(() => child.kill())
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  const info = queryWindowsProcess(child.pid)
  assert.ok(info)
  assert.match(info.commandLine, new RegExp(marker))
})

test('Windows process ownership treats short and long path aliases as the same files', { skip: process.platform !== 'win32' }, () => {
  const projectRoot = path.resolve(import.meta.dirname, '..')
  const longPaths = {
    nodeExe: realpathSync.native(process.execPath),
    hostBin: realpathSync.native(path.join(projectRoot, 'launcher', 'portable-host.mjs')),
    dshBin: realpathSync.native(path.join(projectRoot, 'package.json')),
    portableCli: realpathSync.native(path.join(projectRoot, 'launcher', 'portable-cli.mjs')),
  }
  const shortPath = (filename) => execFileSync('cmd.exe', [
    '/d', '/c', `for %I in ("${filename}") do @echo %~sI`,
  ], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true }).trim()
  const layout = {
    platform: 'win32',
    nodeExe: shortPath(longPaths.nodeExe),
    hostBin: shortPath(longPaths.hostBin),
    dshBin: shortPath(longPaths.dshBin),
    portableCli: shortPath(longPaths.portableCli),
  }
  assert.ok(Object.keys(longPaths).some((name) => layout[name].toLowerCase() !== longPaths[name].toLowerCase()))
  assert.equal(isOwnedDshProcess({
    executablePath: longPaths.nodeExe,
    commandLine: `"${longPaths.nodeExe}" "${longPaths.hostBin}" "${longPaths.dshBin}" web --port 31234`,
  }, layout, 31234), true)
  assert.equal(isOwnedLauncherProcess({
    executablePath: longPaths.nodeExe,
    commandLine: `"${longPaths.nodeExe}" "${longPaths.portableCli}" start`,
  }, layout), true)
  assert.equal(isOwnedLauncherProcess({
    executablePath: longPaths.nodeExe,
    commandLine: `"${longPaths.nodeExe}" "${longPaths.portableCli}" start`,
  }, { ...layout, portableCli: '' }), false)
})

test('launcher reclaims a dead lock but never bypasses a live owned launcher', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-lock-'))
  const layout = layoutForRoot(root)
  await mkdir(layout.stateDir, { recursive: true })
  await writeFile(layout.launchLock, '424242\n')

  const release = await acquireLaunchLock(layout, {
    processQuery: () => null,
    pidExists: () => false,
  })
  assert.equal(Number((await readFile(layout.launchLock, 'utf8')).trim()), process.pid)
  await release()

  await writeFile(layout.launchLock, '515151\n')
  await assert.rejects(
    acquireLaunchLock(layout, {
      processQuery: () => ({
        executablePath: layout.nodeExe,
        commandLine: `"${layout.nodeExe}" "${layout.portableCli}" start`,
      }),
      pidExists: () => true,
    }),
    /already starting or stopping/,
  )
})

test('moving the whole folder migrates only its owned workspace references', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh portable 移动 '))
  const firstRoot = path.join(parent, 'first location')
  const movedRoot = path.join(parent, 'USB location')
  const first = layoutForRoot(firstRoot)
  await mkdir(path.join(first.dshHome, 'storages'), { recursive: true })
  await mkdir(first.workspace, { recursive: true })
  await writeFile(first.portableMeta, `${JSON.stringify({ schemaVersion: 1, lastRoot: first.root, workspace: first.workspace })}\n`)
  await writeFile(path.join(first.dshHome, 'storages', 'workspace.json'), JSON.stringify({
    tables: {
      workspaces: {
        portable: { path: first.workspace },
        external: { path: 'C:\\External Project' },
      },
    },
  }))

  const sessionDir = path.join(first.dshHome, 'sessions', projectKey(first.workspace), 'session-one')
  await mkdir(sessionDir, { recursive: true })
  const sessionBytes = Buffer.from(`${JSON.stringify({ type: 'session', version: 1, id: 'session-one', createdAt: 1, cwd: first.workspace, delegationDepth: 0 })}\n${JSON.stringify({ type: 'event', text: first.workspace })}\n`)
  await writeFile(path.join(sessionDir, 'session.jsonl.zstd'), zstdCompressSync(sessionBytes))

  await rename(firstRoot, movedRoot)
  const moved = layoutForRoot(movedRoot)
  const result = await migratePortableRoot(moved)
  assert.deepEqual(result, { moved: true, sessionCount: 1, storageCount: 1 })

  const workspaceStore = JSON.parse(await readFile(path.join(moved.dshHome, 'storages', 'workspace.json'), 'utf8'))
  assert.equal(workspaceStore.tables.workspaces.portable.path, moved.workspace)
  assert.equal(workspaceStore.tables.workspaces.external.path, 'C:\\External Project')

  const migratedFile = path.join(moved.dshHome, 'sessions', projectKey(moved.workspace), 'session-one', 'session.jsonl.zstd')
  const decoded = zstdDecompressSync(await readFile(migratedFile)).toString('utf8').trim().split('\n').map(JSON.parse)
  assert.equal(decoded[0].cwd, moved.workspace)
  assert.equal(decoded[1].text, first.workspace, 'historical message content is not rewritten')
})
