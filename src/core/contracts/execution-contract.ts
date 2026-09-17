/**
 * ExecutionContract — the resolved, bounded artifact of Phase 2 (spec §35).
 *
 * Phase 2 emits semantic fields plus the declared hard-enforcement requirements carried verbatim
 * from the validated TaskContract. Enforcement truth, execution-target capability snapshots, and
 * adapters belong to Phase 3 and are deliberately absent here.
 *
 * v0.1.1 Wave 1 additions are all RESOLVED EVIDENCE, never caller prose restated:
 *
 *   authority.provenance     the binding identity and content digest resolution actually bound (T1)
 *   assertion_bindings       each declared assertion bound to exactly one verifier identity (T4);
 *                            strong enough for `ASSERTION_BOUND`, never `ASSERTION_VERIFIED`
 *   correction_targets       admitted correction targets with finding + acceptance provenance (T6)
 *   execution_policy         the single canonical tool policy (T3)
 *   model_availability       how model availability was evidenced: attested registry truth, or an
 *                            explicitly-classified unattested claim (H2)
 */

import type { AssertionBinding } from '../acceptance/assertion-binding.ts';
import type { EnvironmentEvidence } from '../attestation/attestation.ts';
import type { ResolvedCorrectionTarget } from '../correction/correction-authority.ts';
import type { EvidenceProvenance } from '../provenance/evidence.ts';
import type { ModelSelection } from '../routing/model-routing.ts';
import type {
  Acceptance,
  ExecutionPolicy,
  ExecutionTargetName,
  Permissions,
  Role,
  Scope,
  TaskRequirements,
  VerificationLevel,
} from './task-contract.ts';

export interface ExecutionContract {
  version: 'charter/v0.1';
  task_id: string;
  execution_target: ExecutionTargetName;
  role: Role;
  model: ModelSelection;
  /** How the resolved model was evidenced. An unattested claim is recorded as one (H2). */
  model_availability: EnvironmentEvidence;
  authority: {
    /** The declared authority references, each proven to bind uniquely (spec §13, §16). */
    bound_sources: string[];
    /**
     * Resolved provenance per reference, in declared order (T1). The reference stays symbolic; the
     * binding identity and content digest are the evidence a proof commits to.
     */
    provenance: EvidenceProvenance[];
  };
  scope: Scope;
  /** The single canonical tool policy, carried verbatim from the validated TaskContract (T3). */
  execution_policy?: ExecutionPolicy;
  permissions: Permissions;
  acceptance: Acceptance;
  /**
   * Verifier-bound acceptance evidence per declared assertion (T4). `verifier` is the verifier
   * identity, so binding the same assertion to a different verifier changes this contract's identity.
   */
  assertion_bindings: AssertionBinding[];
  /** Admitted correction targets (role=correct): target id plus finding and acceptance provenance. */
  correction_targets: ResolvedCorrectionTarget[];
  verification: { level: VerificationLevel };
  non_goals: string[];
  /**
   * Hard enforcement requirements declared by the validated TaskContract, carried verbatim (spec
   * §24). Resolution neither reinterprets, narrows, nor broadens them; target binding reads them
   * from here and accepts no second, caller-supplied requirements channel.
   */
  requirements?: TaskRequirements;
}
