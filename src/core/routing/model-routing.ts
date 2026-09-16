/**
 * Model tiers, model profiles, explicit fallback policy, and role → tier routing.
 * Spec §9 (tiers), §10 (availability and explicit fallback), §29 (model unavailable), §37 (determinism).
 *
 * Charter owns which tier is suitable and which preferred/fallback models a profile admits.
 * The execution environment owns current availability. Charter never substitutes, guesses,
 * promotes, or demotes a model on its own.
 */

import type { EnvironmentEvidence } from '../attestation/attestation.ts';
import {
  checkAttestationCandidate,
  claimedEvidence,
  resolveAttestationEvidence,
  type AttestationVerifier,
} from '../attestation/attestation.ts';
import { isIssuedAttestationVerifier } from '../attestation/trusted-boundary.ts';
import type { CharterError } from '../contracts/errors.ts';
import type { Risk, Role, TaskClass } from '../contracts/task-contract.ts';

/** Canonical v0.1 model tiers (spec §9). Exactly three; no others are supported. */
export const MODEL_TIERS = ['workhorse', 'reviewer', 'reasoning'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export interface TierModels {
  /** Opaque model identity. Charter never interprets vendor, size, or benchmark meaning. */
  preferred: string;
  /** Explicitly admitted fallbacks in declared order. Never generated or inferred (spec §10). */
  fallback: readonly string[];
}

/**
 * Concrete model identities per tier. A tier may be omitted; a tier that cannot be staffed is
 * `ROUTING_UNRESOLVED`, never a silent downgrade to another tier.
 */
export type ModelProfile = Partial<Record<ModelTier, TierModels>>;

/** Resolved model block of an ExecutionContract (spec §35). */
export interface ModelSelection {
  tier: ModelTier;
  preferred: string;
  /** The model actually selected. Always `preferred` or a fallback admitted by the profile. */
  resolved: string;
  fallback_used: boolean;
}

export type ModelSelectionResult =
  | { ok: true; model: ModelSelection }
  | { ok: false; error: CharterError };

/** Exact provider/model identities a registry attests it can currently staff (H2). */
export interface ModelAvailabilityAttestationPayload {
  models: string[];
}

const AVAILABILITY_PAYLOAD_KEYS = ['models'] as const;

/**
 * Resolve model availability from exactly one evidence channel (v0.1.1 H2).
 *
 * A raw availability list is a CLAIM: it is accepted, classified as `unattested_claim`, and recorded
 * as such, so it can never be read later as attested registry truth.
 *
 * A submitted registry envelope is a CANDIDATE, not a fact: it is validated fail-closed, and it
 * becomes attested inventory only when the explicit verifier the environment supplied vouches for it
 * (W1_ATTESTATION_SELF_PROMOTION). A candidate nobody vouches for — including one that declares a
 * realistic registry name — is recorded as the claim it is, and grounds no attested inventory.
 * Supplying both channels, neither, an unrecognized attestation source, or a verifier on the claim
 * channel fails closed.
 */
export function resolveModelAvailability(input: {
  available?: unknown;
  attestation?: unknown;
  /** The explicit trusted-attestation boundary. A capability, never a submitted value. */
  verifier?: AttestationVerifier;
}): { ok: true; models: string[]; evidence: EnvironmentEvidence } | { ok: false; error: CharterError } {
  const hasClaim = input.available !== undefined;
  const hasAttestation = input.attestation !== undefined;
  if (hasClaim && hasAttestation) {
    return {
      ok: false,
      error: {
        code: 'CONTRACT_CONTRADICTION',
        path: 'env.model_availability_attestation',
        message: 'available and model_availability_attestation are both present; exactly one evidence channel is admitted',
      },
    };
  }
  if (!hasClaim && !hasAttestation) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_CONTRACT',
        path: 'env.available',
        message: 'an explicit availability claim or attestation is required to resolve a model',
      },
    };
  }
  // A boundary with nothing to verify is a contradiction: the verifier is only ever read on the
  // envelope channel, so a raw list can never be read as vouched for.
  if (input.verifier !== undefined && !hasAttestation) {
    return {
      ok: false,
      error: {
        code: 'CONTRACT_CONTRADICTION',
        path: 'env.model_availability_attestation_verifier',
        message:
          'env.model_availability_attestation_verifier is present with no attestation to verify; a trust boundary is never supplied for a channel it does not govern',
      },
    };
  }
  if (input.verifier !== undefined && !isIssuedAttestationVerifier(input.verifier)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_CONTRACT',
        path: 'env.model_availability_attestation_verifier',
        message:
          'env.model_availability_attestation_verifier must be a trusted attestation boundary minted by this environment; a submitted function, record, or copy is not a trust boundary',
      },
    };
  }

  if (hasClaim) {
    if (!isModelList(input.available)) {
      return unresolved('model.available', 'the availability claim must be a list of model identities');
    }
    // Membership is the meaning here; array order is encoding. The evidence identity is therefore
    // taken over the canonical (sorted) inventory, so the same set is the same evidence whichever
    // way the environment happened to list it.
    const models = [...(input.available as string[])].sort();
    const evidence = claimedEvidence(models);
    if (!evidence.ok) {
      return unresolved('model.available', `the availability claim is not canonicalizable (${evidence.reason})`);
    }
    return { ok: true, models, evidence: evidence.evidence };
  }

  const errors: CharterError[] = [];
  const envelope = checkAttestationCandidate(
    input.attestation,
    'env.model_availability_attestation',
    'model_registry',
    (code, path, message) => { errors.push({ code, message, path }); },
  );
  if (envelope === undefined) {
    // Every refusal path reports; the fallback exists only so no failure is silently lost.
    const failure: CharterError = errors[0] ?? {
      code: 'INVALID_TASK_CONTRACT',
      path: 'env.model_availability_attestation',
      message: 'the model-availability attestation could not be validated',
    };
    return { ok: false, error: failure };
  }
  const payload = envelope.payload;
  if (!isRecord(payload)) {
    return unresolved('env.model_availability_attestation.payload', 'the attested availability payload must be an object');
  }
  for (const key of Object.keys(payload)) {
    if (!(AVAILABILITY_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      return unresolved(
        `env.model_availability_attestation.payload.${key}`,
        `unknown field 'env.model_availability_attestation.payload.${key}'`,
      );
    }
  }
  if (!isModelList(payload.models)) {
    return unresolved(
      'env.model_availability_attestation.payload.models',
      'the attested inventory must be a list of exact provider/model identities',
    );
  }
  const models = [...(payload.models as string[])].sort();
  // Membership is the meaning here and array order is encoding, so the evidence identity is taken
  // over the canonical (sorted) inventory either way: the same set is the same evidence, and only the
  // CLASS says whether a boundary actually vouched for it. An unvouched registry envelope is
  // therefore exactly as strong as the same plain list — a claim, and recorded as one.
  const evidence = resolveAttestationEvidence({ ...envelope, payload: { models } }, input.verifier);
  if (!evidence.ok) {
    return unresolved(
      'env.model_availability_attestation.payload',
      `the attested inventory is not canonicalizable evidence (${evidence.reason})`,
    );
  }
  return { ok: true, models, evidence: evidence.evidence };
}

/**
 * Deterministic role → tier routing (spec §8, §9). Frozen v0.1 routing:
 *
 *   planner / implement / correct → workhorse
 *   review                       → reviewer
 *   adjudicate                   → reasoning
 *
 * Task class and risk are accepted because they are routing inputs of the contract (spec §8), but
 * in v0.1 they have no tier-changing effect: no promotion, no demotion, no risk-routing table.
 * A T4/critical adjudication and a T3/critical correction stay on their role's tier.
 * They never grant authority either (§8). Only the role selects the tier.
 */
export function routeModelTier(role: Role, taskClass: TaskClass, risk: Risk): ModelTier {
  void taskClass;
  void risk;
  return role === 'review' ? 'reviewer' : role === 'adjudicate' ? 'reasoning' : 'workhorse';
}

/**
 * Tier → concrete model under an explicit availability snapshot (spec §10):
 *
 *   preferred available                                       → preferred
 *   preferred unavailable + first admitted fallback available  → that fallback
 *   preferred unavailable + no admitted fallback available     → MODEL_UNAVAILABLE
 *
 * Forbidden and deliberately absent: silent substitution, closest/same-vendor/strongest-available
 * guessing, automatic fallback generation, and borrowing another tier's model.
 */
export function resolveModel(
  tier: ModelTier,
  profile: ModelProfile,
  available: readonly string[],
): ModelSelectionResult {
  if (!isModelList(available)) {
    return routingError('model.available', 'the availability snapshot must be a list of model identities');
  }
  if (!isRecord(profile)) {
    return routingError('model.profile', 'a model profile must be supplied');
  }
  // Closed profile: an unknown tier key or a malformed entry is a configuration error, never a
  // silently ignored default.
  for (const key of Object.keys(profile)) {
    if (!(MODEL_TIERS as readonly string[]).includes(key)) {
      return routingError(`model.profile.${key}`, `unknown model tier '${key}'`);
    }
  }
  for (const known of MODEL_TIERS) {
    const entry: unknown = profile[known];
    if (entry === undefined) continue;
    const extra = unknownTierEntryKey(entry);
    if (extra !== undefined) {
      return routingError(
        `model.profile.${known}.${extra}`,
        `model tier '${known}' admits only 'preferred' and 'fallback'`,
      );
    }
    if (!isTierModels(entry)) {
      return routingError(
        `model.profile.${known}`,
        `model tier '${known}' must declare a non-empty preferred model and a fallback list`,
      );
    }
  }

  const entry = profile[tier];
  if (!entry) {
    return routingError(`model.profile.${tier}`, `no model is admitted for tier '${tier}'`);
  }
  if (available.includes(entry.preferred)) {
    return { ok: true, model: { tier, preferred: entry.preferred, resolved: entry.preferred, fallback_used: false } };
  }
  for (const candidate of entry.fallback) {
    if (available.includes(candidate)) {
      return { ok: true, model: { tier, preferred: entry.preferred, resolved: candidate, fallback_used: true } };
    }
  }
  return {
    ok: false,
    error: {
      code: 'MODEL_UNAVAILABLE',
      path: 'model.tier',
      message: `tier '${tier}' preferred '${entry.preferred}' is unavailable and no admitted fallback is available`,
    },
  };
}

function routingError(path: string, message: string): ModelSelectionResult {
  return { ok: false, error: { code: 'ROUTING_UNRESOLVED', path, message } };
}

/** Availability-evidence failure: the same canonical routing code, in the evidence result shape. */
function unresolved(path: string, message: string): { ok: false; error: CharterError } {
  return { ok: false, error: { code: 'ROUTING_UNRESOLVED', path, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isModelList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/** The only keys a tier entry admits (C3). Anything else is a configuration error, never a knob. */
const TIER_ENTRY_KEYS = ['preferred', 'fallback'] as const;

/** The first key this entry declares that it is not allowed to declare, if any. */
function unknownTierEntryKey(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  return Object.keys(entry).find((key) => !(TIER_ENTRY_KEYS as readonly string[]).includes(key));
}

function isTierModels(value: unknown): value is TierModels {
  return (
    isRecord(value) &&
    // Closed entry: bounded explicit key validation, so `policy`/`fallback_mode`/`allow_any` and
    // any other invented knob fail closed instead of being silently ignored.
    Object.keys(value).every((key) => (TIER_ENTRY_KEYS as readonly string[]).includes(key)) &&
    isNonEmptyString(value.preferred) &&
    Array.isArray(value.fallback) &&
    value.fallback.every(isNonEmptyString)
  );
}
