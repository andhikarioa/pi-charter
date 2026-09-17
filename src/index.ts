/**
 * pi-charter — small public surface for the governance compiler.
 *
 * Public callers state bounded task intent and compile it. Internal validation, resolver, target
 * binding, instruction, receipt, attestation-boundary, and host-authority phases are deliberately not
 * separate SDK contracts.
 */

export { ERROR_CODES } from './core/contracts/errors.ts';
export type { CharterError, CharterErrorCode } from './core/contracts/errors.ts';

export {
  ROLES,
  TASK_CLASSES,
  RISKS,
  VERIFICATION_LEVELS,
  EXECUTION_TARGETS,
  STRUCTURED_ACTIONS,
  ENFORCEMENT_CONSTRAINTS,
  ENFORCEMENT_REQUIREMENTS,
} from './core/contracts/task-contract.ts';
export type {
  Role,
  TaskClass,
  Risk,
  VerificationLevel,
  ExecutionTargetName,
  Permissions,
  Authority,
  Scope,
  AcceptanceReview,
  Acceptance,
  TaskDescriptor,
  StructuredAction,
  EnforcementConstraint,
  EnforcementRequirement,
  EnforcementRequirements,
  TaskRequirements,
  ExecutionPolicy,
  TaskContract,
} from './core/contracts/task-contract.ts';

export type { ExecutionContract } from './core/contracts/execution-contract.ts';
export type { EvidenceBinding, EvidenceBinder, EvidenceProvenance } from './core/provenance/evidence.ts';
export { createEvidenceBinder } from './core/provenance/evidence.ts';
export type { AssertionBinder, AssertionBinding } from './core/acceptance/assertion-binding.ts';
export type { CorrectionAuthorityBinder, ResolvedCorrectionTarget } from './core/correction/correction-authority.ts';

export { createAuthorityBinder } from './core/authority/binder.ts';
export type { AuthorityBinder } from './core/authority/binder.ts';

export { MODEL_TIERS } from './core/routing/model-routing.ts';
export type { ModelTier, ModelProfile, ModelSelection, TierModels } from './core/routing/model-routing.ts';

export { ENFORCEMENT_TRUTHS } from './core/enforcement/target-binding.ts';
export type {
  EnforcementTruth,
  EnforcementTruthTable,
  ExecutionTargetCapabilities,
  TargetBinding,
} from './core/enforcement/target-binding.ts';

export { compileForTarget } from './core/compile/compile-for-target.ts';
export type {
  CompileForTargetInput,
  CompiledGovernance,
  CompileForTargetResult,
} from './core/compile/compile-for-target.ts';

export {
  OPERATOR_FRESH_VALUES,
  OPERATOR_DEFAULT_TASK_CLASS,
  OPERATOR_DEFAULT_RISK,
  OPERATOR_DEFAULT_VERIFICATION_LEVEL,
  normalizeOperatorRequest,
} from './operator/operator-request.ts';
export type {
  OperatorFreshValue,
  NormalizedOperatorRequest,
  OperatorRequestResult,
  OperatorRequestEnv,
} from './operator/operator-request.ts';

export {
  describeAcceptance,
  renderAcceptanceLines,
  renderParentCompile,
  renderDelegationCompile,
  REFUSAL_GUIDANCE,
  renderRefusal,
} from './operator/operator-surface.ts';
export type { AcceptanceSurfaceTruth, ParentCompileSurface } from './operator/operator-surface.ts';

export {
  DELEGATION_FRESH_CONTEXT,
  DELEGATION_CAPABILITY_SOURCE,
  DELEGATION_HANDOFF_STATUS,
  DELEGATION_EXECUTION_PROOF,
  compileDelegation,
} from './delegation/compile-delegation.ts';
export type {
  DelegationFreshContext,
  DelegationCompileInput,
  DelegationHandoff,
  DelegationTruth,
  DelegationCompileSuccess,
  DelegationCompileResult,
} from './delegation/compile-delegation.ts';

/** Ordinary external adapter integration. Host trust authority remains internal to the shipped Pi seam. */
export { createAdapterIntegration } from './integration/adapter-integration.ts';
export type {
  AdapterCapabilityObservation,
  AdapterCapabilityObservationResult,
  AdapterCompileInput,
  AdapterCompileResult,
  AdapterCompileSuccess,
  AdapterEnvironmentObservation,
  AdapterIntegration,
  AdapterIntegrationOptions,
  AdapterObservationResult,
} from './integration/adapter-integration.ts';
