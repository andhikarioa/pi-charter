/**
 * Deterministic evidence provenance (v0.1.1 Wave 1 — T1, T4, T6).
 *
 * A reference is symbolic: `"reviewer-findings"` names a lookup key, never an instance. Governance
 * truth that must distinguish changed resolved content commits to the RESOLVED evidence instead —
 * the binder identity that was bound, plus a digest over the canonical evidence payload. Two runs
 * that bind the same reference to different content therefore cannot share a proof identity.
 *
 * Canonicalizable evidence only. A payload that cannot be serialized truthfully (a function, a
 * class instance, `undefined`, a cycle, `NaN`) does not ground provenance: the strong path refuses
 * rather than digesting an unstable stringification and calling it audit-safe.
 *
 * Nothing here verifies that the external world is truthful, and nothing here is signing
 * infrastructure: this is tamper-evident binding to the exact evidence a binder resolved, which is
 * all v0.1.1 claims.
 */

import { createHash } from 'node:crypto';

/**
 * One evidence candidate a binder offers for a reference.
 *
 * Exactly one candidate per reference is admissible; zero or many is unresolved, never a
 * best-effort pick.
 */
export interface EvidenceBinding {
  /** Stable identity of the bound evidence instance. */
  id: string;
  /**
   * Declared kind of the evidence (document, findings set, decision record, verifier), when the
   * binder knows one. Absent means undeclared — never a fabricated default.
   */
  source_kind?: string;
  /** Canonicalizable evidence payload: what the content digest is taken over. */
  content?: unknown;
  /** Legacy alias for `content`, used only when `content` is absent. Not a second evidence channel. */
  source?: unknown;
}

/** The environment seam that resolves references to evidence. Charter discovers nothing itself. */
export interface EvidenceBinder {
  bind(reference: string): readonly EvidenceBinding[];
}

/** Resolved provenance for one reference: the evidence identity a proof can commit to. */
export interface EvidenceProvenance {
  /** The symbolic reference this evidence was resolved from. */
  reference: string;
  /** Stable identity of the exact resolved evidence instance. */
  binding_id: string;
  /** SHA-256 over the canonical evidence payload. */
  content_digest: string;
  /** Declared evidence kind, when the binder declared one. Absent is recorded as absent. */
  source_kind?: string;
}

/** Shape check for a provenance entry carried by an artifact. Contents are transported, not re-derived. */
export function isEvidenceProvenance(value: unknown): value is EvidenceProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const provenance = value as Record<string, unknown>;
  return (
    typeof provenance.reference === 'string' &&
    provenance.reference.length > 0 &&
    typeof provenance.binding_id === 'string' &&
    provenance.binding_id.length > 0 &&
    typeof provenance.content_digest === 'string' &&
    provenance.content_digest.length > 0 &&
    (provenance.source_kind === undefined || typeof provenance.source_kind === 'string')
  );
}

export type EvidenceProvenanceResult =
  | { ok: true; provenance: EvidenceProvenance }
  | { ok: false; reason: string };

/**
 * Canonical serialization: object keys sorted recursively, array order preserved, `undefined`
 * serialized as JSON `null`. Total by construction — it is used on Charter-authored values.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 over canonical serialization. Built-in crypto only; no temporal identity exists. */
export function evidenceIdentity(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * Digest an evidence payload, fail-closed: only a deterministically canonicalizable payload gets a
 * digest. Everything else returns the exact reason instead of an identity.
 */
export function evidenceDigest(value: unknown): { ok: true; digest: string } | { ok: false; reason: string } {
  const reason = findNonCanonical(value, new Set(), 'evidence');
  if (reason !== undefined) return { ok: false, reason };
  return { ok: true, digest: evidenceIdentity(value) };
}

/**
 * Resolve one reference to exactly one piece of canonical evidence.
 *
 * A caller turns a failure into its own canonical error code; this function reports only the exact
 * reason, so the evidence primitive carries no error policy.
 */
export function resolveEvidenceProvenance(
  reference: string,
  bindings: readonly EvidenceBinding[],
): EvidenceProvenanceResult {
  if (bindings.length !== 1) {
    return {
      ok: false,
      reason: `resolved to ${bindings.length} evidence sources; exactly one is required`,
    };
  }
  const binding = bindings[0] as EvidenceBinding;
  const id = binding.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'the bound evidence has no binding identity' };
  }
  if (binding.source_kind !== undefined && (typeof binding.source_kind !== 'string' || binding.source_kind.trim().length === 0)) {
    return { ok: false, reason: 'the bound evidence declares a malformed source_kind' };
  }
  const payload = binding.content !== undefined ? binding.content : binding.source;
  const digest = evidenceDigest(payload);
  if (!digest.ok) {
    return { ok: false, reason: `it does not carry canonicalizable content (${digest.reason})` };
  }
  return {
    ok: true,
    provenance: {
      reference,
      binding_id: id,
      content_digest: digest.digest,
      ...(binding.source_kind ? { source_kind: binding.source_kind } : {}),
    },
  };
}

/**
 * Exact-identity binder for tests, fixtures, and callers holding verbatim evidence identities.
 *
 * A string value means "this reference is bound to exactly this evidence identity, and the identity
 * string is its canonical payload". An object value carries the payload explicitly.
 */
export function createEvidenceBinder(evidence: Record<string, string | EvidenceBinding>): EvidenceBinder {
  const references = Object.keys(evidence);
  return {
    bind: (reference) => {
      if (!references.includes(reference)) return [];
      const entry = evidence[reference];
      if (typeof entry === 'string') return [{ id: entry, content: entry }];
      // No identity is fabricated: an entry without an explicit `id` fails closed in resolution.
      return [{ ...(entry as EvidenceBinding) }];
    },
  };
}

/** The first non-canonical value found, described exactly; `undefined` when the value is canonical. */
function findNonCanonical(value: unknown, seen: Set<object>, path: string): string | undefined {
  if (value === null) return undefined;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return undefined;
    case 'number':
      return Number.isFinite(value) ? undefined : `'${path}' is ${String(value)}`;
    case 'object':
      break;
    default:
      return `'${path}' is a ${typeof value}`;
  }
  const record = value as Record<string, unknown>;
  if (seen.has(record)) return `'${path}' is cyclic`;
  const prototype = Object.getPrototypeOf(record) as object | null;
  if (!Array.isArray(record) && prototype !== Object.prototype && prototype !== null) {
    const name = (record as { constructor?: { name?: string } }).constructor?.name ?? 'non-plain object';
    return `'${path}' is a ${name}`;
  }
  seen.add(record);
  const entries: [string, unknown][] = Array.isArray(record)
    ? record.map((nested, index) => [String(index), nested] as [string, unknown])
    : Object.entries(record);
  for (const [key, nested] of entries) {
    const reason = findNonCanonical(nested, seen, path ? `${path}.${key}` : key);
    if (reason !== undefined) return reason;
  }
  seen.delete(record);
  return undefined;
}
