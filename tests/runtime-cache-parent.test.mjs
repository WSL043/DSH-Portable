import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runtimeCacheParent } from '../launcher/runtime-capsule.mjs'

test('the runtime cache follows DSH_PORTABLE_DATA_ROOT unless a specific cache is configured', () => {
  const dataRoot = path.join(os.tmpdir(), 'dsh-portable-data-root')
  const specificCache = path.join(os.tmpdir(), 'dsh-portable-runtime-cache')
  assert.equal(
    runtimeCacheParent({ DSH_PORTABLE_DATA_ROOT: dataRoot }),
    path.join(path.resolve(dataRoot), 'runtime-cache'),
  )
  assert.equal(
    runtimeCacheParent({ DSH_PORTABLE_DATA_ROOT: dataRoot, DSH_PORTABLE_RUNTIME_CACHE: specificCache }),
    path.resolve(specificCache),
  )
})
