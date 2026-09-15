/**
 * Thin `subagents` adapter (spec §27, §41 Phase 3).
 *
 * Scope is deliberately one-directional: the adapter translates already-resolved Charter truth into
 * bounded handoff parameters. It spawns no child, tracks no child, retries nothing, recovers nothing,
 * owns no worktree, no process, no lock, and no child lifecycle — that is substrate responsibility,
 * and Charter does not reimplement it.
 *
 * No pi-subagents API is imported or assumed here. There is no authorized runtime bridge in this
 * repository, so this file is the pure Charter-side translation boundary and nothing more.
 */

import type { CharterError } from '../../core/contracts/errors.ts';
import type { ExecutionContract } from '../../core/contracts/execution-contract.ts';
import type { Role } from '../../core/contracts/task-contract.ts';
import {
  bindExecutionTarget,
  requiresFreshSession,
  type EnforcementTruthTable,
  type TargetBindingInput,
} from '../../core/enforcement/target-binding.ts';

/**
 * Bounded handoff parameters for a `subagents` target.
 *
 * Only what the contract already carries is handed over: no role prompt of its own (the Phase 4 core
 * role-envelope compiler renders it from this binding), no tool list (the contract declares none), no
 * lifecycle handle. `execution_contract` is carried as a value.
 */
export interface SubagentsHandoff {
  target: 'subagents';
  role: Role;
  /** The resolved model identity actually selected — never the tier preference, never a substitute. */
  model: string;
  /** True when the contract requires review outside the working session (spec §26.1). */
  fresh_session_required: boolean;
  /** Actual enforcement truth for the selected target. Never inferred, never upgraded. */
  enforcement: EnforcementTruthTable;
  execution_contract: ExecutionContract;
}

export type SubagentsBindingResult =
  | { ok: true; handoff: SubagentsHandoff }
  | { ok: false; errors: CharterError[] };

/**
 * Bind a contract to the `subagents` target and translate the bound truth into handoff parameters.
 * A contract selecting another target is refused rather than silently re-targeted.
 */
export function bindSubagentsTarget(input: TargetBindingInput): SubagentsBindingResult {
  const bound = bindExecutionTarget(input);
  if (!bound.ok) return bound;
  if (bound.binding.target !== 'subagents') {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'execution_target',
          message: `the subagents adapter cannot serve execution_target=${bound.binding.target}; no target is substituted`,
        },
      ],
    };
  }
  const contract = bound.binding.execution_contract;
  return {
    ok: true,
    handoff: {
      target: 'subagents',
      role: contract.role,
      model: contract.model.resolved,
      fresh_session_required: requiresFreshSession(contract.acceptance?.review),
      enforcement: bound.binding.enforcement,
      execution_contract: contract,
    },
  };
}
