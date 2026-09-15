/**
 * ExecutionContract — the resolved, bounded artifact of Phase 2 (spec §35).
 *
 * Phase 2 emits semantic fields plus the declared hard-enforcement requirements carried verbatim
 * from the validated TaskContract. Enforcement truth, execution-target capability snapshots, and
 * adapters belong to Phase 3 and are deliberately absent here.
 */

import type { Jurisdiction } from '../jurisdiction/jurisdiction.ts';
import type { ModelSelection } from '../routing/model-routing.ts';
import type {
  Acceptance,
  ExecutionTargetName,
  Limits,
  Permissions,
  Role,
  Scope,
  TaskRequirements,
  VerificationLevel,
} from './task-contract.ts';

/** Canonical terminal policy (spec §20, §29, §30). Policy only — Charter tracks no correction rounds. */
export interface TerminalPolicy {
  success: 'acceptance_verified';
  ambiguity: 'escalate';
  limit_exceeded: 'human_decision_required';
}

/** The single terminal policy v0.1 resolves to. Frozen; never shared as mutable state. */
export const TERMINAL_POLICY: TerminalPolicy = Object.freeze({
  success: 'acceptance_verified',
  ambiguity: 'escalate',
  limit_exceeded: 'human_decision_required',
});

export interface ExecutionContract {
  version: 'charter/v0.1';
  task_id: string;
  execution_target: ExecutionTargetName;
  role: Role;
  model: ModelSelection;
  jurisdiction: Jurisdiction;
  /** The declared authority references, each proven to bind uniquely (spec §13, §16). */
  authority: { bound_sources: string[] };
  scope: Scope;
  permissions: Permissions;
  acceptance: Acceptance;
  verification: { level: VerificationLevel };
  limits: Limits;
  non_goals: string[];
  /**
   * Hard enforcement requirements declared by the validated TaskContract, carried verbatim (spec
   * §24). Resolution neither reinterprets, narrows, nor broadens them; target binding reads them
   * from here and accepts no second, caller-supplied requirements channel.
   */
  requirements?: TaskRequirements;
  terminal_state: TerminalPolicy;
}
