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
 *   ENFORCED        the capability is ATTESTED and an applicable canonical policy exists (T2, T3)
 *   INSTRUCTED      a policy applies, but the target cannot hard-enforce it (or nothing attests it)
 *   UNSUPPORTED     the target has no primitive for the dimension
 *   NOT_APPLICABLE  this contract declares no policy for the dimension: there is nothing to enforce
 *                   and nothing to instruct, and Charter says exactly that instead of inventing truth
 *
 * A raw capability claim is not evidence (T2). `bindExecutionTargetFromClaim` binds it truthfully —
 * no constraint is ever reported `ENFORCED` from a claim — and the binding records the evidence
 * class, so a reader can see which of the two paths produced the truth. Strong enforcement comes
 * only from an attestation traceable to an explicit evidence source, validated fail-closed here.
 *
 * Everything here is pure and explicit: no clock, no randomness, no registry, no discovery, no
 * persistence. Charter does not execute the work, and it does not implement a primitive the
 * substrate lacks (§24, §41).
 */

import {
  attestedEvidence,
  checkAttestationEnvelope,
  claimedEvidence,
  type EnvironmentEvidence,
} from '../attestation/attestation.ts';
import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
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

/** A contract bound to capability ATTESTATION from an explicit evidence source. */
export interface AttestedTargetBindingInput {
  /** Phase 2 artifact. Its semantics are re-resolved nowhere and mutated nowhere. */
  execution_contract: ExecutionContract;
  /** Attested capability evidence, traceable to an admitted evidence source. Validated fail-closed. */
  capability_attestation: unknown;
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

const BINDING_INPUT_KEYS = ['execution_contract', 'capability_claim', 'capability_attestation'] as const;
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
  // Both capability keys are admitted here so the exclusivity rule above is the single report.
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

  // Capability truth comes from one of two channels, and only one of them can be trusted.
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
    const attested = checkAttestation(raw.capability_attestation, target, err);
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

  return {
    ok: true,
    binding: {
      target,
      enforcement,
      capability_evidence: capabilityEvidence,
      // SAFETY: `contract` is the resolved ExecutionContract this binding was handed. Only its target
      // identity and policy-bearing fields are re-read above, because re-validating a resolved
      // contract is Phase 1/2 work that Phase 3 deliberately does not repeat. Cloning keeps the
      // Phase 2 artifact unreachable.
      execution_contract: structuredClone(contract as unknown as ExecutionContract),
    },
  };
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
 * Bind from attested capability evidence (the strong path). Only this path can report `ENFORCED`,
 * and only together with an applicable canonical policy.
 */
export function bindExecutionTargetFromAttestation(input: AttestedTargetBindingInput): TargetBindingResult {
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
 * Validate attested capability evidence fail-closed: an admitted source kind, a traceable source
 * identity, and a canonical payload naming this exact target with every axis stated.
 */
function checkAttestation(
  raw: unknown,
  target: ExecutionTargetName,
  err: Err,
): { capabilities: ExecutionTargetCapabilities; evidence: EnvironmentEvidence } | undefined {
  const envelope = checkAttestationEnvelope(raw, 'capability_attestation', 'execution_adapter', err);
  if (envelope === undefined) return undefined;
  const payload = envelope.payload;
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
  const capabilities = checkCapabilityAxes(payload.capabilities, 'capability_attestation.payload.capabilities', err);
  if (capabilities === undefined) return undefined;
  const evidence = attestedEvidence(envelope);
  if (!evidence.ok) {
    err(
      'INVALID_TASK_CONTRACT',
      'capability_attestation.payload',
      `the attested capability payload is not canonicalizable evidence (${evidence.reason})`,
    );
    return undefined;
  }
  return { capabilities, evidence: evidence.evidence };
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
