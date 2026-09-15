/**
 * Model tiers, model profiles, explicit fallback policy, and role → tier routing.
 * Spec §9 (tiers), §10 (availability and explicit fallback), §29 (model unavailable), §37 (determinism).
 *
 * Charter owns which tier is suitable and which preferred/fallback models a profile admits.
 * The execution environment owns current availability. Charter never substitutes, guesses,
 * promotes, or demotes a model on its own.
 */

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
  if (!Array.isArray(available) || !available.every(isNonEmptyString)) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
