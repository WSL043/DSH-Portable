import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { diffShellContract, readContractRecord, scanShellContract } from '../scripts/shell-contract.mjs'

const root = path.resolve(import.meta.dirname, '..')
const none = { env: [], bridge: [], cli: [], flag: [], file: [], capsule: [], layout: [] }
const frozen = {
  shell: { ...none, env: ['DSH_PORTABLE_ROOT', 'DSH_PORTABLE_STATE_ROOT', 'DSH_PORTABLE_STARTUP_ID'], bridge: ['dsh-portable/state', 'dsh-portable/surface-ready'], cli: ['doctor'], flag: ['--json'], file: ['runtime-entry.mjs'], capsule: ['DSHPACK1'], layout: ['app/package.json'] },
  app: { ...none, env: ['DSH_PORTABLE_ROOT', 'DSH_PORTABLE_STATE_ROOT'], bridge: ['dsh-portable/surface-ready'], cli: ['doctor'], flag: ['--json'], file: ['runtime-entry.mjs'], capsule: ['DSHPACK1'] },
}
const copy = () => structuredClone(frozen)

test('the interface between the shell and the app still matches its frozen record', async () => {
  const record = await readContractRecord(root)
  const scan = await scanShellContract(root)
  for (const command of ['list-updates', 'check-update', 'doctor']) {
    assert.ok(scan.app.cli.includes(command), 'bridge CLI extraction must include direct and shared-read calls: ' + command)
  }
  const { breaking, compatible } = diffShellContract(record, scan)
  assert.deepEqual([...breaking, ...compatible], [],
    'The shell/core interface changed. A compatible change: node scripts/shell-contract.mjs update. A breaking one: node scripts/shell-contract.mjs bump (older shells then stop accepting new cores).')
})

test('an unchanged interface is neither breaking nor compatible news', () => {
  assert.deepEqual(diffShellContract(frozen, copy()), { breaking: [], compatible: [] })
})

test('the shell gaining something is compatible', () => {
  const next = copy()
  next.shell.env.push('DSH_PORTABLE_NEW_THING')
  next.shell.bridge.push('dsh-portable/new-message')
  next.shell.cli.push('new-command')
  const result = diffShellContract(frozen, next)
  assert.deepEqual(result.breaking, [])
  assert.equal(result.compatible.length, 3)
})

test('a new core leaning on something the frozen shell never offered breaks older shells', () => {
  for (const [kind, name] of [['env', 'DSH_PORTABLE_NEW_THING'], ['bridge', 'dsh-portable/new-message'], ['cli', 'new-command'], ['flag', '--new-flag'], ['file', 'new-script.mjs'], ['capsule', 'DSHPACK2']]) {
    const next = copy()
    next.app[kind].push(name)
    assert.match(diffShellContract(frozen, next).breaking[0], new RegExp(`app now uses ${kind} `, 'u'), kind)
  }
})

test('the app using something the frozen shell already offers is fine, and so is dropping its own use of it', () => {
  const next = copy()
  next.app.env.push('DSH_PORTABLE_STARTUP_ID')
  assert.deepEqual(diffShellContract(frozen, next).breaking, [])
  const dropped = copy()
  dropped.app.cli = []
  const result = diffShellContract(frozen, dropped)
  assert.deepEqual(result.breaking, [])
  assert.match(result.compatible[0], /app no longer uses cli doctor/u)
})

test('the shell dropping something both sides shared breaks older cores, but dropping a private name does not', () => {
  const shared = copy()
  shared.shell.env = ['DSH_PORTABLE_STATE_ROOT', 'DSH_PORTABLE_STARTUP_ID']
  assert.match(diffShellContract(frozen, shared).breaking[0], /shell no longer provides env DSH_PORTABLE_ROOT/u)
  const privateName = copy()
  privateName.shell.env = ['DSH_PORTABLE_ROOT', 'DSH_PORTABLE_STATE_ROOT']
  const result = diffShellContract(frozen, privateName)
  assert.deepEqual(result.breaking, [])
  assert.match(result.compatible[0], /no longer has env DSH_PORTABLE_STARTUP_ID/u)
  const command = copy()
  command.shell.cli = []
  assert.match(diffShellContract(frozen, command).breaking[0], /shell no longer provides cli doctor/u)
})

test('a shell that starts expecting another path inside the app breaks rolling back to an older core', () => {
  const next = copy()
  next.shell.layout.push('app/node_modules/@wsl043/new-package')
  assert.match(diffShellContract(frozen, next).breaking[0], /shell now expects layout app\/node_modules\/@wsl043\/new-package/u)
  const fewer = copy()
  fewer.shell.layout = []
  const result = diffShellContract(frozen, fewer)
  assert.deepEqual(result.breaking, [])
  assert.match(result.compatible[0], /no longer expects layout/u)
})

test('the app dropping a message an older shell still sends breaks older shells', () => {
  const unhandled = copy()
  unhandled.app.bridge = []
  assert.match(diffShellContract(frozen, unhandled).breaking[0], /app no longer handles bridge dsh-portable\/surface-ready/u)
})

test('test hooks and run-time prefixes are not part of the interface', async () => {
  const scan = await scanShellContract(root)
  for (const side of [scan.shell, scan.app]) {
    // The app side has no layout list: the shell is the one that asks for paths.
    assert.ok(Object.entries(side).every(([kind, names]) => names.length > 0 || (side === scan.app && kind === 'layout')), 'every kind of coupling is actually being scanned')
    for (const name of side.env) {
      assert.doesNotMatch(name, /^DSH_PORTABLE_TEST_/u)
      assert.doesNotMatch(name, /_$/u)
    }
  }
})

test('every packaging script writes the contract number into the installed identity and the core manifests', async () => {
  const record = await readContractRecord(root)
  assert.ok(record.contract >= 1)
  const windows = await readFile(path.join(root, 'scripts', 'build-windows.ps1'), 'utf8')
  assert.match(windows, /'scripts\\shell-contract\.mjs'\) number/u, 'the build must find the script by its real path')
  assert.match(windows, /shellContract\s*=\s*\$ShellContract/u)
  assert.match(windows, /requiredShellContract\s*=\s*\$ShellContract/u)
  for (const script of ['build-macos.sh', 'build-linux.sh']) {
    const source = await readFile(path.join(root, 'scripts', script), 'utf8')
    assert.match(source, /"shellContract": \$SHELL_CONTRACT/u, script)
    assert.match(source, /"requiredShellContract": \$SHELL_CONTRACT/u, script)
  }
})
