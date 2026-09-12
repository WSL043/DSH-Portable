import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('runtime preparation restores the child environment and preserves explicit user pool settings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-preparation-env-'))
  try {
    const source = fileURLToPath(new URL('../launcher', import.meta.url))
    await cp(source, path.join(root, 'launcher'), { recursive: true, filter: filename => filename === source || filename.endsWith('.mjs') })
    await writeFile(path.join(root, 'launcher/inspect.mjs'), 'console.log(JSON.stringify({pool:process.env.UV_THREADPOOL_SIZE??null,marker:process.env.DSH_PORTABLE_PREPARATION_POOL??null}))')
    for (const [pool, marker, expected] of [['16', '16', null], ['8', undefined, '8'], ['8', '16', '8']]) {
      const env = { ...process.env, UV_THREADPOOL_SIZE: pool }
      delete env.DSH_PORTABLE_STATE_ROOT
      delete env.DSH_PORTABLE_ENVIRONMENT
      delete env.DSH_PORTABLE_PREPARATION_POOL
      if (marker) env.DSH_PORTABLE_PREPARATION_POOL = marker
      const result = execFileSync(process.execPath, [path.join(root, 'launcher/runtime-entry.mjs'), 'inspect.mjs'], { env, windowsHide: true, encoding: 'utf8' })
      assert.deepEqual(JSON.parse(result), { pool: expected, marker: null })
    }
    const native = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
    assert.match(native, /actionArgs\[0\] == "start"\s*&& !start\.EnvironmentVariables\.ContainsKey\("UV_THREADPOOL_SIZE"\)/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
