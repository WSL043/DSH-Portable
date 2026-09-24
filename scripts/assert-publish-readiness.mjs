import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { classifyProductVersion } from './version-policy.mjs'

export function assertPublishReadiness({ productVersion, previewLock, readiness }) {
  if (!classifyProductVersion(productVersion).prerelease) return
  const commit = previewLock?.dsh?.reviewedCommit
  const migration = readiness?.historicalSessionMigration
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || readiness?.schemaVersion !== 1
    || readiness?.dshReviewedCommit !== commit
    || migration?.status !== 'passed'
    || typeof migration.evidence !== 'string' || !migration.evidence.trim()) {
    throw new Error(`Candidate DSH ${previewLock?.dsh?.version ?? '<unknown>'} is not ready for publication: historical-session migration needs passing evidence tied to the exact reviewed core commit. ${migration?.reason ?? ''}`.trim())
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const product = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  if (classifyProductVersion(product.version).prerelease) {
    const [previewLock, readiness] = await Promise.all([
      readFile(new URL('../upstream.preview.lock.json', import.meta.url)).then(JSON.parse),
      readFile(new URL('../preview-release-readiness.json', import.meta.url)).then(JSON.parse),
    ])
    assertPublishReadiness({ productVersion: product.version, previewLock, readiness })
  }
}
