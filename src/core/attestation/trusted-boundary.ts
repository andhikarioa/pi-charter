/**
 * The internal issued-attestation boundary store (v0.1.1 Wave 1 — W1_ATTESTATION_VERIFIER_FORGEABILITY).
 *
 * Trust is a CAPABILITY, not a payload, so the trusted-attestation position must not be reachable by
 * anything a caller can author. Shape cannot carry that: a callback with the right signature, a
 * record with a `vouches` method, and a copy of a real boundary all look like a boundary from the
 * outside. Recognition is therefore process-local object identity in a store that is never exported
 * from the package surface (`package.json` exports `./src/index.ts`, and index.ts does not re-export
 * this module):
 *
 *   minted by this process            → a boundary
 *   a callback, a record, a copy,
 *   a clone, a JSON roundtrip         → not a boundary, however closely it resembles one
 *
 * Nothing here holds a secret, a key, a clock, a registry, or any state beyond that identity set. It
 * is the seam the Wave 2 issuer is wired through — not an issuer, and not a trust decision of its own.
 */

import type { AttestationVerifier } from './attestation.ts';

const ISSUED_ATTESTATION_VERIFIERS = new WeakSet<object>();

/**
 * Admit a boundary this process minted, and return it unchanged. Internal: the only caller is the
 * exact-issuance factory, which is itself deliberately absent from the package surface, so ordinary
 * callers hold no way to occupy the trusted position at all.
 */
export function markIssuedAttestationVerifier<T extends object>(boundary: T): T {
  ISSUED_ATTESTATION_VERIFIERS.add(boundary);
  return boundary;
}

/**
 * True only for a boundary this process actually minted. No field, method name, spread copy, clone,
 * or parsed envelope makes a value a boundary, so the public runtime path refuses or downgrades
 * everything else instead of reading trust out of its contents.
 */
export function isIssuedAttestationVerifier(value: unknown): value is AttestationVerifier {
  return typeof value === 'object' && value !== null && ISSUED_ATTESTATION_VERIFIERS.has(value);
}
