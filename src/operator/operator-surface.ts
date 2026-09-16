/**
 * Operator-facing results (v0.1.2 Wave 1 — CN3, CN4, CN5).
 *
 * The dogfood finding was not that Charter lied; it was that Charter said true things in a shape the
 * operator could not act on:
 *
 *   - acceptance reported `ACCEPTANCE_NOT_DECLARED` while the contract plainly declared command gates,
 *     because that status is about ASSERTION acceptance and the output never said so;
 *   - a refusal named an internal code and left the operator to work out whether retrying was even
 *     meaningful, what the minimal remedy was, and whether the tool or the request was wrong;
 *   - a delegation result reported a model without saying whether that was a requirement or proof of
 *     what the child ran.
 *
 * This module renders those facts truthfully and no further. It is a PRESENTATION layer: it reads
 * already-established values, restates none of them, and can establish nothing. It never turns a
 * declaration into evidence, never upgrades `UNAVAILABLE` into a pass, and never hides a refusal
 * behind prose — the point is to make the operator's next action obvious, not to make the outcome
 * look better.
 *
 * Four truths stay four truths on this surface, because conflating any two of them is exactly what
 * made v0.1.1 unusable:
 *
 *   authority compilation   what was compiled and admitted
 *   handoff readiness       bounded delegation parameters exist
 *   runtime attestation     whether THIS process observed the runtime that runs the work
 *   execution proof         whether trusted execution evidence can be issued at all
 */

import type { AssertionBinding } from '../core/acceptance/assertion-binding.ts';
import type { CompiledGovernance } from '../core/compile/compile-for-target.ts';
import type { Acceptance } from '../core/contracts/task-contract.ts';
import type { CharterError, CharterErrorCode } from '../core/contracts/errors.ts';
import type { AcceptanceVerification } from '../core/execution/execution-attestation.ts';
import type { DelegationCompileSuccess, DelegationHandoff } from '../delegation/compile-delegation.ts';

// ── Declared versus attested acceptance (CN4) ───────────────────────────────

/**
 * What acceptance truth actually is at this point: the operator DECLARED gates, and Charter has
 * verifier-bound assertions or it does not. `UNAVAILABLE` is not a failure and not a pass — it is the
 * honest statement that nothing machine-attested exists yet, which is why it is never rendered as
 * "not declared" without saying what was declared.
 */
export interface AcceptanceSurfaceTruth {
  /** The declared acceptance commands: a declaration the substrate runs, not evidence that it passed. */
  commands: { status: 'DECLARED' | 'NONE'; count: number };
  /** Machine-attested acceptance: verifier-bound assertions exist, or none were declared. */
  verifier_evidence: { status: 'UNAVAILABLE' | 'BOUND_NOT_VERIFIED'; assertions: number };
}

/** Describe declared commands and verifier evidence separately, from already-resolved truth. */
export function describeAcceptance(
  acceptance: Acceptance | undefined,
  assertionBindings: readonly AssertionBinding[] | undefined,
): AcceptanceSurfaceTruth {
  const commands = acceptance?.commands ?? [];
  const assertions = assertionBindings?.length ?? 0;
  return {
    commands: { status: commands.length > 0 ? 'DECLARED' : 'NONE', count: commands.length },
    verifier_evidence:
      assertions > 0
        ? { status: 'BOUND_NOT_VERIFIED', assertions }
        : { status: 'UNAVAILABLE', assertions: 0 },
  };
}

/** The two acceptance lines every compile result states, so neither is ever read as the other. */
export function renderAcceptanceLines(truth: AcceptanceSurfaceTruth): string[] {
  return [
    `Acceptance commands   ${truth.commands.status === 'DECLARED' ? `DECLARED (${truth.commands.count})` : 'NONE'}`,
    `Verifier evidence     ${
      truth.verifier_evidence.status === 'BOUND_NOT_VERIFIED'
        ? `ASSERTION_BOUND, NOT VERIFIED (${truth.verifier_evidence.assertions})`
        : 'UNAVAILABLE (no verifier-bound assertion is declared)'
    }`,
  ];
}

// ── Compile results (CN3) ───────────────────────────────────────────────────

/** What a parent compile established: an admitted artifact set for THIS session. */
export interface ParentCompileSurface {
  /** The compiled artifacts: the resolved contract is the truth every line below is read from. */
  compiled: CompiledGovernance;
  /** The admission handle: the only thing that makes this artifact set eligible for verification. */
  execution_handle: string;
}

/** Render a parent compile. Execution proof is still pending: admission is not execution. */
export function renderParentCompile(surface: ParentCompileSurface): string {
  const { execution_contract } = surface.compiled;
  const acceptance = describeAcceptance(execution_contract.acceptance, surface.compiled.role_envelope.assertion_bindings);
  return [
    'CHARTER',
    '',
    `Role          ${execution_contract.role}`,
    `Target        ${execution_contract.execution_target}`,
    `Model         ${execution_contract.model.resolved} (observed in this session)`,
    `Scope         ${renderScopeEntries(execution_contract.scope.directories ?? [], execution_contract.scope.files ?? [])}`,
    '',
    'Authority     BOUND',
    'Admission     ADMITTED_FOR_EXECUTION',
    `Acceptance    ${renderAcceptanceInline(acceptance)}`,
    '',
    `execution_handle: ${surface.execution_handle}`,
    'Run the admitted work in this session, then call charter_verify_execution with that handle.',
    'Until this session actually runs work under the admission, verification is refused: admission is not execution.',
  ].join('\n');
}

/** Render a delegation compile: bounded authority and a ready handoff, with no runtime claim. */
export function renderDelegationCompile(result: DelegationCompileSuccess): string {
  const { handoff, truth, compiled } = result;
  const acceptance = describeAcceptance(compiled.execution_contract.acceptance, compiled.role_envelope.assertion_bindings);
  const document = handoff.authority.bound_sources.length > 0 ? handoff.authority.bound_sources.join(', ') : 'NONE';
  const digest = handoff.authority.provenance[0]?.content_digest;
  return [
    'CHARTER',
    '',
    `Role          ${handoff.role}`,
    `Target        ${handoff.target}`,
    `Root          ${handoff.root}`,
    `Scope         ${renderScopeEntries(handoff.scope.directories ?? [], handoff.scope.files ?? [])}`,
    `Fresh         ${freshLabel(handoff)}`,
    '',
    `Authority     ${truth.authority}`,
    `Handoff       READY`,
    '',
    'Runtime proof UNAVAILABLE',
    'Execution proof UNAVAILABLE',
    '',
    `Routing tier  ${handoff.routing.tier} (${handoff.routing.truth})`,
    `Authority doc ${document}${digest ? ` (sha256:${digest.slice(0, 12)})` : ''}`,
    `Acceptance    ${renderAcceptanceInline(acceptance)}`,
    '',
    'Delegation parameters are ready. This process observed no child runtime, so it holds no execution handle',
    'for the child: charter_verify_execution applies to the parent session only, and invoking it here is refused.',
    'Calling it with a delegation handoff is refused, and no verification can be manufactured here.',
  ].join('\n');
}

// ── Verification results (CN4) ──────────────────────────────────────────────

/** Render a verification verdict, with the acceptance status explained rather than mistaken. */
export function renderVerification(input: {
  verdict: string;
  acceptance: AcceptanceVerification;
  deviations: readonly { code: string; path: string; detail: string }[];
}): string {
  const lines = [`Charter execution verdict: ${input.verdict}`, `acceptance: ${input.acceptance.status}`];
  if (input.acceptance.status === 'ACCEPTANCE_NOT_DECLARED') {
    lines.push(
      'acceptance note: this status is about MACHINE-ATTESTED acceptance only — no verifier-bound',
      'assertion is declared, so nothing about acceptance is established either way. Declared command',
      'gates are declarations the substrate runs; they are not verifier evidence and never a pass.',
    );
  }
  for (const unverified of input.acceptance.unverified) {
    lines.push(`  not verified: ${unverified.reference} (${unverified.verifier}): ${unverified.reason}`);
  }
  for (const deviation of input.deviations) {
    lines.push(`${deviation.code} @ ${deviation.path}: ${deviation.detail}`);
  }
  return lines.join('\n');
}

// ── Refusals (CN5) ──────────────────────────────────────────────────────────

/**
 * Whether a refusal is worth retrying, and the minimal operator action that resolves it.
 *
 * A refusal is a truth about the request, so the two fields are stated per canonical code and never
 * inferred from the message text: `HUMAN_DECISION_REQUIRED` and `UNSUPPORTED_BY_EXECUTION_TARGET` are
 * not retryable at all, and the rest are retryable only after the stated remedy. Nothing here widens
 * authority: every remedy asks the operator for less ambiguity, never for more permission.
 */
export const REFUSAL_GUIDANCE: Record<CharterErrorCode, { retry: string; remedy: string }> = {
  INVALID_TASK_CONTRACT: {
    retry: 'YES, after correcting the stated field',
    remedy: 'Correct the field the refusal names; Charter does not fill in or repair a malformed request.',
  },
  AUTHORITY_UNRESOLVED: {
    retry: 'YES, after identifying exactly one authority source',
    remedy: 'Provide one authority document (a root-relative path in the simple request), or the exact evidence for the reference in an advanced one.',
  },
  SCOPE_CONTRADICTION: {
    retry: 'YES, after bounding the scope inside the declared root',
    remedy: 'State scope entries relative to the declared root; a scope that escapes it is never widened.',
  },
  CONTRACT_REQUIRES_EXPLICIT_OVERRIDE: {
    retry: 'YES, after narrowing scope or explicitly admitting unrestricted scope',
    remedy: 'Narrow the scope to the bounded subtree the work actually needs.',
  },
  ACCEPTANCE_INVALID: {
    retry: 'YES, after declaring verifiable acceptance',
    remedy: 'Declare at least one acceptance command gate (or a verifier-bound assertion); acceptance is never invented.',
  },
  MODEL_UNAVAILABLE: {
    retry: 'YES, after admitting an available model for the tier',
    remedy: 'Admit the model in the active environment, or declare an explicit fallback; Charter never substitutes one.',
  },
  ROUTING_UNRESOLVED: {
    retry: 'YES, after correcting the routing input',
    remedy: 'Correct the model profile or availability input the refusal names.',
  },
  CONTRACT_CONTRADICTION: {
    retry: 'YES, after resolving the contradiction explicitly',
    remedy: 'Resolve the stated contradiction between the declared fields; no field is rewritten to make it pass.',
  },
  HUMAN_DECISION_REQUIRED: {
    retry: 'NO, this requires a human decision',
    remedy: 'Stop and escalate; Charter does not progress autonomously through ambiguity.',
  },
  UNSUPPORTED_BY_EXECUTION_TARGET: {
    retry: 'NO, not for this contract and target',
    remedy: 'Choose a target that can satisfy the stated requirement, or drop the requirement; Charter never pretends instruction-level is hard enforcement.',
  },
};

/** Render a refusal: what failed, whether retrying is meaningful, and the minimal remedy. */
export function renderRefusal(errors: readonly CharterError[]): string {
  const lines = ['REFUSED', ''];
  for (const error of errors) {
    lines.push(`Reason:`, `${error.code}${error.path ? ` @ ${error.path}` : ''}`, error.message, '');
  }
  const codes = [...new Set(errors.map((error) => error.code))];
  for (const code of codes) {
    const guidance = REFUSAL_GUIDANCE[code];
    lines.push(`Retry:`, guidance.retry, '', 'Remedy:', guidance.remedy, '');
  }
  lines.push('Nothing was admitted, delegated, or executed by this refusal.');
  return lines.join('\n');
}

// ── Shared rendering helpers ────────────────────────────────────────────────

/** The one dispatch freshness truth, rendered from the delegation handoff's stated field. */
function freshLabel(handoff: DelegationHandoff): string {
  return handoff.fresh_context === 'REQUIRED' ? 'required' : 'not_required';
}

function renderAcceptanceInline(truth: AcceptanceSurfaceTruth): string {
  const commands = truth.commands.status === 'DECLARED' ? `commands DECLARED (${truth.commands.count})` : 'commands NONE';
  const evidence =
    truth.verifier_evidence.status === 'BOUND_NOT_VERIFIED'
      ? `verifier evidence ASSERTION_BOUND, NOT VERIFIED (${truth.verifier_evidence.assertions})`
      : 'verifier evidence UNAVAILABLE';
  return `${commands}; ${evidence}`;
}

function renderScopeEntries(directories: readonly string[], files: readonly string[]): string {
  const entries = [...directories, ...files];
  return entries.length > 0 ? entries.join(', ') : 'NONE';
}
