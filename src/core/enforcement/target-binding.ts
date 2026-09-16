/**
 * Execution-target capability truth and pure target binding (spec §23–§26, §37, §41 Phase 3).
 *
 * Phase 3 answers exactly one question truthfully: for this resolved contract, which named
 * constraints can the selected execution target HARD-ENFORCE, and which only reach it as
 * instruction? `ENFORCED` is never reported for a constraint the substrate cannot enforce, for a
 * constraint this contract declares no policy for, or on the strength of an unattested claim.
 *
 * v0.1.1 Wave 1 truth rules:
 *
 *   ENFORCED        the capability is ATTESTED by a candidate the supplied verifier vouched for, and
 *                   an applicable canonical policy exists (T2, T3)
 *   INSTRUCTED      a policy applies, but the target cannot hard-enforce it (or nothing attests it)
 *   UNSUPPORTED     the target has no primitive for the dimension
 *   NOT_APPLICABLE  this contract declares no policy for the dimension: there is nothing to enforce
 *                   and nothing to instruct, and Charter says exactly that instead of inventing truth
 *
 * A raw capability claim is not evidence (T2). `bindExecutionTargetFromClaim` binds it truthfully —
 * no constraint is ever reported `ENFORCED` from a claim — and the binding records the evidence
 * class, so a reader can see which path produced the truth. A submitted attestation is a CANDIDATE
 * too: it is validated fail-closed, and its booleans reach the truth table only when the trusted
 * attestation boundary this binding was wired with vouches for it (W1_ATTESTATION_SELF_PROMOTION,
 * W1_ATTESTATION_VERIFIER_FORGEABILITY). That boundary is a capability OBJECT recognised by
 * process-local identity, never a callback: a submitted function, a boundary-shaped record, a copy,
 * and a clone are all refused, so no caller can occupy the trusted position by supplying a value.
 * A candidate nobody vouches for is recorded as an unattested claim, so no source name, source kind,
 * or envelope field can promote itself to `ENFORCED`.
 *
 * The binding this module returns is the one and only artifact RoleEnvelope compilation accepts as
 * canonically bound (W1_ROLE_ENVELOPE_BINDING_PROVENANCE). A structurally valid, binding-shaped object
 * a caller authored — or a copy, clone, JSON roundtrip, or post-hoc edit of a real one — carries no
 * canonical provenance and renders no governance truth, because provenance here is not a field.
 *
 * Everything here is pure and explicit: no clock, no randomness, no registry, no discovery, no
 * persistence. Charter does not execute the work, and it does not implement a primitive the
 * substrate lacks (§24, §41).
 */

import {
  checkAttestationCandidate,
  claimedEvidence,
  resolveAttestationEvidence,
  type AttestationVerifier,
  type EnvironmentEvidence,
} from '../attestation/attestation.ts';
import { isIssuedAttestationVerifier } from '../attestation/trusted-boundary.ts';
import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import { evidenceIdentity } from '../provenance/evidence.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  ENFORCEMENT_REQUIREMENTS,
  EXECUTION_TARGETS,
  type AcceptanceReview,
  type EnforcementConstraint,
  type EnforcementRequirements,
  type ExecutionTargetName,
} from '../contracts/task-contract.ts';

// ── Enforcement truth (spec §23; v0.1.1 T2/T3) ──────────────────────────────

/**
 * Canonical enforcement truths. Exactly four, and each means only what it says: there is no softer
 * tier, and `NOT_APPLICABLE` is not a euphemism for a weaker enforcement — it states that this
 * contract declares no policy in that dimension.
 */
export const ENFORCEMENT_TRUTHS = ['ENFORCED', 'INSTRUCTED', 'UNSUPPORTED', 'NOT_APPLICABLE'] as const;
export type EnforcementTruth = (typeof ENFORCEMENT_TRUTHS)[number];

/** Truth per named constraint. Always complete: every constraint is reported, none is omitted. */
export type EnforcementTruthTable = Record<EnforcementConstraint, EnforcementTruth>;

// ── Capability evidence (spec §25; v0.1.1 T2) ───────────────────────────────

/** The capability axes the v0.1 snapshot is closed over. Exactly these five. */
export const TARGET_CAPABILITY_KEYS = [
  'model_selection',
  'fresh_session',
  'tool_ceiling',
  'file_scope_enforcement',
  'independent_review',
] as const;
export type TargetCapabilityKey = (typeof TARGET_CAPABILITY_KEYS)[number];
export type ExecutionTargetCapabilities = { [K in TargetCapabilityKey]: boolean };

/**
 * A raw capability CLAIM: booleans an environment asserts about a target, with nothing traceable
 * behind them. Input, not fact — and never evidence.
 */
export interface CapabilityClaim {
  name: ExecutionTargetName;
  capabilities: ExecutionTargetCapabilities;
}

// ── Canonical enforcement policy (v0.1.1 T3) ────────────────────────────────

/**
 * The applicable canonical policy for the constraints that require one. A policy is the EXACT
 * bounded thing that would be enforced — not a flag, not a requirement, not a neighbouring field:
 *
 *   allowed_tools  ← the contract's single tool-policy source (`execution_policy.allowed_tools`)
 *   allowed_files  ← exact non-empty `scope.files`
 *
 * `model_selection` needs no entry here: the resolved model block is its policy, and resolution
 * always produces one. `scope.sections` and `scope.symbols` are never file policy, and a missing
 * policy is never read as "everything is allowed".
 */
export interface EnforcementPolicy {
  allowed_tools?: readonly string[];
  files?: readonly string[];
}

// ── Target binding (spec §10 of the Phase 3 charter) ────────────────────────

/** A contract bound to capability CLAIM. Low-level: nothing here is attested, so nothing is ENFORCED. */
export interface ClaimTargetBindingInput {
  /** Phase 2 artifact. Its semantics are re-resolved nowhere and mutated nowhere. */
  execution_contract: ExecutionContract;
  /** Environment-supplied capability claim. Validated here, then discarded as evidence. */
  capability_claim: unknown;
}

/** A contract bound to a submitted capability ATTESTATION, which is a candidate until vouched for. */
export interface AttestedTargetBindingInput {
  /** Phase 2 artifact. Its semantics are re-resolved nowhere and mutated nowhere. */
  execution_contract: ExecutionContract;
  /** Submitted capability attestation. Validated fail-closed, then trusted only by the verifier. */
  capability_attestation: unknown;
  /**
   * The explicit trusted-attestation boundary (W1_ATTESTATION_SELF_PROMOTION). A CAPABILITY the
   * environment supplies, never a submitted value; without it the candidate is recorded as a claim
   * and no constraint can be reported `ENFORCED`.
   */
  capability_attestation_verifier?: AttestationVerifier;
}

export type TargetBindingInput = ClaimTargetBindingInput | AttestedTargetBindingInput;

/**
 * Target-bound truth: the resolved contract plus what the selected target can actually enforce.
 *
 * The `execution_contract` is carried as a value, so nothing downstream can reach the Phase 2
 * artifact through this result.
 */
export interface TargetBinding {
  target: ExecutionTargetName;
  enforcement: EnforcementTruthTable;
  /** How the enforcement truth was evidenced: attested environment truth, or an unattested claim. */
  capability_evidence: EnvironmentEvidence;
  execution_contract: ExecutionContract;
}

export type TargetBindingResult = { ok: true; binding: TargetBinding } | { ok: false; errors: CharterError[] };

// ── Canonical binding provenance (v0.1.1 W1_ROLE_ENVELOPE_BINDING_PROVENANCE) ─

/**
 * Canonical provenance for one binding, held OUTSIDE the value.
 *
 * `TargetBinding` is plain, readable, copyable data — which is exactly why its shape can never prove
 * anything: a caller can reproduce every field of a real binding, including an all-`ENFORCED` truth
 * table and attested capability evidence. Provenance is therefore process-local object identity in a
 * store that is never exported, integrity-bound to the exact payload that was bound:
 *
 *   identity   the object THIS process's binder returned, recognised in a non-exported WeakMap;
 *   integrity  SHA-256 over the four transported fields, so a bound value cannot be edited into one
 *              carrying forged enforcement truth or forged capability evidence.
 *
 * A spread, a copy, a `structuredClone`, and a JSON roundtrip are all new objects with no entry in
 * the store, so they are refused rather than trusted: canonical provenance is not a field anyone can
 * write, and it is not inherited by resemblance.
 *
 * This is deliberately process-local. Persisting or transporting a binding across a process boundary
 * would need an explicit re-cognition step, which v0.1.1 does not define and therefore does not
 * silently grant (spec §10).
 */
const CANONICAL_BINDINGS = new WeakMap<object, string>();
// ponytail: provenance is process-local, so a binding cannot be transported across a process boundary
// and stay canonical. Add an explicit re-cognition boundary (never a writable provenance field) when
// some real caller actually needs to move a binding between processes; nothing in v0.1.1 does.

/**
 * True only for a binding this process's canonical binder produced AND that still carries exactly the
 * payload it was bound with. Shape-valid binding data is never canonical by resemblance, and an
 * uncorroborated copy never becomes canonical by being copied.
 */
export function isCanonicalTargetBinding(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const bound = CANONICAL_BINDINGS.get(value);
  return bound !== undefined && bound === bindingIntegrity(value);
}

/**
 * SHA-256 over the exact bound payload: all four transported fields carry trust, so all four are
 * covered. Total by construction — a payload that cannot be canonically digested (a cycle, a getter
 * that throws) returns `undefined`, which matches no bound identity, so it fails closed instead of
 * crashing the compiler it was handed to.
 */
function bindingIntegrity(value: unknown): string | undefined {
  const binding = value as TargetBinding;
  try {
    return evidenceIdentity({
      target: binding.target,
      enforcement: binding.enforcement,
      capability_evidence: binding.capability_evidence,
      execution_contract: binding.execution_contract,
    });
  } catch {
    return undefined;
  }
}

/** Mint canonical provenance for one binding, bound to the exact payload returned to the caller. */
function markCanonicalTargetBinding(binding: TargetBinding): TargetBinding {
  const integrity = bindingIntegrity(binding);
  if (integrity !== undefined) CANONICAL_BINDINGS.set(binding, integrity);
  return binding;
}

const BINDING_INPUT_KEYS = [
  'execution_contract',
  'capability_claim',
  'capability_attestation',
  'capability_attestation_verifier',
] as const;
const CLAIM_KEYS = ['name', 'capabilities'] as const;
const ATTESTED_PAYLOAD_KEYS = ['target', 'capabilities'] as const;
const REQUIREMENTS_KEYS = ['enforcement'] as const;
const POLICY_KEYS = ['allowed_tools'] as const;
/** The one authorized enforcement-requirement path: inside the resolved contract (spec §24). */
const REQUIREMENTS_PATH = 'execution_contract.requirements';

type Err = (code: CharterErrorCode, path: string, message: string) => void;

/**
 * Truth of one constraint, given the ATTESTED capabilities of the target (`undefined` when nothing
 * is attested) and the applicable canonical policy.
 *
 *   model_selection    attested substrate model selection   → ENFORCED, otherwise UNSUPPORTED
 *   allowed_tools      attested tool ceiling + tool policy  → ENFORCED; policy without capability
 *                                                             → INSTRUCTED; no policy → NOT_APPLICABLE
 *   allowed_files      attested file-scope enforcement + exact files → ENFORCED; policy without
 *                                                             capability → INSTRUCTED; no policy →
 *                                                             NOT_APPLICABLE
 *   archaeology_off    no hard primitive exists              → INSTRUCTED
 *   release_forbidden  no hard primitive exists              → INSTRUCTED
 *
 * `model_selection` is `UNSUPPORTED` rather than `INSTRUCTED` because no prompt guidance can change
 * which model actually executes. Archaeology and release are reported `INSTRUCTED` because a prompt
 * instruction genuinely does reach the target — the target simply cannot prove compliance (§34, §24).
 */
export function evaluateEnforcement(
  capabilities: ExecutionTargetCapabilities | undefined,
  policy: EnforcementPolicy,
): EnforcementTruthTable {
  return {
    model_selection: capabilities?.model_selection ? 'ENFORCED' : 'UNSUPPORTED',
    allowed_tools: policyTruth(policy.allowed_tools, capabilities?.tool_ceiling),
    allowed_files: policyTruth(policy.files, capabilities?.file_scope_enforcement),
    archaeology_off: 'INSTRUCTED',
    release_forbidden: 'INSTRUCTED',
  };
}

/**
 * The one truth rule for a policy-bearing dimension: no policy means NOT_APPLICABLE (nothing to
 * enforce, nothing to instruct), and with a policy the attested primitive decides ENFORCED or
 * INSTRUCTED.
 */
function policyTruth(policy: readonly string[] | undefined, attested: boolean | undefined): EnforcementTruth {
  if (!policy?.length) return 'NOT_APPLICABLE';
  return attested === true ? 'ENFORCED' : 'INSTRUCTED';
}

/**
 * True when the contract requires review to run outside the working session (spec §26.1).
 * `independent` implies it: independence inside the same context is not independence.
 */
export function requiresFreshSession(review: AcceptanceReview | undefined): boolean {
  return (
    review?.required === true &&
    (review.executor === 'fresh_session' || review.independence === 'independent')
  );
}

/**
 * Bind an ExecutionContract to the selected target's capability boundary (spec §25, §26).
 *
 * Pure and deterministic: same contract and evidence always produce a deep-equivalent binding, and
 * neither input is mutated. Fail-closed at every step — an unusable claim or attestation, an
 * unusable requirement carried by the contract, an unrecognized attestation source, a target that
 * cannot enforce what the contract requires, or a target that cannot provide the required review all
 * refuse to produce a binding rather than report softer truth.
 */
export function bindExecutionTarget(input: TargetBindingInput): TargetBindingResult {
  const errors: CharterError[] = [];
  const err: Err = (code, path, message) => {
    errors.push({ code, message, path });
  };

  const raw: unknown = input;
  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [{ code: 'INVALID_TASK_CONTRACT', path: '', message: 'target binding input must be an object' }],
    };
  }
  const hasClaim = raw.capability_claim !== undefined;
  const hasAttestation = raw.capability_attestation !== undefined;
  const hasVerifier = raw.capability_attestation_verifier !== undefined;
  if (hasClaim && hasAttestation) {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: '',
          message:
            'capability_claim and capability_attestation are both present; exactly one evidence channel is admitted',
        },
      ],
    };
  }
  if (!hasClaim && !hasAttestation) {
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_TASK_CONTRACT',
          path: '',
          message: 'an explicit capability claim or attestation is required to bind an execution target',
        },
      ],
    };
  }
  // A boundary with nothing to verify is a contradiction rather than a silently ignored wiring: the
  // verifier is only ever read on the channel it governs, so a claim can never be read as vouched for.
  if (hasVerifier && !hasAttestation) {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'capability_attestation_verifier',
          message:
            'capability_attestation_verifier is present with no capability_attestation to verify; a trust boundary is never supplied for a channel it does not govern',
        },
      ],
    };
  }
  // Every capability key is admitted here so the rules above are the single report.
  checkUnknownKeys(raw, BINDING_INPUT_KEYS, '', err);

  const contract: unknown = raw.execution_contract;
  if (!isRecord(contract) || !isOneOf(contract.execution_target, EXECUTION_TARGETS)) {
    err(
      'INVALID_TASK_CONTRACT',
      'execution_contract.execution_target',
      'binding requires a resolved ExecutionContract with a canonical execution_target',
    );
    return { ok: false, errors };
  }
  const target = contract.execution_target;

  // Capability truth comes from one of two channels, and neither is trusted by shape.
  let capabilities: ExecutionTargetCapabilities | undefined;
  let capabilityEvidence: EnvironmentEvidence | undefined;
  if (hasClaim) {
    const claim = checkClaim(raw.capability_claim, target, err);
    if (claim !== undefined) {
      // A claim is recorded as a claim. Its booleans never become trusted capability, so no
      // constraint can be reported ENFORCED on their strength (T2).
      const evidence = claimedEvidence(claim);
      if (!evidence.ok) {
        err('INVALID_TASK_CONTRACT', 'capability_claim', `the claimed capabilities are not canonicalizable (${evidence.reason})`);
      } else {
        capabilityEvidence = evidence.evidence;
      }
    }
  } else {
    // The submitted attestation is a candidate: the verifier is the only thing that can make it
    // trusted evidence, and only the verifier it is handed can say so (W1_ATTESTATION_SELF_PROMOTION).
    let verifier: AttestationVerifier | undefined;
    if (hasVerifier) {
      if (!isIssuedAttestationVerifier(raw.capability_attestation_verifier)) {
        err(
          'INVALID_TASK_CONTRACT',
          'capability_attestation_verifier',
          'capability_attestation_verifier must be a trusted attestation boundary minted by this environment; a submitted function, record, or copy is not a trust boundary',
        );
      } else {
        verifier = raw.capability_attestation_verifier;
      }
    }
    const attested = checkCapabilityAttestationCandidate(raw.capability_attestation, target, verifier, err);
    if (attested !== undefined) {
      capabilities = attested.capabilities;
      capabilityEvidence = attested.evidence;
    }
  }

  // The resolved contract is the only enforcement-requirement and policy channel: binding reads
  // both from it and never from a second input the contract does not vouch for (spec §24).
  const requirements: EnforcementRequirements | undefined = checkRequirements(contract.requirements, err);
  const policy = checkPolicy(contract, err);
  // `requirements` may legitimately be absent (no hard requirement declared); capability evidence and
  // policy may not: each is either established above or reported as a failure.
  if (capabilityEvidence === undefined || policy === undefined || errors.length > 0) {
    return { ok: false, errors };
  }

  // Truth is evaluated only for a target identity that matched this exact contract, and only from
  // attested capability and applicable policy (T2, T3).
  const enforcement = evaluateEnforcement(capabilities, policy);
  checkRequiredEnforcement(requirements, enforcement, target, err);
  checkReviewCapability(contract.acceptance, capabilities, target, err);
  if (errors.length > 0) return { ok: false, errors };

  const binding: TargetBinding = {
    target,
    enforcement,
    capability_evidence: capabilityEvidence,
    // SAFETY: `contract` is the resolved ExecutionContract this binding was handed. Only its target
    // identity and policy-bearing fields are re-read above, because re-validating a resolved
    // contract is Phase 1/2 work that Phase 3 deliberately does not repeat. Cloning keeps the
    // Phase 2 artifact unreachable.
    execution_contract: structuredClone(contract as unknown as ExecutionContract),
  };
  // Canonical provenance is minted here and only here, so no other value in the process can be
  // accepted by RoleEnvelope compilation as canonically bound (W1_ROLE_ENVELOPE_BINDING_PROVENANCE).
  return { ok: true, binding: markCanonicalTargetBinding(binding) };
}

/**
 * Bind from a raw capability claim (low-level path). The name says what the input is: a claim, not
 * attestation. No constraint is ever reported `ENFORCED` on this path, so it must never be used
 * where hard enforcement is being asserted.
 */
export function bindExecutionTargetFromClaim(input: ClaimTargetBindingInput): TargetBindingResult {
  return bindExecutionTarget(input);
}

/**
 * Bind from a submitted capability attestation (the strong channel). This path reports `ENFORCED`
 * only for evidence the supplied verifier vouched for, and only together with an applicable
 * canonical policy; an unvouched candidate is bound as the claim it is.
 */
export function bindExecutionTargetFromAttestationCandidate(
  input: AttestedTargetBindingInput,
): TargetBindingResult {
  return bindExecutionTarget(input);
}

/**
 * Validate a capability claim fail-closed (spec §25). Unknown fields, an unknown target, a missing
 * axis, and a non-boolean axis are all configuration errors — never silently ignored or defaulted,
 * since a default here would fabricate capability the environment never stated.
 */
function checkClaim(claim: unknown, target: ExecutionTargetName, err: Err): CapabilityClaim | undefined {
  if (!isRecord(claim)) {
    err('INVALID_TASK_CONTRACT', 'capability_claim', 'a capability claim must be an object');
    return undefined;
  }
  checkUnknownKeys(claim, CLAIM_KEYS, 'capability_claim', err);
  let describesThisTarget = false;
  if (!isOneOf(claim.name, EXECUTION_TARGETS)) {
    err(
      'INVALID_TASK_CONTRACT',
      'capability_claim.name',
      `capability_claim.name must be one of ${EXECUTION_TARGETS.join('|')}`,
    );
  } else if (claim.name !== target) {
    // No silent substitution: a claim about one target is never read as a claim about another.
    err(
      'CONTRACT_CONTRADICTION',
      'capability_claim.name',
      `contract selects execution_target=${target} but the capability claim describes name=${claim.name}`,
    );
  } else {
    describesThisTarget = true;
  }
  const capabilities = checkCapabilityAxes(claim.capabilities, 'capability_claim.capabilities', err);
  if (capabilities === undefined || !describesThisTarget) return undefined;
  return { name: target, capabilities };
}

/**
 * Validate a submitted capability attestation candidate fail-closed: an admitted source kind, a
 * declared source identity, and a canonical payload naming this exact target with every axis stated.
 *
 * Validation settles the SHAPE. Capability truth settles on the verifier: the axes are returned only
 * when the evidence the boundary produced is `attested`, so an unvouched candidate yields no trusted
 * capability at all and no constraint can be reported `ENFORCED` from it.
 */
function checkCapabilityAttestationCandidate(
  raw: unknown,
  target: ExecutionTargetName,
  verifier: AttestationVerifier | undefined,
  err: Err,
): { capabilities: ExecutionTargetCapabilities | undefined; evidence: EnvironmentEvidence } | undefined {
  const candidate = checkAttestationCandidate(raw, 'capability_attestation', 'execution_adapter', err);
  if (candidate === undefined) return undefined;
  const payload = candidate.payload;
  if (!isRecord(payload)) {
    err('INVALID_TASK_CONTRACT', 'capability_attestation.payload', 'capability_attestation.payload must be an object');
    return undefined;
  }
  checkUnknownKeys(payload, ATTESTED_PAYLOAD_KEYS, 'capability_attestation.payload', err);
  if (!isOneOf(payload.target, EXECUTION_TARGETS)) {
    err(
      'INVALID_TASK_CONTRACT',
      'capability_attestation.payload.target',
      `capability_attestation.payload.target must be one of ${EXECUTION_TARGETS.join('|')}`,
    );
    return undefined;
  }
  if (payload.target !== target) {
    err(
      'CONTRACT_CONTRADICTION',
      'capability_attestation.payload.target',
      `contract selects execution_target=${target} but the attestation describes target=${payload.target}`,
    );
    return undefined;
  }
  const axes = checkCapabilityAxes(payload.capabilities, 'capability_attestation.payload.capabilities', err);
  if (axes === undefined) return undefined;
  const evidence = resolveAttestationEvidence(candidate, verifier);
  if (!evidence.ok) {
    err(
      'INVALID_TASK_CONTRACT',
      'capability_attestation.payload',
      `the attested capability payload is not canonicalizable evidence (${evidence.reason})`,
    );
    return undefined;
  }
  // The gate: these booleans are trusted capability only if the boundary vouched for the candidate.
  return {
    capabilities: evidence.evidence.class === 'attested' ? axes : undefined,
    evidence: evidence.evidence,
  };
}

/** Every axis must be stated explicitly as a boolean; a partial set is refused, never defaulted. */
function checkCapabilityAxes(
  raw: unknown,
  path: string,
  err: Err,
): ExecutionTargetCapabilities | undefined {
  if (!isRecord(raw)) {
    err('INVALID_TASK_CONTRACT', path, `${path} must be an object`);
    return undefined;
  }
  checkUnknownKeys(raw, TARGET_CAPABILITY_KEYS, path, err);
  let complete = true;
  for (const key of TARGET_CAPABILITY_KEYS) {
    const value = raw[key];
    if (value === undefined) {
      err(
        'INVALID_TASK_CONTRACT',
        `${path}.${key}`,
        `capability '${key}' is missing; a complete capability set must state every axis explicitly`,
      );
      complete = false;
    } else if (typeof value !== 'boolean') {
      err('INVALID_TASK_CONTRACT', `${path}.${key}`, `capability '${key}' must be a boolean`);
      complete = false;
    }
  }
  return complete ? (raw as ExecutionTargetCapabilities) : undefined;
}

/**
 * Validate the hard requirements carried by the resolved contract fail-closed (spec §24). Only the
 * five canonical constraint names and the single value `required` are admitted; nothing is scored,
 * ranked, or defaulted, and a malformed contract requirement is refused rather than ignored.
 */
function checkRequirements(requirements: unknown, err: Err): EnforcementRequirements | undefined {
  if (requirements === undefined) return undefined; // no hard requirement declared
  if (!isRecord(requirements)) {
    err('INVALID_TASK_CONTRACT', REQUIREMENTS_PATH, `${REQUIREMENTS_PATH} must be an object`);
    return undefined;
  }
  checkUnknownKeys(requirements, REQUIREMENTS_KEYS, REQUIREMENTS_PATH, err);
  const enforcement = requirements.enforcement;
  if (enforcement === undefined) return undefined;
  if (!isRecord(enforcement)) {
    err('INVALID_TASK_CONTRACT', `${REQUIREMENTS_PATH}.enforcement`, `${REQUIREMENTS_PATH}.enforcement must be an object`);
    return undefined;
  }
  checkUnknownKeys(enforcement, ENFORCEMENT_CONSTRAINTS, `${REQUIREMENTS_PATH}.enforcement`, err);
  for (const constraint of ENFORCEMENT_CONSTRAINTS) {
    const value = enforcement[constraint];
    if (value === undefined) continue; // not required
    if (!isOneOf(value, ENFORCEMENT_REQUIREMENTS)) {
      err(
        'INVALID_TASK_CONTRACT',
        `${REQUIREMENTS_PATH}.enforcement.${constraint}`,
        `${REQUIREMENTS_PATH}.enforcement.${constraint} must be '${ENFORCEMENT_REQUIREMENTS[0]}'`,
      );
    }
  }
  return enforcement as EnforcementRequirements;
}

/**
 * Read the applicable canonical policy out of the resolved contract (T3). A declared policy that is
 * malformed is refused rather than silently treated as "no policy", because "no policy" is itself a
 * governance-bearing answer here.
 */
function checkPolicy(contract: Record<string, unknown>, err: Err): EnforcementPolicy | undefined {
  let files: readonly string[] | undefined;
  const scope = contract.scope;
  if (isRecord(scope) && scope.files !== undefined) {
    if (!isStringList(scope.files)) {
      err(
        'INVALID_TASK_CONTRACT',
        'execution_contract.scope.files',
        'execution_contract.scope.files must be a list of file identities to act as this file policy',
      );
      return undefined;
    }
    // An empty list declares no file policy: it is not a policy of "no files".
    if (scope.files.length > 0) files = [...scope.files];
  }

  let allowedTools: readonly string[] | undefined;
  const policy = contract.execution_policy;
  if (isRecord(policy) && policy.allowed_tools !== undefined) {
    if (!isStringList(policy.allowed_tools)) {
      err(
        'INVALID_TASK_CONTRACT',
        'execution_contract.execution_policy.allowed_tools',
        'execution_contract.execution_policy.allowed_tools must be a list of tool identities to act as this tool policy',
      );
      return undefined;
    }
    if (policy.allowed_tools.length > 0) allowedTools = [...policy.allowed_tools];
  } else if (policy !== undefined && !isRecord(policy)) {
    err('INVALID_TASK_CONTRACT', 'execution_contract.execution_policy', 'execution_contract.execution_policy must be an object');
    return undefined;
  }
  if (isRecord(policy)) checkUnknownKeys(policy, POLICY_KEYS, 'execution_contract.execution_policy', err);

  return { ...(allowedTools ? { allowed_tools: allowedTools } : {}), ...(files ? { files } : {}) };
}

/**
 * A required constraint binds only where the target reports `ENFORCED` (spec §24). `INSTRUCTED`,
 * `UNSUPPORTED`, and `NOT_APPLICABLE` all fail closed — Charter does not build the missing sandbox
 * and does not invent the missing policy to make it pass.
 */
function checkRequiredEnforcement(
  requirements: EnforcementRequirements | undefined,
  enforcement: EnforcementTruthTable,
  target: ExecutionTargetName,
  err: Err,
): void {
  for (const constraint of ENFORCEMENT_CONSTRAINTS) {
    if (requirements?.[constraint] !== 'required') continue;
    const truth = enforcement[constraint];
    if (truth !== 'ENFORCED') {
      err(
        'UNSUPPORTED_BY_EXECUTION_TARGET',
        `${REQUIREMENTS_PATH}.enforcement.${constraint}`,
        `execution_target=${target} reports ${truth} for '${constraint}'; the contract requires hard enforcement and Charter does not invent the missing capability or policy`,
      );
    }
  }
}

/**
 * Review completeness the target must truthfully provide (spec §26.1). Independence is never
 * fabricated: it requires both a fresh session and substrate-level independent review (§9 Phase 3).
 * An unattested capability cannot ground either.
 */
function checkReviewCapability(
  acceptance: unknown,
  capabilities: ExecutionTargetCapabilities | undefined,
  target: ExecutionTargetName,
  err: Err,
): void {
  const review = isRecord(acceptance) && isRecord(acceptance.review) ? acceptance.review : undefined;
  if (!review || review.required !== true) return;
  if (review.executor === 'fresh_session' && capabilities?.fresh_session !== true) {
    err(
      'UNSUPPORTED_BY_EXECUTION_TARGET',
      'acceptance.review.executor',
      `execution_target=${target} cannot execute the required review in a fresh session (fresh_session is not attested true)`,
    );
  }
  if (review.independence === 'independent' && !(capabilities?.fresh_session === true && capabilities.independent_review === true)) {
    err(
      'UNSUPPORTED_BY_EXECUTION_TARGET',
      'acceptance.review.independence',
      `execution_target=${target} cannot provide independent review (fresh_session=${capabilities?.fresh_session ?? 'unattested'}, independent_review=${capabilities?.independent_review ?? 'unattested'})`,
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  err: Err,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const path = prefix ? `${prefix}.${key}` : key;
      err('INVALID_TASK_CONTRACT', path, `unknown field '${path}'`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}
