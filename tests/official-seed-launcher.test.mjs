import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url)), '..')

test('launcher seeds only after conflict checks and before app launch, failing open on timeout/errors', async () => {
  const launcher = await readFile(resolve(root, 'experiments/official-payload/Launcher.cs'), 'utf8')
  assert.match(launcher, /CheckExternalOfficialOrPort\(executable\);\s*RunSeedPluginsBeforeLaunch\(\);/)
  assert.match(launcher, /File\.Exists\(manifest\) \|\| !File\.Exists\(profile\) \|\| !File\.Exists\(script\)/)
  assert.match(launcher, /WaitForExit\(30000\)/)
  assert.match(launcher, /EnvironmentVariables\.Remove\("PSModulePath"\)/)
  assert.match(launcher, /continuing official app startup/)
})
