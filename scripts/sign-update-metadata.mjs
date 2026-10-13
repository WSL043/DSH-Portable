// Sign update metadata for mirrors: every *.json under the given files or directories gets a sibling <file>.json.sig
// (base64 ECDSA P-256 / SHA-256, IEEE-P1363) made with the PEM private key in UPDATE_SIGNING_KEY. The application
// verifies these signatures against the public key built into launcher/update-signature.mjs before it will use any
// metadata that arrived through a mirror. This file is copied into the Updates repository; keep both identical.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function metadataFiles(targets) {
  const found = []
  for (const target of targets) {
    const info = await stat(target)
    if (info.isFile()) {
      if (target.endsWith('.json')) found.push(target)
      continue
    }
    for (const entry of await readdir(target, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) found.push(path.join(entry.parentPath ?? entry.path, entry.name))
    }
  }
  return [...new Set(found)].sort()
}

export async function signMetadata(targets, privateKeyPem) {
  if (!privateKeyPem || !String(privateKeyPem).includes('PRIVATE KEY')) throw new Error('UPDATE_SIGNING_KEY is missing or is not a PEM private key')
  const privateKey = createPrivateKey(privateKeyPem)
  const publicKey = createPublicKey(privateKey)
  const files = await metadataFiles(targets)
  for (const file of files) {
    const bytes = await readFile(file)
    const signature = sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' })
    if (!verify('sha256', bytes, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) throw new Error(`signature self-check failed for ${file}`)
    await writeFile(`${file}.sig`, `${signature.toString('base64')}\n`, 'utf8')
  }
  return files
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targets = process.argv.slice(2)
  if (!targets.length) throw new Error('usage: sign-update-metadata.mjs <file-or-directory>...')
  const signed = await signMetadata(targets, process.env.UPDATE_SIGNING_KEY)
  console.log(`signed ${signed.length} metadata file(s)`)
}
