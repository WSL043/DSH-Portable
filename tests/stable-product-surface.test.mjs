import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { retirePendingExtensionOperation } from '../launcher/portable-core.mjs'

const read = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')

test('stable desktop bridge has no Portable extensions surface or built-in entries', async () => {
  const [client, server] = await Promise.all([
    read('desktop-bridge/lib/client.js'),
    read('desktop-bridge/lib/index.js'),
  ])

  assert.doesNotMatch(client, /Portable extensions|便携扩展|portable-extensions|\/api\/dsh-portable\/extensions/)
  assert.doesNotMatch(server, /registerExtensionRoutes|loadBundledCatalog|createFileExtensionState/)
  await assert.rejects(() => stat(new URL('../desktop-bridge/extensions/catalog.json', import.meta.url)), /ENOENT/)
  await assert.rejects(() => stat(new URL('../desktop-bridge/lib/extensions.js', import.meta.url)), /ENOENT/)
})

test('dsh.exe guides zero-argument users and preserves parameterized CLI forwarding', async () => {
  const source = await read('launcher/windows/DSH-Command.cs')
  const zeroArgumentGuard = source.search(/arguments(?:\s*==\s*null|\.Length\s*==\s*0)/)
  const cliLaunch = source.indexOf('Process.Start(start)')

  assert.ok(zeroArgumentGuard >= 0, 'the command launcher must handle zero arguments explicitly')
  assert.ok(zeroArgumentGuard < cliLaunch, 'zero-argument guidance must happen before launching the CLI')
  assert.match(source, /MessageBoxW/)
  assert.match(source, /DeepSeek-Herness\.exe/)
  assert.match(source, /命令行/)
  assert.match(source, /command line/i)
  assert.match(source, /Arguments\s*=\s*BuildArguments\(cli, arguments\)/)
})

test('stable startup retires queued RC extension work without applying it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-stable-extension-retire-'))
  const pending = path.join(root, 'pending-extension.json')
  const result = path.join(root, 'extension-result.json')
  await mkdir(root, { recursive: true })
  await writeFile(pending, JSON.stringify({
    schemaVersion: 1,
    operationId: 'queued-operation',
    id: 'session-delete',
    action: 'install',
    status: 'queued',
  }))

  try {
    assert.equal(await retirePendingExtensionOperation({ extensionPending: pending, extensionResult: result }), true)
    await assert.rejects(() => readFile(pending), /ENOENT/)
    assert.deepEqual(JSON.parse(await readFile(result, 'utf8')), {
      schemaVersion: 1,
      operationId: 'queued-operation',
      id: 'session-delete',
      action: 'install',
      status: 'failed',
      code: 'portable_extensions_retired',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('stable startup refuses non-queued RC extension state and packages no transaction engine', async () => {
  const [cli, windowsBuild, macBuild, linuxBuild, bridgePackage] = await Promise.all([
    read('launcher/portable-cli.mjs'),
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
    read('desktop-bridge/package.json').then(JSON.parse),
  ])

  assert.doesNotMatch(cli, /preparePendingExtensionOperation|finishExtensionOperation|rollbackExtensionOperationAfterBootFailure|waitForExtensionHost/)
  assert.doesNotMatch(`${windowsBuild}\n${macBuild}\n${linuxBuild}`, /extension-operations\.mjs/)
  assert.doesNotMatch(bridgePackage.files.join('\n'), /extensions\.js|extensions\/catalog\.json/)

  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-stable-extension-recovery-'))
  const pending = path.join(root, 'pending-extension.json')
  await writeFile(pending, JSON.stringify({ status: 'applying' }))
  try {
    await assert.rejects(
      () => retirePendingExtensionOperation({ extensionPending: pending, extensionResult: path.join(root, 'result.json') }),
      /recovery/i,
    )
    assert.equal(JSON.parse(await readFile(pending, 'utf8')).status, 'applying')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
