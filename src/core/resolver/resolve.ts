/**
 * Deterministic TaskContract → ExecutionContract resolution (spec §1, §16, §37, §41 Phase 2).
 *
 * Pure and deterministic: no clock, no randomness, no historical run state, no model inference.
 * The only environment inputs are the authority binder, the model profile, and the explicit model
 * availability snapshot.
 */

import type { AuthorityBinder } from '../authority/binder.ts';
import type { CharterError } from '../contracts/errors.ts';
import { TERMINAL_POLICY, type ExecutionContract } from '../contracts/execution-contract.ts';
import {
  ROLE_REPOSITORY_WRITES,
  type Permissions,
  type Role,
  type TaskContract,
} from '../contracts/task-contract.ts';
import { ROLE_JURISDICTION_DEFAULTS, resolveJurisdiction } from '../jurisdiction/jurisdiction.ts';
import { resolveModel, routeModelTier, type ModelProfile } from '../routing/model-routing.ts';
import { validateTaskContract } from '../validation/validate.ts';

/** Resolver environment. Everything here is explicit input; nothing is discovered or inferred. */
export interface ResolverEnv {
  /** Phase 1 authority-binding interface (spec §13). Required: authority never binds by default. */
  authorityBinder: AuthorityBinder;
  /** Model identities admitted per tier (spec §9). */
  profile: ModelProfile;
  /** Current model availability supplied by the execution environment (spec §10). */
  available: readonly string[];
}

export type ResolutionResult =
  | { ok: true; contract: ExecutionContract }
  | { ok: false; errors: CharterError[] };

const RESOLVER_ENV_KEYS = ['authorityBinder', 'profile', 'available'] as const;

/**
 * Resolve a contract. Fail-closed: an unvalidated, contradictory, or unstaffable contract never
 * produces an ExecutionContract, and no resolver default can widen the TaskContract (§16).
 *
 * The step order is fixed so results are deterministic: configuration → validation → role
 * contradiction → model selection → resolution.
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

  const tier = routeModelTier(task.role, task.task.class, task.task.risk);
  const selection = resolveModel(tier, env.profile, env.available);
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
      jurisdiction: resolveJurisdiction(task.role, permissions),
      // Authority binding was proven by validation in this same resolution step. The resolved set is
      // the declared set — never the binder's wider catalogue, never a guessed neighbour (§13, §16).
      authority: { bound_sources: [...task.authority.sources] },
      // ponytail: v0.1 role defaults contribute no scope entries, so the declared scope is carried
      // verbatim; there is no code path that adds an entry. Add role scope entries only when a role
      // genuinely narrows scope, and intersect with the declared scope here.
      scope: structuredClone(task.scope),
      permissions,
      acceptance: structuredClone(task.acceptance),
      verification: { level: task.verification.level },
      limits: structuredClone(task.limits ?? {}),
      non_goals: [...(task.non_goals ?? [])],
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
 * the result must never be silently accepted as if it did (§2, §44).
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
  return errors;
}
