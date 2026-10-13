// Update metadata (manifests and catalogs) can be fetched through mirrors that Portable does not control. A mirror may
// be unreachable or hostile, so anything that did not come straight from github.com must carry a detached ECDSA P-256
// signature (<file>.json.sig, base64 IEEE-P1363 over the exact bytes) made by the release workflow with a key whose
// public half is built into the application. Archives are then protected by the digest inside the verified manifest.
import { createPublicKey, verify } from 'node:crypto'

// Keep more than one entry when rotating: ship the new key, publish with it, then retire the old one.
export const UPDATE_SIGNING_PUBLIC_KEYS = [
  `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDS6z4ZduGm37Ei9qilx4KXUzvPif
h37MWsdcRyFM56oeoBD/pnt9V4S7p9/EezYY/nOl5+fOlSqtua+qpPrH3g==
-----END PUBLIC KEY-----
`,
]

export function verifyUpdateSignature(bytes, signatureBase64, keys = UPDATE_SIGNING_PUBLIC_KEYS) {
  const signature = Buffer.from(String(signatureBase64 ?? '').trim(), 'base64')
  if (signature.length !== 64) return false
  return keys.some(pem => {
    try {
      return verify('sha256', bytes, { key: createPublicKey(pem), dsaEncoding: 'ieee-p1363' }, signature)
    } catch {
      return false
    }
  })
}
