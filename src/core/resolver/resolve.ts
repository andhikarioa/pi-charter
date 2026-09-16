/**
 * Deterministic TaskContract → ExecutionContract resolution (spec §1, §16, §37, §41 Phase 2;
 * v0.1.1 Wave 1 — T1, T4, T6, H2).
 *
 * Pure and deterministic: no clock, no randomness, no historical run state, no model inference.
 * The only environment inputs are the evidence binders, the model profile, and exactly one model
 * availability evidence channel.
 *
 * Everything that becomes resolved truth is RESOLVED EVIDENCE, never caller prose:
 *
 *   authority sources   → one authority binding each, with content digest (T1)
 *   assertions          → exactly one verifier identity each (T4)
 *   correction targets  → finding provenance + explicit acceptance provenance (T6)
 *   model availability  → an attested inventory, or an explicitly-classified claim (H2)
 *
 * A step that cannot establish its evidence fails closed; nothing is inferred, defaulted, or
 * repaired. Authority never binds by default, an unbound assertion never becomes acceptance, a
 * blocker identifier alone never authorizes `correct`, and a model is never selected from an
 * unspecified inventory.
 */

import { resolveAssertionBindings, type AssertionBinding, type AssertionBinder } from '../acceptance/assertion-binding.ts';
import type { EnvironmentEvidence, AttestationVerifier } from '../attestation/attestation.ts';
import type { AuthorityBinder } from '../authority/binder.ts';
import type { CharterError } from '../contracts/errors.ts';
import { TERMINAL_POLICY, type ExecutionContract } from '../contracts/execution-contract.ts';
import {
  ROLE_REPOSITORY_WRITES,
  type Permissions,
  type Role,
  type TaskContract,
} from '../contracts/task-contract.ts';
import {
  resolveCorrectionTargets,
  type CorrectionAuthorityBinder,
  type ResolvedCorrectionTarget,
} from '../correction/correction-authority.ts';
import { ROLE_JURISDICTION_DEFAULTS, resolveJurisdiction } from '../jurisdiction/jurisdiction.ts';
import { resolveEvidenceProvenance, type EvidenceProvenance } from '../provenance/evidence.ts';
import { resolveModel, resolveModelAvailability, routeModelTier, type ModelProfile } from '../routing/model-routing.ts';
import { validateTaskContract } from '../validation/validate.ts';

/** Resolver environment. Everything here is explicit input; nothing is discovered or inferred. */
export interface ResolverEnv {
  /** Phase 1 authority-binding interface (spec §13). Required: authority never binds by default. */
  authorityBinder: AuthorityBinder;
  /**
   * Resolves every declared assertion to exactly one verifier identity (T4). Required whenever the
   * contract declares assertions: an assertion with no verifier is not verifier-backed acceptance.
   */
  assertionBinder?: AssertionBinder;
  /** Resolves correction-target finding and explicit acceptance provenance (T6). Required for `correct`. */
  correctionBinder?: CorrectionAuthorityBinder;
  /** Model identities admitted per tier (spec §9). */
  profile: ModelProfile;
  /** Raw availability CLAIM supplied by the environment (spec §10). Recorded as a claim (H2). */
  available?: readonly string[];
  /** Attested model inventory from an admitted registry source (H2). Exactly one of these two. */
  model_availability_attestation?: unknown;
  /**
   * The explicit trusted-attestation boundary for that inventory (W1_ATTESTATION_SELF_PROMOTION). A
   * CAPABILITY the environment supplies, never a submitted value: with no verifier declared, the
   * submitted envelope is recorded as a claim and never as attested registry truth.
   */
  model_availability_attestation_verifier?: AttestationVerifier;
}

export type ResolutionResult =
  | { ok: true; contract: ExecutionContract }
  | { ok: false; errors: CharterError[] };

const RESOLVER_ENV_KEYS = [
  'authorityBinder',
  'assertionBinder',
  'correctionBinder',
  'profile',
  'available',
  'model_availability_attestation',
  'model_availability_attestation_verifier',
] as const;

/**
 * Resolve a contract. Fail-closed: an unvalidated, contradictory, unstaffable, or unevidenced
 * contract never produces an ExecutionContract, and no resolver default can widen the TaskContract
 * (§16).
 *
 * The step order is fixed so results are deterministic: configuration → validation → role
 * contradiction → authority provenance → assertion binding → correction authority → model
 * availability → model selection → resolution.
 */
export function resolveExecutionContract(input: unknown, env: ResolverEnv): ResolutionResult {
  const configErrors = checkEnv(env);
  if (configErrors.length > 0) return { ok: false, errors: configErrors };

  // Phase 1 validation runs inside resolution: an unvalidated contract is never resolved and the
  // resolver can never accept input that Phase 1 rejects (§12, §17).
  const validated = validateTaskContract(input, { authorityBinder: env.authorityBinder });
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const task = validated.contract;

  // A role whose purpose requires implementation authority cannot operate truthfully without it.
  // It is refused, never granted a permission the contract did not declare (§16).
  if (requiresImplementationAuthority(task.role) && !task.permissions.code_write) {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'permissions.code_write',
          message: `role=${task.role} requires implementation authority but permissions.code_write=false`,
        },
      ],
    };
  }

  // T1 — each declared authority reference resolves to exactly one binding, and the resolved
  // provenance (binding identity + content digest) is what the resolved artifact commits to. The
  // reference alone is symbolic and proves nothing about which content was bound.
  const provenance: EvidenceProvenance[] = [];
  for (const reference of task.authority.sources) {
    const resolved = resolveEvidenceProvenance(reference, env.authorityBinder.bind(reference));
    if (!resolved.ok) {
      return {
        ok: false,
        errors: [
          {
            code: 'AUTHORITY_UNRESOLVED',
            path: 'authority.sources',
            message: `authority '${reference}' ${resolved.reason}`,
          },
        ],
      };
    }
    provenance.push(resolved.provenance);
  }

  // T4 — a declared assertion is admitted only bound to exactly one verifier identity.
  const assertions = resolveAssertionBindings(task.acceptance.assertions ?? [], env.assertionBinder);
  if (!assertions.ok) return { ok: false, errors: assertions.errors };
  const assertionBindings: AssertionBinding[] = assertions.bindings;

  // T6 — `correct` behaves only on admitted targets: a named target whose finding provenance AND
  // explicit acceptance provenance both resolve. A blocker identifier is a target, never authority.
  const blockers = task.scope.blockers ?? [];
  let correctionTargets: ResolvedCorrectionTarget[] = [];
  if (task.role === 'correct') {
    if (blockers.length === 0) {
      return {
        ok: false,
        errors: [
          {
            code: 'CONTRACT_CONTRADICTION',
            path: 'scope.blockers',
            message:
              "role 'correct' requires at least one named accepted correction target in scope.blockers; no target is admitted by inference",
          },
        ],
      };
    }
    const resolved = resolveCorrectionTargets(blockers, env.correctionBinder);
    if (!resolved.ok) return { ok: false, errors: resolved.errors };
    correctionTargets = resolved.targets;
  }

  // H2 — model availability comes from exactly one evidence channel, and the resolved contract
  // records which one. A raw list is recorded as a claim, and a submitted registry envelope is a
  // candidate: it is attested inventory only where the explicit boundary vouched for it.
  const availability = resolveModelAvailability({
    ...(env.available !== undefined ? { available: env.available } : {}),
    ...(env.model_availability_attestation !== undefined
      ? { attestation: env.model_availability_attestation }
      : {}),
    ...(env.model_availability_attestation_verifier !== undefined
      ? { verifier: env.model_availability_attestation_verifier }
      : {}),
  });
  if (!availability.ok) return { ok: false, errors: [availability.error] };
  const modelAvailability: EnvironmentEvidence = availability.evidence;

  const tier = routeModelTier(task.role, task.task.class, task.task.risk);
  const selection = resolveModel(tier, env.profile, availability.models);
  if (!selection.ok) return { ok: false, errors: [selection.error] };

  const permissions = narrowPermissions(task);
  return {
    ok: true,
    contract: {
      version: 'charter/v0.1',
      task_id: task.task.id,
      execution_target: task.execution_target,
      role: task.role,
      model: selection.model,
      model_availability: modelAvailability,
      jurisdiction: resolveJurisdiction(task.role, permissions),
      // Authority binding was proven by validation in this same resolution step. The resolved set is
      // the declared set — never the binder's wider catalogue, never a guessed neighbour (§13, §16).
      authority: { bound_sources: [...task.authority.sources], provenance },
      // ponytail: v0.1 role defaults contribute no scope entries, so the declared scope is carried
      // verbatim; there is no code path that adds an entry. Add role scope entries only when a role
      // genuinely narrows scope, and intersect with the declared scope here.
      scope: structuredClone(task.scope),
      // The single canonical tool policy, carried verbatim: binding reads the ceiling from here and
      // from nowhere else (T3).
      ...(task.execution_policy ? { execution_policy: structuredClone(task.execution_policy) } : {}),
      permissions,
      acceptance: structuredClone(task.acceptance),
      assertion_bindings: assertionBindings,
      correction_targets: correctionTargets,
      verification: { level: task.verification.level },
      limits: structuredClone(task.limits ?? {}),
      non_goals: [...(task.non_goals ?? [])],
      // Provenance only: declared requirements cross into the resolved artifact verbatim, so the
      // binding step reads them from the contract itself rather than a separate caller channel.
      // Nothing here reinterprets, narrows, or broadens them, and a contract without requirements
      // resolves without requirements (§24, §16).
      ...(task.requirements ? { requirements: structuredClone(task.requirements) } : {}),
      terminal_state: { ...TERMINAL_POLICY },
    },
  };
}

/**
 * Roles whose purpose requires implementation authority (spec §7.2, §7.4), read from the single
 * frozen role-default table so the rule cannot drift from the jurisdiction it implies.
 */
function requiresImplementationAuthority(role: Role): boolean {
  return ROLE_JURISDICTION_DEFAULTS[role].implementation === 'bounded';
}

/**
 * Permission narrowing (spec §16, §21). Role defaults may only remove write permission:
 * `code_write` additionally requires the role's repository-mutation posture, so neither a role
 * default nor a resolver default can grant write authority the contract did not declare.
 */
function narrowPermissions(task: TaskContract): Permissions {
  return {
    code_write: task.permissions.code_write && ROLE_REPOSITORY_WRITES[task.role],
    research: task.permissions.research,
    external_write: task.permissions.external_write,
    release: task.permissions.release,
  };
}

/**
 * Fail closed on resolver configuration Charter does not implement. A key that does not constrain
 * the result must never be silently accepted as if it did (§2, §44), and a binder that is present
 * but unusable is refused here rather than discovered mid-resolution.
 */
function checkEnv(env: ResolverEnv): CharterError[] {
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    return [{ code: 'INVALID_TASK_CONTRACT', path: 'env', message: 'resolver environment must be an object' }];
  }
  const errors: CharterError[] = [];
  for (const key of Object.keys(env)) {
    if (!(RESOLVER_ENV_KEYS as readonly string[]).includes(key)) {
      errors.push({
        code: 'INVALID_TASK_CONTRACT',
        path: `env.${key}`,
        message: `unknown resolver configuration field 'env.${key}'`,
      });
    }
  }
  const binder: unknown = (env as { authorityBinder?: unknown }).authorityBinder;
  if (
    typeof binder !== 'object' ||
    binder === null ||
    typeof (binder as AuthorityBinder).bind !== 'function'
  ) {
    errors.push({
      code: 'AUTHORITY_UNRESOLVED',
      path: 'env.authorityBinder',
      message: 'an authority binder is required to resolve authority',
    });
  }
  const assertionBinder: unknown = (env as { assertionBinder?: unknown }).assertionBinder;
  if (assertionBinder !== undefined && !isBinder(assertionBinder)) {
    errors.push({
      code: 'INVALID_TASK_CONTRACT',
      path: 'env.assertionBinder',
      message: 'env.assertionBinder must be an evidence binder with a bind function',
    });
  }
  const correctionBinder: unknown = (env as { correctionBinder?: unknown }).correctionBinder;
  if (correctionBinder !== undefined && !isCorrectionBinder(correctionBinder)) {
    errors.push({
      code: 'INVALID_TASK_CONTRACT',
      path: 'env.correctionBinder',
      message: 'env.correctionBinder must carry both a findings binder and an acceptance binder',
    });
  }
  // The trust boundary is a capability or it is absent. A data value here would be a submitted
  // envelope trying to occupy the verifier's position, which is exactly the self-promotion this
  // boundary exists to stop; a verifier with nothing to verify is a contradiction, not a no-op.
  const availabilityVerifier: unknown = (env as { model_availability_attestation_verifier?: unknown })
    .model_availability_attestation_verifier;
  if (availabilityVerifier !== undefined && typeof availabilityVerifier !== 'function') {
    errors.push({
      code: 'INVALID_TASK_CONTRACT',
      path: 'env.model_availability_attestation_verifier',
      message:
        'env.model_availability_attestation_verifier must be an attestation verifier; a submitted value is not a trust boundary',
    });
  }
  if (availabilityVerifier !== undefined && env.model_availability_attestation === undefined) {
    errors.push({
      code: 'CONTRACT_CONTRADICTION',
      path: 'env.model_availability_attestation_verifier',
      message:
        'env.model_availability_attestation_verifier is present with no attestation to verify; a trust boundary is never supplied for a channel it does not govern',
    });
  }
  return errors;
}

function isBinder(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { bind?: unknown }).bind === 'function'
  );
}

function isCorrectionBinder(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const binder = value as { findings?: unknown; acceptances?: unknown };
  return isBinder(binder.findings) && isBinder(binder.acceptances);
}
