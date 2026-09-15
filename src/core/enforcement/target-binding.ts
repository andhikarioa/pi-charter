/**
 * Execution-target capability truth and pure target binding (spec §23–§26, §37, §41 Phase 3).
 *
 * Phase 3 answers exactly one question truthfully: for this resolved contract, which named
 * constraints can the selected execution target HARD-ENFORCE, and which only reach it as
 * instruction? `ENFORCED` is never reported for a constraint the substrate cannot enforce (§23, E10).
 *
 * Everything here is pure and explicit: no clock, no randomness, no registry, no discovery, no
 * persistence. The capability snapshot is an environment input — ephemeral, validated fail-closed
 * on arrival, and never remembered.
 *
 * Charter does not execute the work, and it does not implement a primitive the substrate lacks. A
 * missing primitive is reported (`UNSUPPORTED` / `INSTRUCTED`), never manufactured (§24, §41).
 */

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

// ── Enforcement truth (spec §23) ────────────────────────────────────────────

/** Canonical enforcement truths. Exactly three; there is no fourth, softer tier. */
export const ENFORCEMENT_TRUTHS = ['ENFORCED', 'INSTRUCTED', 'UNSUPPORTED'] as const;
export type EnforcementTruth = (typeof ENFORCEMENT_TRUTHS)[number];

/** Truth per named constraint. Always complete: every constraint is reported, none is omitted. */
export type EnforcementTruthTable = Record<EnforcementConstraint, EnforcementTruth>;

// ── Capability snapshot (spec §25) ──────────────────────────────────────────

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
 * Explicit description of what a target can hard-enforce, supplied by the execution environment.
 *
 * Input, not fact: it is not a target registry, not a runtime database, not a worker registry, and
 * not something Charter discovers from the environment (spec §25).
 */
export interface ExecutionTargetCapabilitySnapshot {
  name: ExecutionTargetName;
  capabilities: ExecutionTargetCapabilities;
}

// ── Target binding (spec §10 of the Phase 3 charter) ────────────────────────

export interface TargetBindingInput {
  /** Phase 2 artifact. Its semantics are re-resolved nowhere and mutated nowhere. */
  execution_contract: ExecutionContract;
  /** Environment-supplied capability snapshot. Validated here, then discarded. */
  capability_snapshot: unknown;
}

/**
 * Target-bound truth: the resolved contract plus what the selected target can actually enforce.
 *
 * The `execution_contract` is carried as a value, so nothing downstream can reach the Phase 2
 * artifact through this result.
 */
export interface TargetBinding {
  target: ExecutionTargetName;
  enforcement: EnforcementTruthTable;
  execution_contract: ExecutionContract;
}

export type TargetBindingResult = { ok: true; binding: TargetBinding } | { ok: false; errors: CharterError[] };

const BINDING_INPUT_KEYS = ['execution_contract', 'capability_snapshot'] as const;
const SNAPSHOT_KEYS = ['name', 'capabilities'] as const;
const REQUIREMENTS_KEYS = ['enforcement'] as const;
/** The one authorized enforcement-requirement path: inside the resolved contract (spec §24). */
const REQUIREMENTS_PATH = 'execution_contract.requirements';

type Err = (code: CharterErrorCode, path: string, message: string) => void;

/**
 * Truth of one constraint, given what the target can hard-enforce:
 *
 *   model_selection    substrate selects models      → ENFORCED, otherwise UNSUPPORTED
 *   allowed_tools      hard tool ceiling             → ENFORCED, otherwise INSTRUCTED
 *   allowed_files      hard file-scope enforcement   → ENFORCED, otherwise INSTRUCTED
 *   archaeology_off    no hard primitive exists      → INSTRUCTED
 *   release_forbidden  no hard primitive exists      → INSTRUCTED
 *
 * `model_selection` is `UNSUPPORTED` rather than `INSTRUCTED` because no prompt guidance can change
 * which model actually executes: the honest report is that model selection is not available here.
 * Archaeology and release are reported `INSTRUCTED` because a prompt instruction genuinely does
 * reach the target — the target simply cannot prove compliance (§34, §24).
 */
export function evaluateEnforcement(capabilities: ExecutionTargetCapabilities): EnforcementTruthTable {
  return {
    model_selection: capabilities.model_selection ? 'ENFORCED' : 'UNSUPPORTED',
    allowed_tools: capabilities.tool_ceiling ? 'ENFORCED' : 'INSTRUCTED',
    allowed_files: capabilities.file_scope_enforcement ? 'ENFORCED' : 'INSTRUCTED',
    archaeology_off: 'INSTRUCTED',
    release_forbidden: 'INSTRUCTED',
  };
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
 * Pure and deterministic: same contract and snapshot always produce a deep-equivalent binding, and
 * neither input is mutated. Fail-closed at every step — an unusable snapshot, an unusable
 * requirement carried by the contract, a target that cannot enforce what the contract requires, or
 * a target that cannot provide the required review all refuse to produce a binding rather than
 * report softer truth.
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
  checkUnknownKeys(raw, BINDING_INPUT_KEYS, '', err);
  if (raw.capability_snapshot === undefined) {
    err(
      'INVALID_TASK_CONTRACT',
      'capability_snapshot',
      'an explicit capability snapshot is required to bind an execution target',
    );
  }

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

  const capabilities = checkSnapshot(raw.capability_snapshot, target, err);
  // The resolved contract is the only enforcement-requirement channel: binding reads requirements
  // from it and never from a second input the contract does not vouch for, so a caller cannot drop,
  // replace, weaken, strengthen, or override what resolution carried through (spec §24).
  const requirements: EnforcementRequirements | undefined = checkRequirements(contract.requirements, err);
  if (capabilities === undefined || errors.length > 0) return { ok: false, errors };

  // Truth is evaluated only for a snapshot that describes this exact target: the identity check above
  // must fail closed rather than report truth about a target the contract did not select (§25).
  const enforcement = evaluateEnforcement(capabilities);
  checkRequiredEnforcement(requirements, enforcement, target, err);
  checkReviewCapability(contract.acceptance, capabilities, target, err);
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    binding: {
      target,
      enforcement,
      // SAFETY: `contract` is the resolved ExecutionContract this binding was handed. Only its target
      // identity is re-checked above, because re-validating a resolved contract is Phase 1/2 work
      // that Phase 3 deliberately does not repeat. Cloning keeps the Phase 2 artifact unreachable.
      execution_contract: structuredClone(contract as unknown as ExecutionContract),
    },
  };
}

/**
 * Validate the snapshot fail-closed (spec §25). Unknown fields, an unknown target, a missing axis,
 * and a non-boolean axis are all configuration errors — never silently ignored or defaulted, since
 * a default here would fabricate enforcement truth the environment never stated.
 */
function checkSnapshot(
  snapshot: unknown,
  target: ExecutionTargetName,
  err: Err,
): ExecutionTargetCapabilities | undefined {
  if (!isRecord(snapshot)) {
    err('INVALID_TASK_CONTRACT', 'capability_snapshot', 'capability snapshot must be an object');
    return undefined;
  }
  checkUnknownKeys(snapshot, SNAPSHOT_KEYS, 'capability_snapshot', err);
  if (!isOneOf(snapshot.name, EXECUTION_TARGETS)) {
    err(
      'INVALID_TASK_CONTRACT',
      'capability_snapshot.name',
      `capability_snapshot.name must be one of ${EXECUTION_TARGETS.join('|')}`,
    );
  } else if (snapshot.name !== target) {
    // No silent substitution: truth about one target is never reported for another (spec §25).
    err(
      'CONTRACT_CONTRADICTION',
      'capability_snapshot.name',
      `contract selects execution_target=${target} but the capability snapshot describes name=${snapshot.name}`,
    );
  }

  const capabilities = snapshot.capabilities;
  if (!isRecord(capabilities)) {
    err('INVALID_TASK_CONTRACT', 'capability_snapshot.capabilities', 'capability_snapshot.capabilities must be an object');
    return undefined;
  }
  checkUnknownKeys(capabilities, TARGET_CAPABILITY_KEYS, 'capability_snapshot.capabilities', err);
  let complete = true;
  for (const key of TARGET_CAPABILITY_KEYS) {
    const value = capabilities[key];
    if (value === undefined) {
      err(
        'INVALID_TASK_CONTRACT',
        `capability_snapshot.capabilities.${key}`,
        `capability '${key}' is missing; a snapshot must state every axis explicitly`,
      );
      complete = false;
    } else if (typeof value !== 'boolean') {
      err('INVALID_TASK_CONTRACT', `capability_snapshot.capabilities.${key}`, `capability '${key}' must be a boolean`);
      complete = false;
    }
  }
  return complete ? (capabilities as ExecutionTargetCapabilities) : undefined;
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
 * A required constraint binds only where the target reports `ENFORCED` (spec §24). `INSTRUCTED` and
 * `UNSUPPORTED` both fail closed — Charter does not build the missing sandbox to make it pass.
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
        `execution_target=${target} can only report ${truth} for '${constraint}'; the contract requires hard enforcement and Charter does not implement the missing primitive`,
      );
    }
  }
}

/**
 * Review completeness the target must truthfully provide (spec §26.1). Independence is never
 * fabricated: it requires both a fresh session and substrate-level independent review (§9 Phase 3).
 */
function checkReviewCapability(
  acceptance: unknown,
  capabilities: ExecutionTargetCapabilities,
  target: ExecutionTargetName,
  err: Err,
): void {
  const review = isRecord(acceptance) && isRecord(acceptance.review) ? acceptance.review : undefined;
  if (!review || review.required !== true) return;
  if (review.executor === 'fresh_session' && !capabilities.fresh_session) {
    err(
      'UNSUPPORTED_BY_EXECUTION_TARGET',
      'acceptance.review.executor',
      `execution_target=${target} cannot execute the required review in a fresh session (fresh_session=false)`,
    );
  }
  if (review.independence === 'independent' && !(capabilities.fresh_session && capabilities.independent_review)) {
    err(
      'UNSUPPORTED_BY_EXECUTION_TARGET',
      'acceptance.review.independence',
      `execution_target=${target} cannot provide independent review (fresh_session=${capabilities.fresh_session}, independent_review=${capabilities.independent_review})`,
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

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}
