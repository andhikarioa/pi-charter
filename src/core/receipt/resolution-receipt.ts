/**
 * Resolution receipt (spec §36, §37, §41 Phase 5).
 *
 * A receipt is EVIDENCE, not workflow state (spec §36). It records the already-established outcome
 * of a successful deterministic resolution: the identities of the evidence resolution ran on, the
 * resolved governance truth, and the Phase 3 enforcement truth. It decides nothing, is read by
 * nothing in the pipeline, and carries no lifecycle field.
 *
 *   TaskContract
 *   + authority binder (spec §13)
 *   + resolution inputs (model profile, explicit availability)
 *   + execution-target capability snapshot
 *            ↓
 *   validate → resolve → bind   (canonical Phase 1–3, reused, never restated here)
 *            ↓
 *   claimed TargetBinding compared with the recomputed one
 *            ↓
 *   ResolutionReceipt
 *
 * One direction only. Resolved values are DERIVED from the recomputed binding and from the
 * recomputed ExecutionContract; there is no `resolved_role`, `resolved_model`, `permissions`, or
 * `enforcement_truth` channel of its own, and an unknown input key fails closed rather than being
 * ignored (spec §16, Phase 4 §3).
 *
 * Provenance coherence: a receipt is not an assembly of whatever artifacts a caller hands over. It
 * is only emitted for evidence that is one coherent canonical pipeline result — the supplied
 * environment inputs are pushed through the canonical Phase 1–3 functions, and the artifact the
 * caller claims that run produced must BE the result. A TaskContract whose permissions, scope, or
 * authority differ from the bound ExecutionContract; a profile or availability set that cannot
 * produce the resolved model; a capability snapshot that implies different enforcement truth or is
 * missing an axis; a claimed binding that is not the one this evidence resolves to — all are refused
 * (`CONTRACT_CONTRADICTION`). `VALID` and `RESOLVED` are therefore emitted only after both truths
 * have actually been established for one run.
 *
 * Emission is optional. Nothing in Charter emits a receipt automatically and nothing consumes one:
 * a caller that wants a receipt asks for one, and a caller that never asks is unaffected. The value
 * returned is the caller's; a caller MAY persist it outside Charter, which is substrate/operator
 * responsibility, never Charter behavior.
 *
 * A failed resolution emits no receipt. The evidence of a failure is the `CharterError[]` the caller
 * already holds; modelling failure here would turn evidence into lifecycle state. For the same
 * reason there is no receipt store, no registry, no query API, no history, no latest-receipt
 * discovery, no reconciliation, and no recovery — and no scheduler, lock, lease, or worker state.
 *
 * Charter configuration boundary (v0.1 limitation): v0.1 has no standalone Charter configuration
 * object, so no `charter_config` identity is invented. The frozen product version — `charter/v0.1`
 * — is the only truthful configuration identity available, and `contract_version` records exactly
 * that. The limitation is stated here rather than hidden behind a fabricated configuration artifact.
 *
 * Determinism (spec §37): every identity is SHA-256 over a canonical serialization — object keys
 * sorted, array order preserved, built-in `node:crypto` only, no external dependency. There is no
 * clock, timestamp, random UUID, process-local sequence, or mutable counter: same evidence always
 * yields the same identity, and changed evidence always yields a different one.
 */

import { createHash } from 'node:crypto';

import type { AuthorityBinder } from '../authority/binder.ts';
import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  type Permissions,
  type Role,
  type TaskContract,
} from '../contracts/task-contract.ts';
import {
  bindExecutionTarget,
  type EnforcementTruthTable,
  type ExecutionTargetCapabilitySnapshot,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import type { Jurisdiction } from '../jurisdiction/jurisdiction.ts';
import { resolveExecutionContract } from '../resolver/resolve.ts';
import type { ModelProfile, ModelSelection } from '../routing/model-routing.ts';
import { validateTaskContract } from '../validation/validate.ts';

/** The frozen v0.1 configuration boundary (see header). */
export const RECEIPT_CONTRACT_VERSION = 'charter/v0.1' as const;

/** The only validation outcome a receipt can record: the recorded contract passed Phase 1. */
export const RECEIPT_VALIDATION_RESULT = 'VALID' as const;

/** The only resolution outcome a receipt can record: resolution produced the recorded contract. */
export const RECEIPT_RESOLUTION_RESULT = 'RESOLVED' as const;

/**
 * Compact immutable evidence of one successful resolution (spec §36). Every field is `readonly`, the
 * returned value is deep-frozen, and no field is a handle to a caller-owned structure.
 *
 * Deliberately absent: every lifecycle, run, worker, session, queue, retry, lease, lock, and
 * recovery field. This type cannot express workflow state, which is why no policy reads it.
 */
export interface ResolutionReceipt {
  /** Product version; the only truthful Charter configuration identity v0.1 has (see header). */
  readonly contract_version: typeof RECEIPT_CONTRACT_VERSION;

  /** Identity of the normalized Phase 1 artifact this resolution ran on (spec §12). */
  readonly task_contract_identity: string;
  /** Identity of the admitted model profile resolution ran under (spec §9). */
  readonly model_profile_identity: string;
  /** Identity of the explicit availability snapshot resolution ran under (spec §10). */
  readonly model_availability_identity: string;
  /** Identity of the capability snapshot Phase 3 truth was evaluated against (spec §25). */
  readonly execution_target_capability_snapshot_identity: string;
  /** Identity of the resolved Phase 2 artifact. */
  readonly execution_contract_identity: string;

  /** Resolved governance truth, derived from the bound ExecutionContract. */
  readonly resolved_role: Role;
  readonly resolved_model: ModelSelection;
  readonly resolved_jurisdiction: Jurisdiction;
  readonly resolved_permissions: Permissions;

  /** Phase 3 truth, carried from the binding. Never recomputed here, never upgraded. */
  readonly enforcement_truth: EnforcementTruthTable;

  /** The already-established step outcomes this receipt records. Closed literals, never supplied. */
  readonly validation_result: typeof RECEIPT_VALIDATION_RESULT;
  readonly resolution_result: typeof RECEIPT_RESOLUTION_RESULT;

  /** SHA-256 over every other field, canonically serialized. */
  readonly receipt_identity: string;
}

/**
 * The only admitted receipt input: the environment inputs one pipeline run was wired with, plus the
 * Phase 3 artifact the caller claims that run produced.
 *
 * Validation, resolution, and binding are re-run here from these inputs through the canonical Phase
 * 1–3 functions, so this type admits no pipeline rule of its own. The claimed binding is compared
 * against the recomputed one; when they disagree, the receipt is refused rather than recording
 * blended truth.
 */
export interface ResolutionReceiptInput {
  /** The Phase 1 input: the contract that was validated and then resolved. */
  task_contract: TaskContract;
  /** The Phase 1 authority-binding interface that run was wired with (spec §13). */
  authority_binder: AuthorityBinder;
  /** The admitted model profile the resolution ran under (spec §9). */
  model_profile: ModelProfile;
  /** The explicit availability snapshot the resolution ran under (spec §10). */
  model_availability: readonly string[];
  /** The execution-environment capability snapshot Phase 3 was given (spec §25). */
  capability_snapshot: ExecutionTargetCapabilitySnapshot;
  /** The Phase 3 artifact the caller claims this evidence produced. Compared, never trusted. */
  target_binding: TargetBinding;
}

export type ResolutionReceiptResult =
  | { ok: true; receipt: ResolutionReceipt }
  | { ok: false; errors: CharterError[] };

const RECEIPT_INPUT_KEYS = [
  'task_contract',
  'authority_binder',
  'model_profile',
  'model_availability',
  'capability_snapshot',
  'target_binding',
] as const;
const BINDING_KEYS = ['target', 'enforcement', 'execution_contract'] as const;

type Err = (code: CharterErrorCode, path: string, message: string) => void;

/**
 * Create the evidence of one successful resolution (spec §36). Pure and deterministic: same
 * evidence always produces a deep-equivalent, identically-identified, deep-frozen receipt, and
 * neither the input nor any artifact it carries is mutated.
 *
 * Fail-closed: the pipeline is recomputed from the supplied environment inputs, and the caller's
 * claimed binding must BE that result. A malformed artifact, an unstaffable tier, a snapshot the
 * target cannot satisfy, an artifact pair that could not have come from one run, or any unknown
 * input key refuses to produce a receipt rather than recording evidence that does not describe one
 * run.
 */
export function createResolutionReceipt(input: unknown): ResolutionReceiptResult {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: '', message: 'resolution receipt input must be an object' }] };
  }
  // No parallel channel: `resolved_role`, `resolved_model`, `permissions`, `enforcement_truth`, and
  // every other governance-looking key has no admitted meaning here, so it is refused rather than
  // ignored (spec §16). Resolved truth is derived below, never supplied.
  const errors: CharterError[] = [];
  const err: Err = (code, path, message) => {
    errors.push({ code, message, path });
  };
  checkUnknownKeys(input, RECEIPT_INPUT_KEYS, '', err);
  if (errors.length > 0) return { ok: false, errors };

  const binder = input.authority_binder as AuthorityBinder;
  // Phase 1–3 run again, through the canonical functions and their own rules: nothing here restates
  // a validation, resolution, or binding rule, and a bad input returns that step's truthful failure.
  const validated = validateTaskContract(input.task_contract, { authorityBinder: binder });
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const resolved = resolveExecutionContract(validated.contract, {
    authorityBinder: binder,
    profile: input.model_profile as ModelProfile,
    available: input.model_availability as readonly string[],
  });
  if (!resolved.ok) return { ok: false, errors: resolved.errors };

  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_snapshot: input.capability_snapshot,
  });
  if (!bound.ok) return { ok: false, errors: bound.errors };

  // The supplied evidence must BE that result. A claim that disagrees with the run these environment
  // inputs actually produce — different permissions, scope, authority, model, or enforcement truth —
  // is refused, so `VALID`/`RESOLVED` are never emitted for a blended receipt.
  const contradictions = checkClaimedEvidence(bound.binding, input.target_binding);
  if (contradictions.length > 0) return { ok: false, errors: contradictions };

  // The recomputed artifacts are the receipt's only truth channel: this is what the supplied
  // evidence resolves to, and it is read by field, never re-derived.
  const canonical = bound.binding.execution_contract;
  // The complete evidence projection. `validation_result` and `resolution_result` are the closed
  // outcomes the recomputed artifacts imply — a receipt exists only because both steps succeeded —
  // and are literals here, never caller-supplied statements.
  const evidence = {
    contract_version: RECEIPT_CONTRACT_VERSION,
    task_contract_identity: identity(validated.contract),
    model_profile_identity: identity(input.model_profile),
    model_availability_identity: identity(input.model_availability),
    execution_target_capability_snapshot_identity: identity(input.capability_snapshot),
    execution_contract_identity: identity(canonical),
    resolved_role: canonical.role,
    resolved_model: structuredClone(canonical.model),
    resolved_jurisdiction: structuredClone(canonical.jurisdiction),
    resolved_permissions: structuredClone(canonical.permissions),
    enforcement_truth: structuredClone(bound.binding.enforcement),
    validation_result: RECEIPT_VALIDATION_RESULT,
    resolution_result: RECEIPT_RESOLUTION_RESULT,
  };
  // Cloned before return and deep-frozen, so the receipt shares no mutably-reachable structure with
  // the caller and mutation attempts cannot change receipt truth.
  const receipt: ResolutionReceipt = deepFreeze({ ...evidence, receipt_identity: identity(evidence) });
  return { ok: true, receipt };
}

// ── Claimed-evidence coherence ──────────────────────────────────────────────

/**
 * Compare the claimed Phase 3 artifact against the binding the supplied evidence actually resolves
 * to. Deterministic, field-level, and total: the resolved contract is compared key by key and the
 * enforcement table constraint by constraint, so an added, missing, or altered value is refused
 * (spec §16, §36) instead of being recorded as truth.
 *
 * The comparison is the whole check. It does not restate Phase 1/2/3 rules — those already ran, and
 * an artifact that could not have been produced by them fails here because it cannot equal their
 * output.
 */
function checkClaimedEvidence(recomputed: TargetBinding, claimed: unknown): CharterError[] {
  const errors: CharterError[] = [];
  const err: Err = (code, path, message) => {
    errors.push({ code, message, path });
  };

  if (!isRecord(claimed)) {
    err(
      'INVALID_TASK_CONTRACT',
      'target_binding',
      'the claimed Phase 3 target binding is required; the receipt records the binding this evidence resolves to',
    );
    return errors;
  }
  checkUnknownKeys(claimed, BINDING_KEYS, 'target_binding', err);
  if (claimed.target !== recomputed.target) {
    err(
      'CONTRACT_CONTRADICTION',
      'target_binding.target',
      `target_binding.target=${String(claimed.target)} is not the target this evidence resolves to (${recomputed.target})`,
    );
  }

  const contract = claimed.execution_contract;
  if (!isRecord(contract)) {
    err(
      'INVALID_TASK_CONTRACT',
      'target_binding.execution_contract',
      'the claimed binding must carry the resolved ExecutionContract it claims',
    );
    return errors;
  }
  const canonical = recomputed.execution_contract as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(canonical), ...Object.keys(contract)])) {
    if (canonicalJson(contract[key]) !== canonicalJson(canonical[key])) {
      err(
        'CONTRACT_CONTRADICTION',
        `target_binding.execution_contract.${key}`,
        `the claimed execution_contract.${key} is not the value this evidence resolves to`,
      );
    }
  }

  const enforcement = claimed.enforcement;
  if (!isRecord(enforcement)) {
    err('INVALID_TASK_CONTRACT', 'target_binding.enforcement', 'the claimed binding must carry enforcement truth');
    return errors;
  }
  checkUnknownKeys(enforcement, ENFORCEMENT_CONSTRAINTS, 'target_binding.enforcement', err);
  for (const constraint of ENFORCEMENT_CONSTRAINTS) {
    const truth = enforcement[constraint];
    if (truth !== recomputed.enforcement[constraint]) {
      err(
        'CONTRACT_CONTRADICTION',
        `target_binding.enforcement.${constraint}`,
        `claimed enforcement.${constraint}=${String(truth)} but this evidence and capability snapshot report ${recomputed.enforcement[constraint]}`,
      );
    }
  }
  return errors;
}

// ── Deterministic identity ──────────────────────────────────────────────────

/**
 * Canonical serialization: object keys sorted recursively, array order preserved, `undefined`
 * serialized as JSON `null`. The same evidence always serializes to the same bytes regardless of
 * key insertion order; different evidence serializes to different bytes.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 over canonical serialization. Built-in crypto only; no temporal identity exists. */
function identity(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function checkUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], prefix: string, err: Err): void {
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

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
