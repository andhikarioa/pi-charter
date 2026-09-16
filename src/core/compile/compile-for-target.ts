/**
 * `compileForTarget` — the one blessed composition facade (v0.1.1 Wave 2 — U1).
 *
 * Before this module, a consumer had to compose the canonical pipeline from memory:
 *
 *   resolveExecutionContract → bindExecutionTarget → compileBoundRoleEnvelope → renderRoleEnvelope
 *   → bindParentTarget/bindSubagentsTarget → createResolutionReceipt
 *
 * Smoke #1 proved that too easy to get wrong: the produced `SubagentsHandoff` is binding-SHAPED but
 * carries no canonical binding provenance, so handing it to `compileRoleEnvelope` compiles nothing —
 * and composing the contract with a second, caller-authored binding silently produces governance
 * truth nobody proved. This facade owns the order, so the mistake is not reachable through it:
 *
 *   TaskContract + binders + model environment evidence + capability evidence
 *            ↓ resolveExecutionContract          (Phase 2)
 *   ExecutionContract
 *            ↓ bindExecutionTarget                (Phase 3)
 *   canonical TargetBinding  ← the ONLY value RoleEnvelope compilation accepts
 *            ↓ compileBoundRoleEnvelope           (Phase 4 — canonical binding in, envelope out)
 *   RoleEnvelope → renderRoleEnvelope → instruction text
 *            ↓
 *   target handoff (separate artifact, never fed into envelope compilation)
 *            ↓
 *   ResolutionReceipt (identity of what was compiled, with the real compiler build identity)
 *
 * The facade composes; it decides nothing. Every rule it invokes is a rule that already existed, and
 * no rule is restated here: an unusable input fails inside the step that owns it. The low-level
 * functions stay public for advanced and internal use, but the blessed entry is this one, and it is
 * the only place the compiler identity is supplied — a normal caller never invents one.
 */

import type { AssertionBinder } from '../acceptance/assertion-binding.ts';
import type { AttestationVerifier } from '../attestation/attestation.ts';
import { readCompilerIdentity } from '../../build/compiler-identity.ts';
import type { AuthorityBinder } from '../authority/binder.ts';
import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import type { CorrectionAuthorityBinder } from '../correction/correction-authority.ts';
import { compileBoundRoleEnvelope, renderRoleEnvelope, type RoleEnvelope } from '../envelopes/role-envelope.ts';
import { bindExecutionTarget, type TargetBinding } from '../enforcement/target-binding.ts';
import { createResolutionReceipt, type ResolutionReceipt } from '../receipt/resolution-receipt.ts';
import { resolveExecutionContract } from '../resolver/resolve.ts';
import type { ModelProfile } from '../routing/model-routing.ts';
import { bindParentTarget, type ParentHandoff } from '../../adapters/parent/parent-adapter.ts';
import { bindSubagentsTarget, type SubagentsHandoff } from '../../adapters/subagents/subagents-adapter.ts';

/**
 * Everything one compilation is allowed to be wired with: the canonical Phase 1–3 environment inputs,
 * plus the resolved compiler identity path. Governance-bearing values are absent by construction —
 * there is no `role`, `model`, `permissions`, `enforcement_truth`, or `target_binding` field for a
 * caller to fill in, and an unknown key fails closed rather than being ignored.
 */
export interface CompileForTargetInput {
  /** The Phase 1 input. Validated inside resolution; never pre-resolved by the caller. */
  task_contract: TaskContract;
  /** The authority binder resolution runs under (spec §13). Required: authority never binds by default. */
  authority_binder: AuthorityBinder;
  /** The assertion → verifier binder, required when the contract declares assertions (T4). */
  assertion_binder?: AssertionBinder;
  /** The correction-authority binder, required when the role is `correct` (T6). */
  correction_binder?: CorrectionAuthorityBinder;
  /** The admitted model profile resolution runs under (spec §9). */
  model_profile: ModelProfile;
  /** The raw availability CLAIM, when that is the evidence channel in use (H2). Recorded as a claim. */
  available?: readonly string[];
  /** The submitted model-availability attestation candidate, when that is the channel in use (H2). */
  model_availability_attestation?: unknown;
  /** The trusted boundary that vouches for that candidate. A capability, never a submitted value. */
  model_availability_attestation_verifier?: AttestationVerifier;
  /** The capability CLAIM, when the target's capabilities are claimed rather than attested (T2). */
  capability_claim?: unknown;
  /** The submitted capability attestation candidate, when that is the channel in use (T2). */
  capability_attestation?: unknown;
  /** The trusted boundary that vouches for that candidate. A capability, never a submitted value. */
  capability_attestation_verifier?: AttestationVerifier;
}

/**
 * The canonical artifacts one compilation produced. All of them are values; none of them is a handle
 * to a session, a worker, a run, or any lifecycle this facade does not own.
 */
export interface CompiledGovernance {
  /** Phase 2: the resolved contract. */
  execution_contract: ExecutionContract;
  /** Phase 3: the canonically bound target binding, with enforcement truth and its evidence. */
  target_binding: TargetBinding;
  /** Phase 4: the compiled instruction artifact. */
  role_envelope: RoleEnvelope;
  /** Phase 4: that artifact as deterministic instruction text. */
  rendered_role_envelope: string;
  /**
   * The target-specific handoff, kept deliberately separate: it is a translation of bound truth, not
   * the binding itself, and it never feeds envelope compilation.
   */
  target_handoff: ParentHandoff | SubagentsHandoff;
  /** Phase 5: the evidence of what was compiled, including the real compiler build identity (H1). */
  resolution_receipt: ResolutionReceipt;
}

export type CompileForTargetResult =
  | { ok: true; compiled: CompiledGovernance }
  | { ok: false; errors: CharterError[] };

const INPUT_KEYS = [
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
] as const;

/**
 * Compile one target-bound governance artifact set in the canonical order (U1).
 *
 * Pure and deterministic: the caller supplies inputs, never intermediate artifacts, so the same
 * inputs always produce the same artifacts and the same receipt identity. Fail-closed at every step
 * — the first step that refuses returns its own truthful errors, and no later step is entered with
 * truth that was never established.
 */
export function compileForTarget(input: unknown): CompileForTargetResult {
  const errors: CharterError[] = [];
  const err = (code: CharterErrorCode, path: string, message: string): void => {
    errors.push({ code, message, path });
  };
  if (!isRecord(input)) {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: '', message: 'compile input must be an object' }] };
  }
  checkUnknownKeys(input, INPUT_KEYS, '', err);
  for (const key of ['task_contract', 'authority_binder', 'model_profile'] as const) {
    if (input[key] === undefined) {
      err('INVALID_TASK_CONTRACT', key, `${key} is required to compile governance`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // H1 — the compiler identity is read from the real compiled artifact set this package was built
  // into, and verified against the artifact set actually executing (F2). A caller never supplies it,
  // no identity is fabricated when the build is absent, and a stale record refuses instead of
  // authorizing a modified artifact set.
  const compilerIdentity = readCompilerIdentity();
  if (!compilerIdentity.ok) {
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_TASK_CONTRACT',
          path: 'compiler_identity',
          message: `the compiler build identity is unavailable or stale (${compilerIdentity.reason}); rebuild the package before compiling governance`,
        },
      ],
    };
  }

  // Phase 2: validate + resolve. The contract the caller handed over is not reused as an artifact.
  const resolved = resolveExecutionContract(input.task_contract, {
    authorityBinder: input.authority_binder as AuthorityBinder,
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
      ? { model_availability_attestation_verifier: input.model_availability_attestation_verifier as AttestationVerifier }
      : {}),
  });
  if (!resolved.ok) return { ok: false, errors: resolved.errors };

  // Phase 3: bind. This call is the ONLY mint of canonical binding provenance in the process, and the
  // value it returns is the one the envelope compiler will be handed below.
  const bindingInput = {
    execution_contract: resolved.contract,
    ...(input.capability_attestation !== undefined
      ? { capability_attestation: input.capability_attestation }
      : { capability_claim: input.capability_claim }),
    ...(input.capability_attestation_verifier !== undefined
      ? { capability_attestation_verifier: input.capability_attestation_verifier as AttestationVerifier }
      : {}),
  };
  const bound = bindExecutionTarget(bindingInput);
  if (!bound.ok) return { ok: false, errors: bound.errors };

  // Phase 4: compile the instruction artifact from the canonical binding — never from a handoff, a
  // copy, or anything a caller assembled.
  const compiledEnvelope = compileBoundRoleEnvelope(bound.binding);
  if (!compiledEnvelope.ok) return { ok: false, errors: compiledEnvelope.errors };

  // The handoff is produced separately, from the same inputs, through the same target adapter. It is
  // a translation of bound truth for the substrate, and it is never an envelope input.
  const handoff =
    resolved.contract.execution_target === 'parent'
      ? bindParentTarget(bindingInput)
      : bindSubagentsTarget(bindingInput);
  if (!handoff.ok) return { ok: false, errors: handoff.errors };

  // Phase 5: evidence of what was compiled. The receipt recomputes the pipeline from the same inputs
  // and refuses if the canonical artifacts are not exactly what those inputs resolve to.
  const receipt = createResolutionReceipt({
    task_contract: input.task_contract,
    authority_binder: input.authority_binder as AuthorityBinder,
    ...(input.assertion_binder !== undefined ? { assertion_binder: input.assertion_binder as AssertionBinder } : {}),
    ...(input.correction_binder !== undefined
      ? { correction_binder: input.correction_binder as CorrectionAuthorityBinder }
      : {}),
    model_profile: input.model_profile as ModelProfile,
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
    ...(input.capability_attestation !== undefined
      ? { capability_attestation: input.capability_attestation }
      : { capability_claim: input.capability_claim }),
    ...(input.capability_attestation_verifier !== undefined
      ? { capability_attestation_verifier: input.capability_attestation_verifier as AttestationVerifier }
      : {}),
    compiler_identity: compilerIdentity.compiler_identity,
    target_binding: bound.binding,
  });
  if (!receipt.ok) return { ok: false, errors: receipt.errors };

  return {
    ok: true,
    compiled: {
      execution_contract: resolved.contract,
      target_binding: bound.binding,
      role_envelope: compiledEnvelope.envelope,
      rendered_role_envelope: renderRoleEnvelope(compiledEnvelope.envelope),
      target_handoff: handoff.handoff,
      resolution_receipt: receipt.receipt,
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  err: (code: CharterErrorCode, path: string, message: string) => void,
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
