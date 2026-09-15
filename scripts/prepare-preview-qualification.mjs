import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { classifyProductVersion } from './version-policy.mjs'

export function qualificationVersion(version) {
  const policy = classifyProductVersion(version)
  if (policy.prerelease) return version
  const [major, minor, patch] = version.split('.').map(Number)
  const candidate = `${major}.${minor}.${patch + 1}-alpha.1`
  classifyProductVersion(candidate)
  return candidate
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || process.env.GITHUB_REF !== 'refs/heads/automation/official-preview') {
    throw new Error('Candidate materialization is restricted to the official preview CI branch.')
  }
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version
  // Change only the disposable runner checkout. No tag, commit or release is created.
  execFileSync(process.execPath, [fileURLToPath(new URL('./set-product-version.mjs', import.meta.url)), qualificationVersion(version)], { stdio: 'inherit' })
}
