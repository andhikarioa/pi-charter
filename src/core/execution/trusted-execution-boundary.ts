/**
 * The internal issued-execution-evidence store (v0.1.1 Wave 2 — T5).
 *
 * Execution evidence must not be a caller-authored object that merely says the run looked right. That
 * is exactly the Wave 1 defect (declared shape promoted to trust), repeated one layer later, so T5
 * uses the same mechanism that closed it: ISSUANCE IS A CAPABILITY, and a capability is recognised by
 * process-local object identity in a store that is never exported from the package surface
 * (`package.json` exports `./dist/index.js`, and `index.ts` does not re-export this module).
 *
 *   issued by a boundary this process minted   → trusted execution evidence
 *   a caller-authored object with the same
 *   fields, a copy, a clone, a JSON roundtrip  → not evidence, however closely it resembles one
 *
 * No signatures and no PKI: this is the minimum truthful boundary for a single-process release. It
 * holds an identity set and nothing else — no clock, no registry, no session store, no run history,
 * no lifecycle state, and no way to reach an attestation that was not issued here.
 */

const ISSUED_EXECUTION_ATTESTATIONS = new WeakSet<object>();

/**
 * Admit an attestation this process's issuance boundary minted, and return it unchanged. Internal:
 * the only caller is the execution-attestation issuer factory, which is itself deliberately absent
 * from the package surface, so ordinary callers hold no way to occupy the trusted position.
 */
export function markIssuedExecutionAttestation<T extends object>(attestation: T): T {
  ISSUED_EXECUTION_ATTESTATIONS.add(attestation);
  return attestation;
}

/**
 * True only for evidence this process actually issued. No field, no spread copy, no clone, and no
 * parsed JSON makes a value issued, so the conformant path refuses everything else instead of reading
 * trust out of its contents.
 */
export function isIssuedExecutionAttestation(value: unknown): value is object {
  return typeof value === 'object' && value !== null && ISSUED_EXECUTION_ATTESTATIONS.has(value);
}
