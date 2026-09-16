/**
 * pi-charter v0.1 — Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 surface.
 * TaskContract schema, fail-closed validation, deterministic resolution to an ExecutionContract,
 * truthful execution-target capability binding with thin parent/subagents adapters, deterministic
 * role-envelope compilation for the five canonical roles, one pure bounded next-action policy, and
 * an optional evidence-only resolution receipt.
 * v0.1.1 Wave 1 adds resolved evidence provenance: authority binding identity and content digest,
 * verifier-bound assertions, admitted correction targets, attested-versus-claimed environment
 * evidence, a canonical tool policy, and a required compiler identity on the receipt.
 * Charter resolves governance, compiles instructions, and decides a bounded next action; the
 * execution substrate owns execution, retries, and lifecycle.
 */
export * from './core/contracts/errors.ts';
export * from './core/contracts/task-contract.ts';
export * from './core/contracts/execution-contract.ts';
export * from './core/provenance/evidence.ts';
// Attestation is the one explicit allow-list on this surface (W1_ATTESTATION_VERIFIER_FORGEABILITY):
// the package admits candidate validation, evidence resolution, and the boundary TYPE, and never the
// trusted-boundary minter. A caller therefore holds no way to occupy the trusted-attestation position
// through the package surface — only a candidate path that can never be attested. The minter lives in
// core/attestation/trusted-boundary.ts and core/attestation/attestation.ts and is reached only by the
// blessed adapter/fixture seam.
export {
  ATTESTATION_SOURCE_KINDS,
  ENVIRONMENT_EVIDENCE_CLASSES,
  checkAttestationCandidate,
  checkEnvironmentEvidence,
  claimedEvidence,
  resolveAttestationEvidence,
} from './core/attestation/attestation.ts';
export type {
  AttestationCandidate,
  AttestationSourceKind,
  AttestationVerifier,
  EnvironmentEvidence,
  EnvironmentEvidenceClass,
} from './core/attestation/attestation.ts';
export * from './core/authority/binder.ts';
export * from './core/acceptance/assertion-binding.ts';
export * from './core/correction/correction-authority.ts';
export * from './core/validation/validate.ts';
export * from './core/routing/model-routing.ts';
export * from './core/jurisdiction/jurisdiction.ts';
export * from './core/resolver/resolve.ts';
export * from './core/enforcement/target-binding.ts';
export * from './core/envelopes/role-envelope.ts';
export * from './adapters/parent/parent-adapter.ts';
export * from './adapters/subagents/subagents-adapter.ts';
export * from './core/escalation/escalation-policy.ts';
export * from './core/receipt/resolution-receipt.ts';
// v0.1.1 Wave 2 surface: post-execution conformance evidence, the one blessed composition facade,
// and the minimum Pi-native bridge.
//
// Execution evidence is the second place trust enters Charter, and it is bounded the same way as the
// first: an attestation is EVIDENCE only when a substrate/adaptor issuance boundary minted it, and
// that boundary is recognised by process-local identity in a store the package never exports
// (`core/execution/trusted-execution-boundary.ts`). This surface therefore admits the pure verifier
// and the evidence vocabulary, and never `createExecutionAttestationIssuer` — a caller holds no way
// to author trusted execution evidence through the package. A caller-authored object with the right
// fields, a copy, a clone, and a JSON roundtrip all stay claims, which is exactly what
// `verifyExecutionAttestation` reports as `UNTRUSTED_EXECUTION_EVIDENCE`.
export {
  ACCEPTANCE_EVIDENCE_STATUSES,
  EXECUTION_ATTESTATION_VERSION,
  EXECUTION_DEVIATION_CODES,
  EXECUTION_VERDICTS,
  verifyExecutionAttestation,
} from './core/execution/execution-attestation.ts';
export type {
  AcceptanceEvidenceStatus,
  AcceptanceVerification,
  AssertionExecutionEvidence,
  ExecutionAttestation,
  ExecutionDeviation,
  ExecutionDeviationCode,
  ExecutionSubstrateIdentity,
  ExecutionVerificationInput,
  ExecutionVerificationResult,
  ExecutionVerdict,
} from './core/execution/execution-attestation.ts';
export * from './core/compile/compile-for-target.ts';
export * from './bridge/pi-bridge.ts';
// Final correction (F1/F3): the one supported adapter-facing integration contract. An external
// substrate adapter registers observations and core promotes them into trusted evidence; compile-time
// admission handles carry the exact execution artifact link. The raw execution-evidence issuer, the
// attestation verifier factory, and the process-local boundary stores stay absent from this surface.
export * from './integration/adapter-integration.ts';
