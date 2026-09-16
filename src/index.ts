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
