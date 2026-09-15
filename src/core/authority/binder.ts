/**
 * Phase 1 authority-binding interface (spec §13).
 * A reference binds only when it resolves to exactly one explicit authority source.
 */

export interface AuthorityBinding {
  /** Stable identity of the bound source. */
  id: string;
  /** Caller-owned handle to the bound authority (document, findings set, decision record). */
  source?: unknown;
}

export interface AuthorityBinder {
  /**
   * Return every candidate for `reference`.
   * Implementations MUST NOT fuzzy-match, guess by filename, or pick the newest-looking document:
   * zero or many candidates is `AUTHORITY_UNRESOLVED`, not a best effort.
   */
  bind(reference: string): readonly AuthorityBinding[];
}

/** Exact-identity binder for tests and callers holding verbatim source identities. */
export function createAuthorityBinder(sources: Record<string, unknown>): AuthorityBinder {
  const ids = Object.keys(sources);
  return {
    bind: (reference) =>
      ids.includes(reference) ? [{ id: reference, source: sources[reference] }] : [],
  };
}
