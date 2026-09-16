/**
 * Environment attestation schema (v0.1.1 Wave 1 — T2, H2).
 *
 * A raw caller boolean or a raw model array is a CLAIM. It is not environment truth, and Charter
 * must not report hard enforcement or an attested inventory from it. Attested evidence is traceable
 * to an explicit evidence-producing source (an execution adapter, a model registry), carries a
 * deterministic identity over its canonical payload, and is validated fail-closed on arrival.
 *
 * Hashing a claim does not make it attested: what distinguishes the two below is the CLASS —
 * `unattested_claim` versus `attested` — and only `attested` evidence can ground `ENFORCED` or a
 * hard attested-evidence requirement. An unknown source kind fails closed instead of being trusted.
 *
 * Wave 1 defines this schema, its identity requirements, and the verification boundary. Issuing
 * attestations from real Pi/subagents/provider evidence is Wave 2 work: nothing here reads the
 * environment, and there is no signing infrastructure and no remote attestation service.
 */

import type { CharterErrorCode } from '../contracts/errors.ts';
import { evidenceDigest, evidenceIdentity } from '../provenance/evidence.ts';

/** Closed vocabulary of evidence sources Charter admits. An unlisted kind fails closed. */
export const ATTESTATION_SOURCE_KINDS = ['execution_adapter', 'model_registry'] as const;
export type AttestationSourceKind = (typeof ATTESTATION_SOURCE_KINDS)[number];

/** Closed vocabulary of evidence classes. There is no third, softer tier. */
export const ENVIRONMENT_EVIDENCE_CLASSES = ['attested', 'unattested_claim'] as const;
export type EnvironmentEvidenceClass = (typeof ENVIRONMENT_EVIDENCE_CLASSES)[number];

/** Submitted attestation: what an explicit evidence source says it can prove. */
export interface AttestationEnvelope {
  /** Which class of evidence source produced this. Unknown kinds fail closed. */
  source_kind: AttestationSourceKind;
  /** Identity of the evidence-producing component (adapter or registry). */
  source: string;
  /** Version of that component, where the environment reports one. Absent means not reported. */
  source_version?: string;
  /** The attested payload, in the channel's canonical shape. Validated by the channel that reads it. */
  payload: unknown;
}

/** Validated evidence record carried by resolved truth. Only its class decides what it may ground. */
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

/** The evidence record an attested envelope grounds, with its identity recomputed over the payload. */
export function attestedEvidence(
  envelope: AttestationEnvelope,
): { ok: true; evidence: EnvironmentEvidence } | { ok: false; reason: string } {
  // A payload that cannot be canonically serialized would ground a false identity, so it grounds none.
  const digest = evidenceDigest(envelope.payload);
  if (!digest.ok) return { ok: false, reason: digest.reason };
  return {
    ok: true,
    evidence: {
      class: 'attested',
      source_kind: envelope.source_kind,
      source: envelope.source,
      ...(envelope.source_version ? { source_version: envelope.source_version } : {}),
      evidence_identity: evidenceIdentity({
        source_kind: envelope.source_kind,
        source: envelope.source,
        ...(envelope.source_version ? { source_version: envelope.source_version } : {}),
        payload: envelope.payload,
      }),
    },
  };
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
 * Validate a submitted attestation fail-closed and return the envelope it declares.
 *
 * Unknown envelope fields, an unrecognized source kind, a missing source identity, and a malformed
 * version are all refused: an attestation Charter cannot trace to an admitted source kind carries no
 * authority here, so it is never partially accepted. The payload shape belongs to the channel that
 * reads it; the evidence identity is derived by that channel from the validated envelope.
 */
export function checkAttestationEnvelope(
  raw: unknown,
  path: string,
  expected: AttestationSourceKind,
  err: Err,
): AttestationEnvelope | undefined {
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
      `${path} must be attested by a '${expected}' source, not '${raw.source_kind}'`,
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
