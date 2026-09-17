import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { uploadAssets } from '../scripts/upload-release-assets.mjs'

for (const mode of ['reuse', 'conflict', 'lost-response', 'incomplete', 'replace', 'published-missing']) {
  test(`release uploads: ${mode}`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'release-upload-'))
    try {
      const file = path.join(dir, 'component.zip')
      await writeFile(file, 'qualified bytes')
      const good = { id: 2, name: 'component.zip', state: 'uploaded', size: 15, digest: `sha256:${createHash('sha256').update('qualified bytes').digest('hex')}` }
      let assets = mode === 'reuse' ? [good] : ['conflict', 'replace'].includes(mode) ? [{ ...good, digest: 'sha256:different' }] : []
      const calls = []
      const gh = (args, timeout) => {
        calls.push(args)
        if (args.includes('--slurp')) return JSON.stringify([assets])
        if (args.includes('DELETE')) { assets = []; return '' }
        if (args[0] === 'release') {
          assert.equal(timeout, 600_000)
          assets = mode === 'incomplete' ? [{ ...good, state: 'starter' }] : [good]
          if (mode === 'lost-response') throw new Error('Connection lost after upload')
          return ''
        }
        return JSON.stringify({ id: 1 })
      }
      const action = uploadAssets({ repository: 'owner/repo', tag: 'v1', files: [file], mutable: mode === 'replace', verifyOnly: mode === 'published-missing', gh })
      if (mode === 'conflict') await assert.rejects(action, /Immutable asset differs/)
      else if (mode === 'incomplete') await assert.rejects(action, /Upload not verified/)
      else if (mode === 'published-missing') await assert.rejects(action, /Published asset missing or different/)
      else await action
      assert.equal(calls.filter(args => args[0] === 'release').length, ['reuse', 'conflict', 'published-missing'].includes(mode) ? 0 : 1)
      assert.equal(calls.filter(args => args.includes('DELETE')).length, mode === 'replace' ? 1 : 0)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
}
