import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

import {
  acquireLaunchLock,
  acquireLaunchLockWithWait,
  browserLaunchSpec,
  buildDshEnv,
  clearPortableMoveLinks,
  ensureManagedProfileModuleFallback,
  isOwnedPortableBrowserProcess,
  isOwnedDshProcess,
  isOwnedLauncherProcess,
  layoutForRoot,
  migratePortableRoot,
  parseCli,
  projectKey,
  queryPosixBrowserProcesses,
  queryWindowsBrowserProcesses,
  queryWindowsProcess,
  repairManagedProfileModuleFallback,
} from '../launcher/portable-core.mjs'

test('Windows task cleanup suppresses localized taskkill output', async () => {
  const cli = await readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
  const taskkillCalls = [...cli.matchAll(/execFileSync\('taskkill\.exe',[\s\S]*?\}\)/g)].map((match) => match[0])
  assert.ok(taskkillCalls.length >= 3)
  for (const call of taskkillCalls) {
    assert.match(call, /stdio:\s*'ignore'/)
    assert.doesNotMatch(call, /encoding:\s*'utf8'/)
  }
})

test('startup records bounded phase timings without making diagnostics a launch dependency', async () => {
  const [cli, runtimeEntry, host] = await Promise.all([
    readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../launcher/runtime-entry.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../launcher/portable-host.mjs', import.meta.url), 'utf8'),
  ])
  for (const phase of [
    'runtime-verified',
    'profile-resolver-ready',
    'desktop-bridge-ready',
    'default-plugins-ready',
    'host-spawned',
    'host-ready',
    'complete',
    'failed',
  ]) assert.match(cli, new RegExp(`startupLog\\([^\\n]+['"]${phase}['"]`))
  assert.match(cli, /\[startup-cli\][^\n]+elapsedMs=/)
  assert.match(cli, /DSH_PORTABLE_STARTUP_ID/)
  assert.match(cli, /host-wait-begin/)
  assert.match(cli, /host-url-discovered/)
  assert.match(cli, /host-http-ready/)
  assert.match(cli, /startup-boundary[^\n]+startupId/)
  assert.match(runtimeEntry, /beginStartupTrace/)
  assert.match(runtimeEntry, /runtime-capsule-ready/)
  assert.match(runtimeEntry, /type:\s*'startup-progress'/)
  assert.match(runtimeEntry, /reportStartupProgress\('runtime-preparing'/)
  assert.match(runtimeEntry, /reportStartupProgress\('runtime-ready'/)
  assert.match(host, /official-dsh-import-begin/)
  assert.match(host, /official-dsh-import-failed/)
  assert.match(cli, /Diagnostics must never prevent the product from starting/)
})

const projectRoot = path.resolve(import.meta.dirname, '..')
const usbRoot = path.win32.resolve('R:\\AI Tools\\深度求索 Harness')

test('startup rebuilds the managed module fallback from the packaged dependency closure', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-profile-fallback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const stateRoot = path.join(root, 'installed-state')
  const layout = layoutForRoot(root, process.platform, stateRoot)
  const packaged = path.join(layout.appDir, 'node_modules')
  const fallback = path.join(layout.dshHome, 'profiles', 'node_modules', '@deepseek-ai')
  await mkdir(layout.appDir, { recursive: true })
  await writeFile(path.join(layout.appDir, 'package.json'), JSON.stringify({
    name: 'portable-runtime',
    dependencies: { '@deepseek-ai/dsh': '1.0.0' },
  }))
  await mkdir(path.join(packaged, '@deepseek-ai', 'dsh'), { recursive: true })
  await mkdir(path.join(packaged, '@deepseek-ai', 'dsh-client-ui-jobs'), { recursive: true })
  await mkdir(path.join(packaged, '@deepseek-ai', 'dsh-client-ui-goal'), { recursive: true })
  await writeFile(path.join(packaged, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    dependencies: {
      '@deepseek-ai/dsh-client-ui-jobs': '1.0.0',
      '@deepseek-ai/dsh-client-ui-goal': '1.0.0',
    },
  }))
  await writeFile(path.join(packaged, '@deepseek-ai', 'dsh-client-ui-jobs', 'package.json'), '{"name":"@deepseek-ai/dsh-client-ui-jobs"}')
  await writeFile(path.join(packaged, '@deepseek-ai', 'dsh-client-ui-goal', 'package.json'), '{"name":"@deepseek-ai/dsh-client-ui-goal"}')
  await mkdir(path.join(fallback, 'dsh-client-ui-jobs'), { recursive: true })
  await writeFile(path.join(fallback, 'dsh-client-ui-jobs', 'package.json'), '{}')
  await mkdir(path.join(fallback, 'dsh-client-ui-jobs.stale'), { recursive: true })
  await writeFile(path.join(fallback, 'dsh-client-ui-jobs.stale', 'package.json'), '{}')

  assert.equal(await repairManagedProfileModuleFallback(layout), true)
  assert.equal(
    realpathSync(path.join(layout.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh')),
    realpathSync(path.join(packaged, '@deepseek-ai', 'dsh')),
  )
  assert.equal(
    realpathSync(path.join(layout.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-jobs')),
    realpathSync(path.join(packaged, '@deepseek-ai', 'dsh-client-ui-jobs')),
  )
  assert.equal(
    realpathSync(path.join(layout.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-goal')),
    realpathSync(path.join(packaged, '@deepseek-ai', 'dsh-client-ui-goal')),
  )
  assert.throws(() => realpathSync(
    path.join(layout.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-jobs.stale'),
  ))

  const verified = await ensureManagedProfileModuleFallback(layout)
  assert.equal(verified.cached, false)
  const cached = await ensureManagedProfileModuleFallback(layout)
  assert.equal(cached.cached, true)
  assert.equal(cached.packages, 3)

  await rm(path.join(fallback, 'dsh-client-ui-goal'), { recursive: true, force: true })
  const recovered = await ensureManagedProfileModuleFallback(layout)
  assert.equal(recovered.cached, true)
  assert.equal(recovered.changed, true)
  assert.equal(
    realpathSync(path.join(fallback, 'dsh-client-ui-goal')),
    realpathSync(path.join(packaged, '@deepseek-ai', 'dsh-client-ui-goal')),
  )

  assert.equal(await clearPortableMoveLinks(layout), true)
  const restoredAfterCleanStop = await ensureManagedProfileModuleFallback(layout)
  assert.equal(restoredAfterCleanStop.cached, true)
  assert.equal(restoredAfterCleanStop.changed, true)
  assert.equal(restoredAfterCleanStop.packages, 3)
})

test('shutdown removes only generated absolute links so the portable root can move', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-profile-fallback-clear-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  const fallback = path.join(layout.dshHome, 'profiles', 'node_modules')
  const profile = path.join(layout.dshHome, 'profiles', 'web')
  const storeProjects = path.join(layout.packageManagerStore, 'v11', 'projects')
  const storeProject = path.join(storeProjects, 'profile-record')
  await mkdir(path.join(fallback, '@deepseek-ai', 'dsh'), { recursive: true })
  await writeFile(path.join(fallback, '@deepseek-ai', 'dsh', 'package.json'), '{"generated":true}')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), '{"name":"user-profile"}')
  await mkdir(storeProjects, { recursive: true })
  await symlink(profile, storeProject, process.platform === 'win32' ? 'junction' : 'dir')

  assert.equal(await clearPortableMoveLinks(layout), true)
  await assert.rejects(readFile(path.join(fallback, '@deepseek-ai', 'dsh', 'package.json')), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(storeProject, 'package.json')), { code: 'ENOENT' })
  assert.equal(JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8')).name, 'user-profile')
  assert.equal(await clearPortableMoveLinks(layout), false)
})

test('runtime closure ignores build-time type packages that production npm installs may prune', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-type-only-dependency-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  const packaged = path.join(layout.appDir, 'node_modules')
  await mkdir(path.join(packaged, '@deepseek-ai', 'dsh'), { recursive: true })
  await mkdir(path.join(packaged, 'runtime-package'), { recursive: true })
  await writeFile(path.join(packaged, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    dependencies: { 'runtime-package': '1.0.0' },
  }))
  await writeFile(path.join(packaged, 'runtime-package', 'package.json'), JSON.stringify({
    name: 'runtime-package',
    dependencies: { '@types/retry': '0.12.0' },
    peerDependencies: { '@types/node': '>=20' },
  }))

  assert.equal(await repairManagedProfileModuleFallback(layout), true)
  assert.equal(
    realpathSync(path.join(layout.dshHome, 'profiles', 'node_modules', 'runtime-package')),
    realpathSync(path.join(packaged, 'runtime-package')),
  )
})

test('startup rejects an incomplete packaged dependency closure before launching DSH', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-incomplete-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(layout.appDir, { recursive: true })
  await writeFile(path.join(layout.appDir, 'package.json'), JSON.stringify({
    name: 'portable-runtime',
    dependencies: { '@deepseek-ai/dsh': '1.0.0' },
  }))

  await assert.rejects(
    repairManagedProfileModuleFallback(layout),
    /packaged DSH runtime is incomplete[\s\S]+@deepseek-ai\/dsh/i,
  )
})

test('all durable application paths stay under the movable root', () => {
  const layout = layoutForRoot(usbRoot, 'win32')
  for (const [name, value] of Object.entries(layout)) {
    if (name === 'root' || name === 'platform' || name === 'capsuleMode' || name === 'environmentId') continue
    const relative = path.win32.relative(usbRoot, value)
    assert.equal(path.win32.isAbsolute(relative), false, name)
    assert.equal(relative.startsWith('..'), false, `${name}: ${relative}`)
  }
  assert.equal(layout.dshHome, path.win32.join(usbRoot, 'data', 'dsh-home'))
  assert.equal(layout.browserProfile, path.win32.join(usbRoot, 'data', 'browser'))
  assert.equal(layout.browserState, path.win32.join(usbRoot, 'data', 'runtime', 'browser.json'))
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

test('browser ownership requires both a supported executable and the exact portable profile', () => {
  const layout = layoutForRoot(usbRoot, 'win32')
  const executable = path.win32.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
  const owned = {
    pid: 4100,
    executablePath: executable,
    commandLine: `"${executable}" --app=http://127.0.0.1:3080 "--user-data-dir=${layout.browserProfile}" --no-first-run`,
  }
  assert.equal(isOwnedPortableBrowserProcess(owned, layout, executable), true)
  assert.equal(isOwnedPortableBrowserProcess({
    ...owned,
    commandLine: `"${executable}" --app=http://127.0.0.1:3080 "--user-data-dir=${layout.browserProfile}-other"`,
  }, layout, executable), false)
  assert.equal(isOwnedPortableBrowserProcess({
    ...owned,
    executablePath: 'C:\\Windows\\System32\\notepad.exe',
  }, layout, executable), false)
  assert.equal(isOwnedPortableBrowserProcess({
    ...owned,
    executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    commandLine: `pwsh.exe -Command "inspect ${layout.browserProfile}"`,
  }, layout), false)
  assert.equal(isOwnedPortableBrowserProcess({
    ...owned,
    executablePath: '',
    processName: 'chrome.exe',
  }, layout), true)
  assert.equal(isOwnedPortableBrowserProcess({
    ...owned,
    executablePath: '',
    processName: 'pwsh.exe',
  }, layout), false)
})

test('macOS browser ownership accepts the unquoted application command reported by ps', () => {
  const layout = layoutForRoot('/Volumes/Portable Disk/DSH-Portable', 'darwin')
  const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const commandLine = `${executable} --app=http://127.0.0.1:3080 --user-data-dir=${layout.browserProfile}`
  assert.equal(isOwnedPortableBrowserProcess({
    pid: 4200,
    executablePath: '/Applications/Google',
    commandLine,
  }, layout, executable), true)
  assert.equal(isOwnedPortableBrowserProcess({
    pid: 4201,
    executablePath: '/Applications/Google',
    commandLine: commandLine.replace(layout.browserProfile, `${layout.browserProfile}-other`),
  }, layout, executable), false)
})

test('macOS browser inspection records process groups for safe tree shutdown', () => {
  const rows = queryPosixBrowserProcesses({
    execute() {
      return ' 4200  1 4200 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/owned\n'
        + ' 4201 4200 4200 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper --type=renderer\n'
    },
  })
  assert.deepEqual(rows.map(({ pid, parentPid, processGroupId }) => ({ pid, parentPid, processGroupId })), [
    { pid: 4200, parentPid: 1, processGroupId: 4200 },
    { pid: 4201, parentPid: 4200, processGroupId: 4200 },
  ])
})

test('CLI defaults to start and supports bounded automation flags', () => {
  assert.deepEqual(parseCli([]), {
    command: 'start',
    noBrowser: false,
    json: false,
    allowHttp: false,
    force: false,
    updateManifest: '',
    progressJson: false,
    waitForLockMs: 0,
    updateScope: 'product',
  })
  assert.deepEqual(parseCli(['--diagnostic-root-json']), {
    ...parseCli([]),
    command: 'diagnostic-root',
    json: true,
  })
  assert.deepEqual(parseCli(['start', '--no-browser', '--json']), {
    command: 'start',
    noBrowser: true,
    json: true,
    allowHttp: false,
    force: false,
    updateManifest: '',
    progressJson: false,
    waitForLockMs: 0,
    updateScope: 'product',
  })
  assert.deepEqual(parseCli(['check-update', '--json', '--force', '--allow-http', '--update-manifest', 'http://127.0.0.1/update.json']), {
    command: 'check-update',
    noBrowser: false,
    json: true,
    allowHttp: true,
    force: true,
    updateManifest: 'http://127.0.0.1/update.json',
    progressJson: false,
    waitForLockMs: 0,
    updateScope: 'product',
  })
  assert.equal(parseCli(['check-update', '--scope', 'engine', '--json']).updateScope, 'engine')
  assert.equal(parseCli(['list-updates', '--scope', 'engine', '--json']).command, 'list-updates')
  assert.equal(parseCli(['check-update', '--channel', 'candidate', '--json']).updateChannel, 'candidate')
  assert.throws(() => parseCli(['check-update', '--channel', 'nightly']), /stable or candidate/)
  assert.equal(parseCli(['update', '--scope', 'product', '--json']).updateScope, 'product')
  assert.throws(() => parseCli(['check-update', '--scope', 'everything']), /product or engine/)
  assert.equal(parseCli(['stop', '--wait-for-lock-ms', '30000']).waitForLockMs, 30000)
  assert.throws(() => parseCli(['stop', '--wait-for-lock-ms', '60001']), /integer from 0 to 60000/)
  assert.equal(parseCli(['update', '--json', '--progress-json']).progressJson, true)
  assert.equal(parseCli(['defer-update', '--json']).command, 'defer-update')
  assert.equal(parseCli(['ignore-update', '--json']).command, 'ignore-update')
  assert.equal(parseCli(['doctor', '--json']).command, 'doctor')
  assert.equal(parseCli(['repair', '--json']).command, 'repair')
  assert.equal(parseCli(['runtime-cache-status', '--json']).command, 'runtime-cache-status')
  assert.equal(parseCli(['runtime-cache-clean', '--json']).command, 'runtime-cache-clean')
  assert.deepEqual(parseCli(['backup-data', '--output', 'backup.dshdata', '--categories', 'settings,sessions', '--password-file', 'password.txt']), {
    ...parseCli([]), command: 'backup-data', output: 'backup.dshdata', categories: ['settings', 'sessions'], passwordFile: 'password.txt',
  })
  assert.deepEqual(parseCli(['restore-data', '--input', 'backup.dshdata', '--conflict', 'replace']), {
    ...parseCli([]), command: 'restore-data', input: 'backup.dshdata', conflict: 'replace',
  })
  assert.equal(parseCli(['inspect-data', '--input', 'backup.dshdata']).command, 'inspect-data')
  assert.deepEqual(parseCli(['support-report', '--output', 'C:\\Temp\\dsh-support.json']), {
    ...parseCli([]),
    command: 'support-report',
    output: 'C:\\Temp\\dsh-support.json',
  })
  assert.throws(() => parseCli(['start', 'stop']), /more than one command/)
  assert.throws(() => parseCli(['erase-data']), /Unknown command/)
  assert.throws(() => parseCli(['--update-manifest']), /requires a value/)
  assert.throws(() => parseCli(['support-report', '--output']), /requires a value/)
  assert.throws(() => parseCli(['restore-data', '--conflict', 'merge']), /keep or replace/)
})

test('portable startup owns the desktop surface without allowing official DSH to open a browser', async () => {
  const source = await readFile(path.join(projectRoot, 'launcher', 'portable-cli.mjs'), 'utf8')
  assert.match(source, /typeof result\.output === 'string'/)
  assert.match(source, /typeof result\.ok === 'boolean'/)
  assert.match(source, /'--patch',\s*layout\.desktopBridgePatch,[\s\S]*'--profile',\s*'web',[\s\S]*'--no-open'/)
  assert.ok(
    source.indexOf("'--patch'") < source.indexOf("'--no-open'")
      && source.indexOf("'--no-open'") < source.indexOf("'--host', '127.0.0.1'"),
    'global patch options must precede the official web-profile no-open flag',
  )
  assert.match(source, /existsSync\(layout\.repairRequest\)[\s\S]+repairPortable\(layout, \{ running: false \}\)[\s\S]+writeJsonAtomic\(layout\.repairResult[\s\S]+rm\(layout\.repairRequest/)
})

test('a post-spawn startup failure cannot leave the owned DSH host running', async () => {
  const source = await readFile(path.join(projectRoot, 'launcher', 'portable-cli.mjs'), 'utf8')
  const startBody = source.slice(source.indexOf('async function start('), source.indexOf('async function stop()'))
  assert.match(startBody, /catch \(error\) \{[\s\S]+ownedState\(state\)[\s\S]+await stop\(\)/)
  assert.match(startBody, /cleanup failed/i)
})

test('simultaneous portable roots cannot mistake another root on the same port for their own host', async () => {
  const source = await readFile(path.join(projectRoot, 'launcher', 'portable-cli.mjs'), 'utf8')
  const waitBody = source.slice(source.indexOf('async function waitForHost('), source.indexOf('function portAvailable('))
  const startBody = source.slice(source.indexOf('async function start('), source.indexOf('async function stop()'))

  assert.ok(
    waitBody.indexOf('ownedState(state)') < waitBody.indexOf('httpReady(url,'),
    'process ownership must be proven before accepting a ready loopback page',
  )
  assert.match(waitBody, /httpReady\(url,\s*1200,\s*\{ preserveAccessToken: true \}\)/)
  assert.match(waitBody, /officialWorkspaceUrl\([\s\S]+state\.port\)/)
  assert.match(waitBody, /const url = loggedUrl \|\| state\.url \|\| null[\s\S]+if \(!url\)[\s\S]+continue[\s\S]+httpReady\(url,/)
  assert.match(startBody, /EADDRINUSE|address already in use/i)
  assert.match(startBody, /portRetry\s*<\s*PORT_RANGE\.last\s*-\s*PORT_RANGE\.first/)
  assert.match(startBody, /start\(noBrowser,\s*portRetry\s*\+\s*1\)/)
  assert.match(source, /dsh-portable-port-\$\{port\}\.lock/)
  assert.match(source, /openSync\(filename, ['"]wx['"]\)/)
  assert.match(startBody, /portReservation\.release\(\)/)
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
  const previousPath = process.env.PATH
  process.env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`
  try {
    const info = queryWindowsProcess(child.pid)
    assert.ok(info, 'process ownership must not depend on a globally installed PowerShell PATH entry')
    assert.match(info.commandLine, new RegExp(marker))
  } finally {
    process.env.PATH = previousPath
  }
})

test('browser process inspection fails closed when the operating-system query fails', () => {
  assert.throws(() => queryWindowsBrowserProcesses({
    execute() { throw new Error('CIM unavailable') },
  }), /could not inspect browser processes/i)
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

test('bounded lock waiting lets uninstall continue only after the active launcher releases ownership', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-lock-wait-'))
  const layout = layoutForRoot(root)
  await mkdir(layout.stateDir, { recursive: true })
  await writeFile(layout.launchLock, '515151\n')
  const liveOwner = () => ({
    executablePath: layout.nodeExe,
    commandLine: `"${layout.nodeExe}" "${layout.portableCli}" start`,
  })
  setTimeout(() => void rm(layout.launchLock, { force: true }), 45)
  const release = await acquireLaunchLockWithWait(layout, 500, {
    processQuery: liveOwner,
    pidExists: () => true,
  })
  assert.equal(Number((await readFile(layout.launchLock, 'utf8')).trim()), process.pid)
  await release()

  await writeFile(layout.launchLock, '616161\n')
  await assert.rejects(
    acquireLaunchLockWithWait(layout, 30, {
      processQuery: liveOwner,
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
  const headerFrame = zstdCompressSync(Buffer.from(`${JSON.stringify({ type: 'session', version: 0, id: 'session-one', createdAt: 1, cwd: first.workspace, isSeeded: false, delegationDepth: 0 })}\n`))
  const eventFrame = zstdCompressSync(Buffer.from(`${JSON.stringify({ type: 'event', text: first.workspace })}\n`))
  await writeFile(path.join(sessionDir, 'session.jsonl.zstd'), Buffer.concat([headerFrame, eventFrame]))

  await rename(firstRoot, movedRoot)
  const moved = layoutForRoot(movedRoot)
  const result = await migratePortableRoot(moved)
  assert.deepEqual(result, { moved: true, sessionCount: 1, storageCount: 1 })

  const workspaceStore = JSON.parse(await readFile(path.join(moved.dshHome, 'storages', 'workspace.json'), 'utf8'))
  assert.equal(workspaceStore.tables.workspaces.portable.path, moved.workspace)
  assert.equal(workspaceStore.tables.workspaces.external.path, 'C:\\External Project')

  const migratedFile = path.join(moved.dshHome, 'sessions', projectKey(moved.workspace), 'session-one', 'session.jsonl.zstd')
  const migratedBytes = await readFile(migratedFile)
  const secondFrame = migratedBytes.indexOf(Buffer.from([0x28, 0xB5, 0x2F, 0xFD]), 4)
  assert.equal(JSON.parse(zstdDecompressSync(migratedBytes.subarray(0, secondFrame)).toString('utf8')).cwd, moved.workspace)
  assert.equal(JSON.parse(zstdDecompressSync(migratedBytes.subarray(secondFrame)).toString('utf8')).text, first.workspace, 'historical message content is not rewritten')
})
