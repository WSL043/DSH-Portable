/**
 * Host-contract compatibility preflight for #195.
 *
 * Pure evaluation of what `analyzeProfile()` already reports: a confirmed
 * peer mismatch (`satisfied === false`) is translated into a directional
 * verdict:
 *
 * - `belowMin`: the resolved version is older than every alternative's lower
 *   bound — the environment is too old for the plugin's declared contract.
 * - `aboveMax`: the resolved version is newer than every alternative's upper
 *   bound (or the exact pin). This is only a risk when the author expressed
 *   an explicit upper bound or exact pin; otherwise it is a warning, because
 *   the ecosystem currently has many sloppy `^0.0.1`-style declarations that
 *   work in practice.
 *
 * Everything else stays informational: `*`, prerelease-vs-`*` artifacts,
 * unparseable ranges, and optional peers never produce a risk here.
 */
import { type CheckOptions } from './check.ts';
export interface CompatibilityRisk {
    plugin: string;
    peer: string;
    range: string;
    resolved: string;
    direction: 'belowMin' | 'aboveMax';
}
export interface CompatibilityWarning {
    plugin: string;
    peer: string;
    range: string;
    resolved: string;
    reason: 'aboveMax' | 'optional';
}
export interface CompatibilityAssessment {
    risks: CompatibilityRisk[];
    warnings: CompatibilityWarning[];
}
export type PeerVerdict = {
    kind: 'risk';
    risk: CompatibilityRisk;
} | {
    kind: 'warning';
    warning: CompatibilityWarning;
} | {
    kind: 'none';
};
/** Translate one confirmed peer mismatch into a directional verdict. */
export declare function classifyPeer(plugin: string, peer: string, range: string, resolved: string | null, optional: boolean): PeerVerdict;
/** Whether a peer is declared optional in the installed plugin manifest. */
export declare function isOptionalPeer(profileDirectory: string, plugin: string, peer: string): boolean;
/** Evaluate the current profile with the same machinery `/dsh-market/check` uses. */
export declare function assessCompatibility(profileDirectory: string, options?: CheckOptions): CompatibilityAssessment;
/** Risks present after a mutation but absent before it. */
export declare function introducedRisks(before: CompatibilityAssessment, after: CompatibilityAssessment): CompatibilityRisk[];
/** Convenience wrapper matching the profile helper signature. */
export declare function assessProfile(profile: string, explicitDir?: string): CompatibilityAssessment;
