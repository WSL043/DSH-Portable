import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('desktop dictionaries share complete keys, placeholders and generated client copy', () => {
  execFileSync(process.execPath, ['scripts/sync-desktop-locales.mjs'], {
    cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'pipe',
  })
})
