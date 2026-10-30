// A maintainer declaration of final-artifact operations, not a replacement for real UI tests.
export function assertFinalArtifactAcceptance(raw, { tag, commit, runId, subjects }) {
  if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw) > 32768) {
    throw new Error('Final artifact acceptance JSON is required for publication (maximum 32 KiB).')
  }
  const record = JSON.parse(raw)
  const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  if (!exactKeys(record, ['schemaVersion', 'tag', 'commit', 'runId', 'checks'])
    || record.schemaVersion !== 1 || record.tag !== tag || record.commit !== commit
    || !Number.isSafeInteger(record.runId) || record.runId !== runId) {
    throw new Error('Final artifact acceptance must match the exact release tag, commit and CI run.')
  }
  if (!Array.isArray(record.checks) || record.checks.length === 0 || record.checks.length > 64) {
    throw new Error('Final artifact acceptance must contain the actual operation checklist (1-64 checks).')
  }
  const byName = new Map(subjects.map(subject => [subject.name, subject.sha256]))
  const names = new Set()
  for (const check of record.checks) {
    if (!exactKeys(check, ['name', 'status', 'artifact', 'sha256', 'evidenceSha256'])
      || typeof check.name !== 'string' || !check.name.trim() || check.name !== check.name.trim()
      || check.name.length > 160 || /[\x00-\x1f\x7f]/.test(check.name) || names.has(check.name)) {
      throw new Error('Final artifact acceptance has an invalid or duplicate operation.')
    }
    names.add(check.name)
    if (check.status !== 'passed') throw new Error('Every declared final-artifact operation must pass before publication.')
    if (typeof check.artifact !== 'string' || !/\.(?:zip|tar\.gz|dmg|AppImage|exe)$/.test(check.artifact)
      || !/^[a-f0-9]{64}$/.test(check.sha256 ?? '') || byName.get(check.artifact) !== check.sha256
      || !/^[a-f0-9]{64}$/.test(check.evidenceSha256 ?? '')) {
      throw new Error('Final artifact acceptance must identify an actual release archive or installer and its evidence SHA-256.')
    }
  }
  return record
}
