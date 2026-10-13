import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { signMetadata } from '../scripts/sign-update-metadata.mjs'
import { verifyUpdateSignature } from '../launcher/update-signature.mjs'

test('every metadata file gets a signature the application accepts, and nothing else is touched', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-sign-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'stable'), { recursive: true })
  await writeFile(path.join(root, 'stable', 'portable-update-windows-x64.json'), '{"portableVersion":"9.9.9"}\n')
  await writeFile(path.join(root, 'index.json'), '{"versions":[]}\n')
  await writeFile(path.join(root, 'package.zip'), 'binary')
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const signed = await signMetadata([root], pem)
  assert.equal(signed.length, 2)
  for (const file of signed) {
    const signature = await readFile(`${file}.sig`, 'utf8')
    assert.equal(verifyUpdateSignature(await readFile(file), signature, [pair.publicKey.export({ type: 'spki', format: 'pem' })]), true)
    assert.equal(verifyUpdateSignature(await readFile(file), signature), false, 'a different key must not verify')
  }
  await assert.rejects(readFile(path.join(root, 'package.zip.sig')))
  await assert.rejects(signMetadata([root], ''), /UPDATE_SIGNING_KEY/)
})
