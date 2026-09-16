/**
 * Resolution receipt (spec §36, §37, §41 Phase 5; v0.1.1 Wave 1 — T1, T2, H1, H2).
 *
 * A receipt is EVIDENCE, not workflow state (spec §36). It records the already-established outcome
 * of a successful deterministic resolution: the identities of the evidence resolution ran on, the
 * resolved governance truth, and the Phase 3 enforcement truth. It decides nothing, is read by
 * nothing in the pipeline, and carries no lifecycle field.
 *
 *   TaskContract
 *   + authority / assertion / correction binders (spec §13; T1, T4, T6)
 *   + resolution inputs (model profile, exactly one availability evidence channel)
 *   + capability evidence (claim or attestation — never blended)
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
 * caller claims that run produced must BE the result. All `CONTRACT_CONTRADICTION` cases are refused
 * rather than blended into a receipt.
 *
 * What the receipt commits to (v0.1.1): the RESOLVED authority provenance (binding identity plus
 * content digest, so two runs that bind the same reference to different content cannot share an
 * identity), the evidence CLASS behind capability and model availability (attested environment
 * truth is never confusable with a raw claim), and a compiler identity distinct from
 * `contract_version` (H1).
 *
 * Compiler identity boundary (v0.1.1 H1): Wave 1 requires the identity field, validates that it is
 * not merely a restatement of the product version, and commits it to the receipt identity. It does
 * NOT invent a build digest or a Git-derived identity: the deterministic packaged/build identity is
 * supplied by the compiler artifact that actually runs resolution (Wave 2), and a caller that
 * supplies nothing gets no receipt rather than a fabricated attestation.
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
 * Determinism (spec §37): every identity is SHA-256 over a canonical serialization through the
 * shared provenance primitive — object keys sorted, array order preserved, built-in `node:crypto`
 * only, no external dependency. There is no clock, timestamp, random UUID, process-local sequence, or
 * mutable counter: same evidence always yields the same identity, and changed evidence always yields
 * a different one.
 */

import type { AssertionBinder } from '../acceptance/assertion-binding.ts';
import { checkEnvironmentEvidence, type AttestationVerifier, type EnvironmentEvidence } from '../attestation/attestation.ts';
import type { AuthorityBinder } from '../authority/binder.ts';
import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  type Permissions,
  type Role,
  type TaskContract,
} from '../contracts/task-contract.ts';
import type { CorrectionAuthorityBinder } from '../correction/correction-authority.ts';
import {
  bindExecutionTarget,
  type EnforcementTruthTable,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import type { Jurisdiction } from '../jurisdiction/jurisdiction.ts';
import { canonicalJson, evidenceIdentity, type EvidenceProvenance } from '../provenance/evidence.ts';
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
  /**
   * Identity of the compiler artifact that ran this resolution (H1). Always distinct from
   * `contract_version`, and never a Charter-invented digest.
   */
  readonly compiler_identity: string;

  /** Identity of the normalized Phase 1 artifact this resolution ran on (spec §12). */
  readonly task_contract_identity: string;
  /** Identity of the admitted model profile resolution ran under (spec §9). */
  readonly model_profile_identity: string;
  /** Resolved authority provenance: binding identity and content digest per reference (T1). */
  readonly authority_provenance: EvidenceProvenance[];
  /** How the resolved model's availability was evidenced: attested inventory, or a claim (H2). */
  readonly model_availability_evidence: EnvironmentEvidence;
  /** How the enforcement truth was evidenced: attested capability, or an unattested claim (T2). */
  readonly capability_evidence: EnvironmentEvidence;
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
 * The only admitted receipt input: the environment inputs one pipeline run was wired with, the
 * capability evidence it was bound with, the compiler identity that ran it, and the Phase 3 artifact
 * the caller claims that run produced.
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
  /** The assertion → verifier binder that run was wired with, when the contract declares assertions. */
  assertion_binder?: AssertionBinder;
  /** The correction-authority binder that run was wired with, when the role is `correct`. */
  correction_binder?: CorrectionAuthorityBinder;
  /** The admitted model profile the resolution ran under (spec §9). */
  model_profile: ModelProfile;
  /** The raw availability claim the resolution ran under (spec §10). Recorded as a claim (H2). */
  available?: readonly string[];
  /** The attested model inventory the resolution ran under (H2). Exactly one of these two. */
  model_availability_attestation?: unknown;
  /**
   * The explicit trusted-attestation boundary that run was wired with (W1_ATTESTATION_SELF_PROMOTION).
   * A capability, never a submitted value. The same boundary must be supplied here for the recomputed
   * evidence class to BE the one the run produced.
   */
  model_availability_attestation_verifier?: AttestationVerifier;
  /** The capability CLAIM the binding used, when it used one (T2). Exactly one of these two. */
  capability_claim?: unknown;
  /** The capability ATTESTATION candidate the binding used, when it used one (T2). */
  capability_attestation?: unknown;
  /** The explicit trusted-attestation boundary the binding was wired with (T2). A capability. */
  capability_attestation_verifier?: AttestationVerifier;
  /** Identity of the compiler artifact that ran this resolution (H1). Never `contract_version`. */
  compiler_identity: string;
  /** The Phase 3 artifact the caller claims this evidence produced. Compared, never trusted. */
  target_binding: TargetBinding;
}

export type ResolutionReceiptResult =
  | { ok: true; receipt: ResolutionReceipt }
  | { ok: false; errors: CharterError[] };

const RECEIPT_INPUT_KEYS = [
  'task_contract',
  'authority_binder',
  'assertion_binder',
  'correction_binder',
  'model_profile',
  'available',
  'model_availability_attestation',
  'model_availability_attestation_verifier',
  'capability_claim',
  'capability_attestation',
  'capability_attestation_verifier',
  'compiler_identity',
  'target_binding',
] as const;
const BINDING_KEYS = ['target', 'enforcement', 'capability_evidence', 'execution_contract'] as const;

type Err = (code: CharterErrorCode, path: string, message: string) => void;

/**
 * Create the evidence of one successful resolution (spec §36). Pure and deterministic: same
 * evidence always produces a deep-equivalent, identically-identified, deep-frozen receipt, and
 * neither the input nor any artifact it carries is mutated.
 *
 * Fail-closed: the pipeline is recomputed from the supplied environment inputs, and the caller's
 * claimed binding must BE that result. A malformed artifact, an unstaffable tier, an unevidenced
 * authority reference, an unbound assertion, an unadmitted correction target, an unrecognized
 * attestation source, a missing or restated compiler identity, or any unknown input key refuses to
 * produce a receipt rather than recording evidence that does not describe one run.
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

  // H1 — a compiler identity is required, and it must identify the compiler artifact rather than
  // restate the product version. Nothing is fabricated in its place.
  const declaredCompilerIdentity = input.compiler_identity;
  let compilerIdentity: string | undefined;
  if (typeof declaredCompilerIdentity !== 'string' || declaredCompilerIdentity.trim().length === 0) {
    err('INVALID_TASK_CONTRACT', 'compiler_identity', 'compiler_identity must name the compiler artifact that ran this resolution');
  } else if (declaredCompilerIdentity === RECEIPT_CONTRACT_VERSION) {
    err(
      'INVALID_TASK_CONTRACT',
      'compiler_identity',
      `compiler_identity must be distinct from contract_version '${RECEIPT_CONTRACT_VERSION}'; a version string is not a build identity`,
    );
  } else {
    compilerIdentity = declaredCompilerIdentity;
  }
  if (compilerIdentity === undefined || errors.length > 0) return { ok: false, errors };

  const binder = input.authority_binder as AuthorityBinder;
  // Phase 1–3 run again, through the canonical functions and their own rules: nothing here restates
  // a validation, resolution, or binding rule, and a bad input returns that step's truthful failure.
  const validated = validateTaskContract(input.task_contract, { authorityBinder: binder });
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const resolved = resolveExecutionContract(validated.contract, {
    authorityBinder: binder,
    ...(input.assertion_binder !== undefined ? { assertionBinder: input.assertion_binder as AssertionBinder } : {}),
    ...(input.correction_binder !== undefined
      ? { correctionBinder: input.correction_binder as CorrectionAuthorityBinder }
      : {}),
    profile: input.model_profile as ModelProfile,
    ...(input.available !== undefined ? { available: input.available as readonly string[] } : {}),
    ...(input.model_availability_attestation !== undefined
      ? { model_availability_attestation: input.model_availability_attestation }
      : {}),
    ...(input.model_availability_attestation_verifier !== undefined
      ? {
          model_availability_attestation_verifier:
            input.model_availability_attestation_verifier as AttestationVerifier,
        }
      : {}),
  });
  if (!resolved.ok) return { ok: false, errors: resolved.errors };

  // The capability evidence is one channel or the other, never both: binding refuses the ambiguity
  // itself, so this call restates no exclusivity rule.
  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
    ...(input.capability_attestation !== undefined
      ? { capability_attestation: input.capability_attestation }
      : { capability_claim: input.capability_claim }),
    ...(input.capability_attestation_verifier !== undefined
      ? { capability_attestation_verifier: input.capability_attestation_verifier as AttestationVerifier }
      : {}),
  });
  if (!bound.ok) return { ok: false, errors: bound.errors };

  // The supplied evidence must BE that result. A claim that disagrees with the run these environment
  // inputs actually produce — different permissions, scope, authority, model, capability evidence,
  // or enforcement truth — is refused, so `VALID`/`RESOLVED` are never emitted for a blended receipt.
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
    compiler_identity: compilerIdentity,
    task_contract_identity: evidenceIdentity(validated.contract),
    model_profile_identity: evidenceIdentity(input.model_profile),
    // T1: the resolved binding identity and content digest, not the symbolic reference alone.
    authority_provenance: structuredClone(canonical.authority.provenance),
    model_availability_evidence: structuredClone(canonical.model_availability),
    capability_evidence: structuredClone(bound.binding.capability_evidence),
    execution_contract_identity: evidenceIdentity(canonical),
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
  const receipt: ResolutionReceipt = deepFreeze({ ...evidence, receipt_identity: evidenceIdentity(evidence) });
  return { ok: true, receipt };
}

// ── Claimed-evidence coherence ──────────────────────────────────────────────

/**
 * Compare the claimed Phase 3 artifact against the binding the supplied evidence actually resolves
 * to. Deterministic, field-level, and total: the resolved contract is compared key by key, the
 * enforcement table constraint by constraint, and the capability evidence as evidence, so an added,
 * missing, or altered value is refused (spec §16, §36) instead of being recorded as truth.
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
  // SAFETY: the recomputed contract is the resolved ExecutionContract this run produced; the cast
  // only makes it indexable for a key-by-key comparison against the claimed one.
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

  // Capability evidence is part of the claim: a binding that misstates which evidence class grounded
  // its truth is refused rather than recorded (T2).
  if (canonicalJson(claimed.capability_evidence) !== canonicalJson(recomputed.capability_evidence)) {
    err(
      'CONTRACT_CONTRADICTION',
      'target_binding.capability_evidence',
      'the claimed capability evidence is not the evidence this input resolves to',
    );
  }
  // The recomputed evidence record must itself be well-formed before it is recorded as truth; the
  // claimed record was already proven equal to it above.
  if (checkEnvironmentEvidence(recomputed.capability_evidence, 'target_binding.capability_evidence', err) === undefined && errors.length === 0) {
    err(
      'CONTRACT_CONTRADICTION',
      'target_binding.capability_evidence',
      'the capability evidence this input resolves to is not a valid evidence record',
    );
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
        `claimed enforcement.${constraint}=${String(truth)} but this evidence and capability evidence report ${recomputed.enforcement[constraint]}`,
      );
    }
  }
  return errors;
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
