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

import type { EnvironmentEvidence } from '../../core/attestation/attestation.ts';
import type { CharterError } from '../../core/contracts/errors.ts';
import type { ExecutionContract } from '../../core/contracts/execution-contract.ts';
import type { Permissions, Role, Scope } from '../../core/contracts/task-contract.ts';
import {
  requiresFreshSession,
  type EnforcementTruthTable,
  type TargetBinding,
} from '../../core/enforcement/target-binding.ts';
import type { EvidenceProvenance } from '../../core/provenance/evidence.ts';
import type { ModelTier } from '../../core/routing/model-routing.ts';

/**
 * Bounded handoff parameters for a `subagents` target.
 *
 * Only what the contract already carries is handed over: no role prompt of its own (the Phase 4 core
 * role-envelope compiler renders it from this binding), no lifecycle handle. `execution_contract` is
 * carried as a value.
 */
export interface SubagentsHandoff {
  target: 'subagents';
  role: Role;
  /** The declared bounded scope, carried verbatim. */
  scope: Scope;
  /** The narrowed permissions resolution produced. Copied, never widened. */
  permissions: Permissions;
  /**
   * The resolved model identity actually selected — never the tier preference, never a substitute.
   * `routing` below states what that identity is evidence OF, which is not the same question.
   */
  model: string;
  /**
   * The model ROUTING REQUIREMENT (CN2): the tier the substrate must resolve, and how that
   * requirement is evidenced. Charter observes no child runtime, so the truth is
   * `REQUIREMENT_ONLY`: this is what the substrate must select, never proof of what the child ran.
   */
  routing: { tier: ModelTier; truth: 'REQUIREMENT_ONLY' };
  /**
   * The bounded allowed tool set this contract declares, or an empty list when it declares no tool
   * policy (T3). An empty list is the absence of a policy, never "all tools allowed".
   */
  allowed_tools: string[];
  /** The declared acceptance commands, carried verbatim so the substrate runs what was admitted. */
  acceptance_commands: string[];
  /** The authority identity this handoff acts under: the bound references and their provenance. */
  authority: { bound_sources: string[]; provenance: EvidenceProvenance[] };
  /**
   * True when the contract requires review outside the working session (spec §26.1).
   *
   * At this adapter boundary the value is exactly that contract requirement. The delegation compile
   * unions it with the operator's stated fresh-session requirement into ONE dispatch freshness truth
   * and mirrors that truth here, so a consumer never sees this boolean disagree with
   * `DelegationHandoff.fresh_context` about whether the child session must be fresh.
   */
  fresh_session_required: boolean;
  /** Actual enforcement truth for the selected target. Never inferred, never upgraded. */
  enforcement: EnforcementTruthTable;
  /** How that truth was evidenced: attested environment truth, or an unattested claim (T2). */
  capability_evidence: EnvironmentEvidence;
  execution_contract: ExecutionContract;
}

export type SubagentsBindingResult =
  | { ok: true; handoff: SubagentsHandoff }
  | { ok: false; errors: CharterError[] };

/**
 * Bind a contract to the `subagents` target and translate the bound truth into handoff parameters.
 * A contract selecting another target is refused rather than silently re-targeted.
 */
export function bindSubagentsTarget(binding: TargetBinding): SubagentsBindingResult {
  if (binding.target !== 'subagents') {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'execution_target',
          message: `the subagents adapter cannot serve execution_target=${binding.target}; no target is substituted`,
        },
      ],
    };
  }
  const contract = binding.execution_contract;
  return {
    ok: true,
    handoff: {
      target: 'subagents',
      role: contract.role,
      scope: structuredClone(contract.scope),
      permissions: { ...contract.permissions },
      model: contract.model.resolved,
      // The routing requirement, labelled as one: the substrate resolves the tier, and nothing here
      // claims the child actually ran that model (CN2).
      routing: { tier: contract.model.tier, truth: 'REQUIREMENT_ONLY' },
      // The canonical tool policy crosses the boundary as a value: the substrate enforces a ceiling
      // only when the contract declares one (T3).
      allowed_tools: [...(contract.execution_policy?.allowed_tools ?? [])],
      acceptance_commands: [...(contract.acceptance?.commands ?? [])],
      authority: {
        bound_sources: [...contract.authority.bound_sources],
        provenance: structuredClone(contract.authority.provenance),
      },
      fresh_session_required: requiresFreshSession(contract.acceptance?.review),
      enforcement: binding.enforcement,
      capability_evidence: binding.capability_evidence,
      execution_contract: contract,
    },
  };
}
