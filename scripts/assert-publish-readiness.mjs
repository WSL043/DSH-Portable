import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { classifyProductVersion } from './version-policy.mjs'
import { descriptorV2PatchIdentity } from './patch-historical-descriptor.mjs'

export function assertPublishReadiness({ productVersion, stableLock, previewLock, readiness }) {
  const policy = classifyProductVersion(productVersion)
  if (/^1\.0\.0-alpha\./.test(policy.version)) {
    throw new Error('Portable 1.0.0 alpha requires separate clean-install qualification; Native publication and public update catalogs are disabled.')
  }
  const prerelease = policy.prerelease
  if (!prerelease) {
    const plugins = Object.values(stableLock?.defaultPlugins ?? {})
    if (plugins.length === 0 || plugins.some(plugin => plugin?.releaseChannel !== 'stable'
      || !/^\d+\.\d+\.\d+$/.test(plugin?.version ?? ''))) {
      throw new Error('Stable Portable publication requires reviewed stable versions of every default plugin.')
    }
  }
  const selectedLock = prerelease ? previewLock : stableLock
  const commit = selectedLock?.dsh?.reviewedCommit
  const integrity = selectedLock?.dsh?.npmIntegrity ?? selectedLock?.dsh?.integrity
  const migration = readiness?.historicalSessionMigration
  if (selectedLock?.dsh?.version === descriptorV2PatchIdentity.dshVersion && migration?.status === 'passed'
    && JSON.stringify(migration.compatibilityPatch) !== JSON.stringify(descriptorV2PatchIdentity)) {
    throw new Error('Historical-session evidence must identify the exact reviewed compatibility patch.')
  }
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? '')
    || readiness?.schemaVersion !== 1
    || readiness?.dshReviewedCommit !== commit
    || readiness?.dshNpmIntegrity !== integrity
    || migration?.status !== 'passed'
    || typeof migration.evidence !== 'string' || !migration.evidence.trim()) {
    throw new Error(`${prerelease ? 'Candidate' : 'Stable'} DSH ${selectedLock?.dsh?.version ?? '<unknown>'} is not ready for publication: historical-session migration needs passing evidence tied to the exact reviewed core commit and package. ${migration?.reason ?? ''}`.trim())
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const product = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  const stableLock = JSON.parse(await readFile(new URL('../upstream.lock.json', import.meta.url)))
  const prerelease = classifyProductVersion(product.version).prerelease
  const [previewLock, readiness] = await Promise.all([
    prerelease ? readFile(new URL('../upstream.preview.lock.json', import.meta.url)).then(JSON.parse) : null,
    readFile(new URL(prerelease ? '../preview-release-readiness.json' : '../stable-release-readiness.json', import.meta.url)).then(JSON.parse),
  ])
  assertPublishReadiness({ productVersion: product.version, stableLock, previewLock, readiness })
}
