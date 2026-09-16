/**
 * Phase 1 authority-binding interface (spec §13; v0.1.1 Wave 1 — T1).
 *
 * A reference binds only when it resolves to exactly one explicit authority source. The reference
 * itself stays symbolic: it names a lookup key, never an instance. What a proof commits to is the
 * resolved evidence — the binding identity and a digest of the canonical evidence payload — so two
 * runs that bind the same reference to different content cannot share a proof identity.
 *
 * The primitive is shared with assertion/verifier binding (T4) and accepted-correction authority
 * (T6): one provenance shape, three evidence channels, no second implementaion of the same idea.
 */

import {
  createEvidenceBinder,
  type EvidenceBinder,
  type EvidenceBinding,
} from '../provenance/evidence.ts';

/** One authority candidate for a reference. */
export type AuthorityBinding = EvidenceBinding;

export interface AuthorityBinder extends EvidenceBinder {
  /**
   * Return every candidate for `reference`.
   * Implementations MUST NOT fuzzy-match, guess by filename, or pick the newest-looking document:
   * zero or many candidates is `AUTHORITY_UNRESOLVED`, not a best effort.
   */
  bind(reference: string): readonly AuthorityBinding[];
}

/**
 * Exact-identity binder for tests and callers holding verbatim source identities.
 *
 * Only canonicalizable source content grounds provenance. A source value that cannot be serialized
 * truthfully makes resolution refuse, rather than digesting an unstable stringification and calling
 * it audit-safe.
 */
export function createAuthorityBinder(sources: Record<string, unknown>): AuthorityBinder {
  return createEvidenceBinder(
    Object.fromEntries(Object.entries(sources).map(([reference, content]) => [reference, { id: reference, content }])),
  ) as AuthorityBinder;
}
