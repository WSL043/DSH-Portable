import type { Translate } from './market-data.ts'

interface AiFixPeerMismatch {
  satisfied: boolean | null
  verdict?: { kind: 'risk' | 'warning' | 'none' }
}

interface AiFixReport {
  profile: string
  duplicates: unknown[]
  peerMismatches: AiFixPeerMismatch[]
  multiVersion: unknown[]
  orderConflicts?: Array<{ name: string; reason: string }>
  summary: { errors: string[]; warnings: string[] }
}

/** Build a repair prompt whose allowed actions match the observed problem. */
export function buildAiFixPrompt(report: AiFixReport, t: Translate): string {
  const lines: string[] = [
    t('aiFixIntro').replace('{0}', report.profile),
    '',
    t('aiFixDetect'),
    '',
    t('aiFixIfSelf'),
    '',
  ]
  if (report.summary.errors.length > 0) {
    lines.push(`${t('checkErrors')}:`)
    for (const error of report.summary.errors) lines.push(`- ${error}`)
    lines.push('')
  }
  if (report.summary.warnings.length > 0) {
    lines.push(`${t('checkWarnings')}:`)
    for (const warning of report.summary.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }
  if ((report.orderConflicts ?? []).length > 0) {
    lines.push(`${t('catOrder')}:`)
    for (const conflict of report.orderConflicts ?? []) lines.push(`- ${conflict.name}: ${conflict.reason}`)
    lines.push('')
  }

  // A peer-range-only report is a package-version problem. Reordering bundle
  // layers or editing the user's patch cannot widen a plugin manifest range.
  const confirmedPeers = report.peerMismatches.filter(peer =>
    peer.satisfied === false && (peer.verdict === undefined || peer.verdict.kind === 'risk'))
  const peerRangeOnly = report.summary.errors.length === 0
    && report.duplicates.length === 0
    && report.multiVersion.length === 0
    && (report.orderConflicts ?? []).length === 0
    && confirmedPeers.length > 0
    && confirmedPeers.length === report.summary.warnings.length

  lines.push(t(peerRangeOnly ? 'aiFixPeerRange' : 'aiFixScope'))
  lines.push('')
  lines.push(t('aiFixConservative'))
  return lines.join('\n')
}
