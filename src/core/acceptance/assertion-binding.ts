/**
 * Assertion → verifier binding (v0.1.1 Wave 1 — T4).
 *
 * An assertion identifier is a symbolic reference. On its own it proves identifier syntax and
 * nothing else: `"banana-proof-123"` is not evidence that anything was verified. Charter therefore
 * refuses to treat an assertion as verifier-backed acceptance until it resolves to exactly one
 * verifier identity — a test identifier, a verification command identity, or an external checker
 * identity.
 *
 * Charter is a compiler and executes nothing. The strongest truth it establishes here is
 * `ASSERTION_BOUND`: the assertion is bound to a verifier. `ASSERTION_VERIFIED` would require
 * execution evidence that the verifier actually ran and passed, which belongs to the execution
 * substrate (T5), never to this module.
 *
 * The verifier identity is material to the resolved proof identity: binding the same assertion to a
 * different verifier changes the resolved `verifier_digest` and therefore the resolved contract and
 * any receipt that commits to it.
 */

import type { CharterError } from '../contracts/errors.ts';
import { resolveEvidenceProvenance, type EvidenceBinder } from '../provenance/evidence.ts';

/** The environment seam that resolves assertion references to verifier identities. */
export type AssertionBinder = EvidenceBinder;

/** One admitted assertion: its reference, the verifier identity bound to it, and the binding digest. */
export interface AssertionBinding {
  /** The assertion reference exactly as declared by the contract. */
  reference: string;
  /** The verifier identity this assertion is bound to. */
  verifier: string;
  /** Declared kind of the verifier, when the binder declared one. */
  source_kind?: string;
  /** SHA-256 over the canonical verifier evidence. */
  verifier_digest: string;
}

/**
 * The strongest truth a resolved assertion carries. Deliberately not `ASSERTION_VERIFIED`: no
 * execution evidence exists inside Charter.
 */
export const ASSERTION_BINDING_TRUTH = 'ASSERTION_BOUND' as const;

export type AssertionBindingResult =
  | { ok: true; bindings: AssertionBinding[] }
  | { ok: false; errors: CharterError[] };

/**
 * Resolve every declared assertion to exactly one verifier identity. Fail-closed: an assertion with
 * no binder, no verifier, or more than one verifier never becomes verifier-backed acceptance.
 */
export function resolveAssertionBindings(
  assertions: readonly string[],
  binder: AssertionBinder | undefined,
): AssertionBindingResult {
  const bindings: AssertionBinding[] = [];
  const errors: CharterError[] = [];
  for (const assertion of assertions) {
    if (!binder) {
      errors.push({
        code: 'ACCEPTANCE_INVALID',
        path: 'acceptance.assertions',
        message: `assertion '${assertion}' has no verifier binder; an unbound assertion is not verifier-backed acceptance`,
      });
      continue;
    }
    const resolved = resolveEvidenceProvenance(assertion, binder.bind(assertion));
    if (!resolved.ok) {
      errors.push({
        code: 'ACCEPTANCE_INVALID',
        path: 'acceptance.assertions',
        message: `assertion '${assertion}' ${resolved.reason}`,
      });
      continue;
    }
    const provenance = resolved.provenance;
    bindings.push({
      reference: provenance.reference,
      verifier: provenance.binding_id,
      ...(provenance.source_kind ? { source_kind: provenance.source_kind } : {}),
      verifier_digest: provenance.content_digest,
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, bindings };
}
