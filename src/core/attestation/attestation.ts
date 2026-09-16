/**
 * Environment attestation schema and the trusted-attestation boundary (v0.1.1 Wave 1 — T2, H2).
 *
 * A raw caller boolean or a raw model array is a CLAIM. It is not environment truth, and Charter
 * must not report hard enforcement or an attested inventory from it.
 *
 * An attestation-SHAPED object a caller submits is a CANDIDATE. Its shape can be validated, and
 * nothing about the object can show that a component which actually exists issued it. Shape
 * validation plus hashing therefore yields candidate evidence, never attested evidence: declaring an
 * admitted `source_kind`, a non-empty `source` name, and a canonical payload promotes nothing. A
 * source name is not a trust boundary, and neither is any other field of the envelope.
 *
 * Trust is a separate act, and it belongs to exactly one place: the trusted-attestation boundary the
 * embedding environment supplies (`AttestationVerifier`) — a CAPABILITY OBJECT, recognised by
 * process-local object identity in a store that is never exported from the package surface, and
 * therefore a position no submitted value can occupy. A callback is not a boundary, a
 * boundary-shaped record is not a boundary, and a caller who mints one over their own candidate has
 * reached inside the package rather than through its surface. Charter implements no issuer, reads no
 * environment, and decides no trust of its own: with no boundary supplied, nothing is trusted. Only
 * `attested` evidence can ground `ENFORCED` or a hard attested-evidence requirement, and only a
 * candidate the boundary vouched for grounds `attested` evidence. An unknown source kind still fails
 * closed.
 *
 * Wave 1 defines this schema, its identity requirements, and the verification boundary. Issuing
 * attestations from real Pi/subagents/provider evidence is Wave 2 work: nothing here reads the
 * environment, and there is no signing infrastructure and no remote attestation service.
 */

import type { CharterErrorCode } from '../contracts/errors.ts';
import { evidenceDigest, evidenceIdentity } from '../provenance/evidence.ts';
import { isIssuedAttestationVerifier, markIssuedAttestationVerifier } from './trusted-boundary.ts';

/** Closed vocabulary of evidence sources Charter admits. An unlisted kind fails closed. */
export const ATTESTATION_SOURCE_KINDS = ['execution_adapter', 'model_registry'] as const;
export type AttestationSourceKind = (typeof ATTESTATION_SOURCE_KINDS)[number];

/** Closed vocabulary of evidence classes. There is no third, softer tier. */
export const ENVIRONMENT_EVIDENCE_CLASSES = ['attested', 'unattested_claim'] as const;
export type EnvironmentEvidenceClass = (typeof ENVIRONMENT_EVIDENCE_CLASSES)[number];

/**
 * A submitted attestation CANDIDATE: shape-validated, and untrusted by construction.
 *
 * Nothing in this object can make it trusted, and none of its fields is verified against anything.
 * It grounds `attested` evidence only by crossing the `AttestationVerifier` boundary below.
 */
export interface AttestationCandidate {
  /** Which class of evidence source DECLARES it produced this. Unknown kinds fail closed. */
  source_kind: AttestationSourceKind;
  /** Declared identity of the evidence-producing component. A name the caller states, not proof. */
  source: string;
  /** Version that component declares, where one is reported. Absent means not reported. */
  source_version?: string;
  /** The declared payload, in the channel's canonical shape. Validated by the channel that reads it. */
  payload: unknown;
}

/**
 * The explicit trusted-attestation boundary (W1_ATTESTATION_SELF_PROMOTION,
 * W1_ATTESTATION_VERIFIER_FORGEABILITY).
 *
 * This is the one place trust enters Charter, and it is a capability OBJECT rather than a callback
 * because a callback cannot hold a position: any function with this signature is substitutable, and
 * `() => true` would be an issuer. A boundary is recognised only by process-local object identity in
 * the non-exported store (`trusted-boundary.ts`), so nothing a caller supplies — a function, a
 * boundary-shaped record, a copy, a clone, a JSON roundtrip — occupies this position, and Charter
 * never reads a candidate's trust out of its contents.
 *
 * `vouches` answers true only for a candidate this environment actually issued. A false answer, an
 * absent boundary, and a boundary that throws all refuse alike, so an unusable boundary fails closed
 * instead of trusting. Wave 2 supplies the real Pi/subagents issuer behind this position; until then
 * no production path mints one.
 */
export interface AttestationVerifier {
  /** True only for a candidate this environment actually issued. Never a submitted value's contents. */
  vouches(candidate: AttestationCandidate): boolean;
}

/**
 * Exact-issuance verifier: an environment that holds the attestations it issued can vouch for
 * precisely those, by canonical identity over `(source_kind, source, source_version?, payload)`.
 *
 * The comparison is over the whole attestation, never over a source name: a candidate that reuses an
 * issued source name, version, or source kind with a different payload does not match and is not
 * trusted. This recognises only attestations the environment already authored in its own code, so it
 * cannot be satisfied by anything a caller submits — a capability, not a knob.
 *
 * The Wave 1 fixture/blessed-adapter seam, not an issuer: it reads nothing from the environment, and
 * Wave 2 replaces it with the real evidence bridge.
 *
 * INTERNAL — NOT PACKAGE SURFACE. This factory is the only thing that can mint a trusted boundary, so
 * it is deliberately absent from the exports of `index.ts` (the package's only entry point): an
 * ordinary caller cannot author trust at all, and a caller who mints a boundary over its own
 * candidate has reached inside the package instead of through its surface. The exact-issuance rule is
 * also what keeps the seam honest: a boundary can vouch only for attestations its environment already
 * holds, never for everything.
 */
export function createAttestationVerifier(issued: readonly unknown[]): AttestationVerifier {
  const identities = new Set(issued.map((attestation) => attestationIdentity(attestation)));
  const boundary: AttestationVerifier = {
    vouches(candidate) {
      // A candidate whose payload cannot be canonically identity-hashed is not one of the issued
      // attestations: it is refused rather than crashing the boundary it was handed to.
      try {
        return identities.has(attestationIdentity(candidate));
      } catch {
        return false;
      }
    },
  };
  // Frozen and admitted to the process-local identity store: a boundary is a value others may hold
  // and call, never one they can edit into a wider one.
  return markIssuedAttestationVerifier(Object.freeze(boundary));
}

/**
 * Validated evidence record carried by resolved truth. Only its class decides what it may ground,
 * and `attested` is reachable only through an explicit `AttestationVerifier`.
 */
export type EnvironmentEvidence =
  | {
      class: 'attested';
      source_kind: AttestationSourceKind;
      source: string;
      source_version?: string;
      /** SHA-256 over the canonical `(source_kind, source, source_version?, payload)` evidence. */
      evidence_identity: string;
    }
  | {
      class: 'unattested_claim';
      /** SHA-256 over the canonical claimed payload. An identity, not an attestation. */
      evidence_identity: string;
    };

/**
 * Ground evidence for a validated candidate, through the explicit trust boundary.
 *
 * Vouched for → `attested`, with the identity recomputed over the candidate Charter validated and
 * never over anything the boundary handed back. Not vouched for, or no verifier supplied at all →
 * `unattested_claim` over the declared payload: the truthful weaker state, which can ground neither
 * `ENFORCED` nor an attested inventory. Refusal happens only for a payload that cannot be canonically
 * serialized, which would otherwise ground a false identity.
 */
export function resolveAttestationEvidence(
  candidate: AttestationCandidate,
  verifier: AttestationVerifier | undefined,
): { ok: true; evidence: EnvironmentEvidence } | { ok: false; reason: string } {
  // A payload that cannot be canonically serialized would ground a false identity, so it grounds none.
  const digest = evidenceDigest(candidate.payload);
  if (!digest.ok) return { ok: false, reason: digest.reason };
  if (!isVouchedFor(candidate, verifier)) {
    // A candidate nobody vouched for is exactly as strong as the claim it carries, and says so.
    return { ok: true, evidence: { class: 'unattested_claim', evidence_identity: digest.digest } };
  }
  return {
    ok: true,
    evidence: {
      class: 'attested',
      source_kind: candidate.source_kind,
      source: candidate.source,
      ...(candidate.source_version ? { source_version: candidate.source_version } : {}),
      evidence_identity: attestationIdentity(candidate),
    },
  };
}

/**
 * Fail-closed boundary call: an absent boundary, a value that is not a minted boundary at all (a
 * callback, a boundary-shaped record, a copy), a false answer, and a boundary that throws all mean no
 * trust. The identity check is what makes the position unforgeable — no part of the supplied value's
 * shape is ever read as trust — so this path downgrades a forged boundary to the claim it is even if
 * a caller reaches `resolveAttestationEvidence` directly.
 */
function isVouchedFor(candidate: AttestationCandidate, verifier: AttestationVerifier | undefined): boolean {
  if (!isIssuedAttestationVerifier(verifier)) return false;
  try {
    return verifier.vouches(candidate) === true;
  } catch {
    return false;
  }
}

/** Canonical identity of an attestation: `(source_kind, source, source_version?, payload)`. */
function attestationIdentity(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const sourceVersion = record.source_version;
  return evidenceIdentity({
    source_kind: record.source_kind,
    source: record.source,
    ...(typeof sourceVersion === 'string' && sourceVersion.length > 0 ? { source_version: sourceVersion } : {}),
    payload: record.payload,
  });
}

/** The evidence record a raw claim grounds. Same evidence_identity field, explicitly not attested. */
export function claimedEvidence(payload: unknown): { ok: true; evidence: EnvironmentEvidence } | { ok: false; reason: string } {
  const digest = evidenceDigest(payload);
  if (!digest.ok) return { ok: false, reason: digest.reason };
  return { ok: true, evidence: { class: 'unattested_claim', evidence_identity: digest.digest } };
}

const ENVELOPE_KEYS = ['source_kind', 'source', 'source_version', 'payload'] as const;

type Err = (code: CharterErrorCode, path: string, message: string) => void;

/**
 * Validate a submitted attestation CANDIDATE fail-closed and return the envelope it declares.
 *
 * Unknown envelope fields, an unrecognized source kind, a missing source identity, and a malformed
 * version are all refused: an attestation Charter cannot trace to an admitted source kind carries no
 * authority here, so it is never partially accepted. The payload shape belongs to the channel that
 * reads it.
 *
 * Validation establishes that this is a candidate and nothing more — it is not a trust decision, and
 * the returned value is not trusted by anything downstream until a verifier vouches for it.
 */
export function checkAttestationCandidate(
  raw: unknown,
  path: string,
  expected: AttestationSourceKind,
  err: Err,
): AttestationCandidate | undefined {
  if (!isRecord(raw)) {
    err('INVALID_TASK_CONTRACT', path, `${path} must be an attestation envelope`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!(ENVELOPE_KEYS as readonly string[]).includes(key)) {
      err('INVALID_TASK_CONTRACT', `${path}.${key}`, `unknown field '${path}.${key}'`);
    }
  }
  if (!isOneOf(raw.source_kind, ATTESTATION_SOURCE_KINDS)) {
    err(
      'INVALID_TASK_CONTRACT',
      `${path}.source_kind`,
      `${path}.source_kind must be one of ${ATTESTATION_SOURCE_KINDS.join('|')}; an unrecognized attestation source is not trusted`,
    );
    return undefined;
  }
  if (raw.source_kind !== expected) {
    err(
      'CONTRACT_CONTRADICTION',
      `${path}.source_kind`,
      `${path} must declare a '${expected}' source_kind, not '${raw.source_kind}'`,
    );
    return undefined;
  }
  if (!isNonEmptyString(raw.source)) {
    err('INVALID_TASK_CONTRACT', `${path}.source`, `${path}.source must name the evidence-producing component`);
    return undefined;
  }
  if (raw.source_version !== undefined && !isNonEmptyString(raw.source_version)) {
    err('INVALID_TASK_CONTRACT', `${path}.source_version`, `${path}.source_version must be a non-empty string when declared`);
    return undefined;
  }
  return {
    source_kind: raw.source_kind,
    source: raw.source,
    ...(raw.source_version ? { source_version: raw.source_version } : {}),
    payload: raw.payload,
  };
}

const EVIDENCE_KEYS = ['class', 'source_kind', 'source', 'source_version', 'evidence_identity'] as const;

/**
 * Validate an evidence record carried by resolved truth (a Phase 3 binding, a resolved contract).
 * Contents are transported, never re-derived: only shape, admitted class, and identity presence are
 * checked, so a malformed record is refused rather than rendered as truth.
 */
export function checkEnvironmentEvidence(raw: unknown, path: string, err: Err): EnvironmentEvidence | undefined {
  if (!isRecord(raw)) {
    err('INVALID_TASK_CONTRACT', path, `${path} must be an environment evidence record`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!(EVIDENCE_KEYS as readonly string[]).includes(key)) {
      err('INVALID_TASK_CONTRACT', `${path}.${key}`, `unknown field '${path}.${key}'`);
    }
  }
  if (!isOneOf(raw.class, ENVIRONMENT_EVIDENCE_CLASSES)) {
    err(
      'INVALID_TASK_CONTRACT',
      `${path}.class`,
      `${path}.class must be one of ${ENVIRONMENT_EVIDENCE_CLASSES.join('|')}`,
    );
    return undefined;
  }
  if (!isNonEmptyString(raw.evidence_identity)) {
    err('INVALID_TASK_CONTRACT', `${path}.evidence_identity`, `${path}.evidence_identity must be a non-empty string`);
    return undefined;
  }
  if (raw.class === 'unattested_claim') {
    for (const key of ['source_kind', 'source', 'source_version'] as const) {
      if (raw[key] !== undefined) {
        err(
          'CONTRACT_CONTRADICTION',
          `${path}.${key}`,
          `an unattested claim carries no ${key}; only attested evidence names its source`,
        );
      }
    }
    return { class: 'unattested_claim', evidence_identity: raw.evidence_identity };
  }
  if (!isOneOf(raw.source_kind, ATTESTATION_SOURCE_KINDS)) {
    err(
      'INVALID_TASK_CONTRACT',
      `${path}.source_kind`,
      `${path}.source_kind must be one of ${ATTESTATION_SOURCE_KINDS.join('|')}`,
    );
    return undefined;
  }
  if (!isNonEmptyString(raw.source)) {
    err('INVALID_TASK_CONTRACT', `${path}.source`, `${path}.source must name the evidence-producing component`);
    return undefined;
  }
  if (raw.source_version !== undefined && !isNonEmptyString(raw.source_version)) {
    err('INVALID_TASK_CONTRACT', `${path}.source_version`, `${path}.source_version must be a non-empty string when declared`);
    return undefined;
  }
  return {
    class: 'attested',
    source_kind: raw.source_kind,
    source: raw.source,
    ...(raw.source_version ? { source_version: raw.source_version } : {}),
    evidence_identity: raw.evidence_identity,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}
