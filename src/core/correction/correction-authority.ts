/**
 * Accepted-correction authority (v0.1.1 Wave 1 — T6).
 *
 * `role=correct` may only apply findings that were already accepted. A blocker identifier answers
 * WHAT may be corrected; it is a symbolic target, and on its own it authorizes nothing — an arbitrary
 * `scope.blockers` string must never become correction authority.
 *
 * Mutation authority exists only when both links resolve to real evidence, through the same
 * provenance primitive T1 uses:
 *
 *   correction target id (`scope.blockers` entry)
 *     → finding provenance              (evidence that the finding exists)
 *     → explicit acceptance provenance  (evidence that its owner accepted it)
 *            ↓
 *   admitted correction target
 *
 * Missing either link — or an ambiguous one — fails closed. There is no findings database, no
 * registry, no query API, and no persistence here: two explicit binders supplied by the environment
 * are the whole seam.
 */

import type { CharterError } from '../contracts/errors.ts';
import type { EvidenceBinder, EvidenceProvenance } from '../provenance/evidence.ts';
import { isEvidenceProvenance, resolveEvidenceProvenance } from '../provenance/evidence.ts';

/** The environment seam that can prove findings and their acceptance. Both links are required. */
export interface CorrectionAuthorityBinder {
  /** Provenance of the finding itself (review or adjudication evidence). */
  findings: EvidenceBinder;
  /** Provenance of the explicit owner/decision acceptance of that finding. */
  acceptances: EvidenceBinder;
}

/** One admitted correction target: WHAT may be corrected, and the evidence for WHY it may be. */
export interface ResolvedCorrectionTarget {
  /** The symbolic target id, exactly as declared in `scope.blockers`. */
  id: string;
  /** Why mutation authority exists: the finding's resolved provenance. */
  finding: EvidenceProvenance;
  /** Why acting on it is authorized: the explicit acceptance's resolved provenance. */
  acceptance: EvidenceProvenance;
}

export type CorrectionTargetsResult =
  | { ok: true; targets: ResolvedCorrectionTarget[] }
  | { ok: false; errors: CharterError[] };

/**
 * Resolve each declared correction target through both evidence links. Fail-closed at every step:
 * no binder, no finding, no acceptance, or an ambiguous link admits no target.
 */
export function resolveCorrectionTargets(
  blockers: readonly string[],
  binder: CorrectionAuthorityBinder | undefined,
): CorrectionTargetsResult {
  const targets: ResolvedCorrectionTarget[] = [];
  const errors: CharterError[] = [];
  const err = (id: string, message: string): void => {
    errors.push({ code: 'CONTRACT_CONTRADICTION', path: 'scope.blockers', message: `correction target '${id}' ${message}` });
  };

  for (const id of blockers) {
    if (!binder) {
      err(id, 'has no correction-authority binder; a blocker identifier alone does not authorize role=correct');
      continue;
    }
    const finding = resolveEvidenceProvenance(id, binder.findings.bind(id));
    if (!finding.ok) {
      err(id, `has no admitted finding provenance: it ${finding.reason}`);
      continue;
    }
    const acceptance = resolveEvidenceProvenance(id, binder.acceptances.bind(id));
    if (!acceptance.ok) {
      err(id, `has no explicit acceptance provenance: it ${acceptance.reason}`);
      continue;
    }
    targets.push({ id, finding: finding.provenance, acceptance: acceptance.provenance });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, targets };
}

/** Shape check for resolved targets carried by an artifact. Contents are transported, never re-derived. */
export function isResolvedCorrectionTarget(value: unknown): value is ResolvedCorrectionTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.id === 'string' &&
    target.id.length > 0 &&
    isEvidenceProvenance(target.finding) &&
    isEvidenceProvenance(target.acceptance)
  );
}
