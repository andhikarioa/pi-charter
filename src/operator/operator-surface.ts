/**
 * Operator-facing Charter results.
 *
 * This presentation layer renders already-established compile truth and actionable refusals. It never
 * turns declarations into evidence, upgrades `INSTRUCTED` into `ENFORCED`, or claims that post-compile
 * execution occurred. Parent output says compilation is ready; delegated output says handoff is ready
 * while child execution remains unobserved by Charter.
 */

import type { AssertionBinding } from '../core/acceptance/assertion-binding.ts';
import type { CompiledGovernance } from '../core/compile/compile-for-target.ts';
import type { Acceptance } from '../core/contracts/task-contract.ts';
import type { CharterError, CharterErrorCode } from '../core/contracts/errors.ts';
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

/** What a parent compile established for this session. */
export interface ParentCompileSurface {
  /** The compiled artifacts: the resolved contract is the truth every line below is read from. */
  compiled: CompiledGovernance;
}

/** Render a parent compile without making any post-execution claim. */
export function renderParentCompile(surface: ParentCompileSurface): string {
  const { execution_contract } = surface.compiled;
  const acceptance = describeAcceptance(execution_contract.acceptance, execution_contract.assertion_bindings);
  return [
    'ALLOWED',
    '',
    `Role          ${execution_contract.role}`,
    `Target        ${execution_contract.execution_target}`,
    `Model         ${execution_contract.model.resolved} (observed in this session)`,
    `Scope         ${renderScopeEntries(execution_contract.scope.directories ?? [], execution_contract.scope.files ?? [])}`,
    '',
    'Authority     BOUND',
    `Enforcement   ${renderEnforcement(surface.compiled.target_binding.enforcement)}`,
    `Acceptance    ${renderAcceptanceInline(acceptance)}`,
    '',
    'Charter compiled bounded governance for this task. Execution remains owned by Pi.',
  ].join('\n');
}

/** Render a delegation compile: bounded authority and a ready handoff, with no runtime claim. */
export function renderDelegationCompile(result: DelegationCompileSuccess): string {
  const { handoff, truth, compiled } = result;
  const acceptance = describeAcceptance(compiled.execution_contract.acceptance, compiled.execution_contract.assertion_bindings);
  const document = handoff.authority.bound_sources.length > 0 ? handoff.authority.bound_sources.join(', ') : 'NONE';
  const digest = handoff.authority.provenance[0]?.content_digest;
  return [
    'ALLOWED',
    '',
    `Role          ${handoff.role}`,
    `Target        ${handoff.target}`,
    `Root          ${handoff.root}`,
    `Scope         ${renderScopeEntries(handoff.scope.directories ?? [], handoff.scope.files ?? [])}`,
    `Fresh         ${freshLabel(handoff)}`,
    '',
    `Authority     ${truth.authority}`,
    `Enforcement   ${renderEnforcement(compiled.target_binding.enforcement)}`,
    `Handoff       READY`,
    '',
    'Runtime execution is not observed or verified by Charter.',
    '',
    `Routing tier  ${handoff.routing.tier} (${handoff.routing.truth})`,
    `Authority doc ${document}${digest ? ` (sha256:${digest.slice(0, 12)})` : ''}`,
    `Acceptance    ${renderAcceptanceInline(acceptance)}`,
    '',
    'Delegation parameters are ready. Charter makes no claim about child execution after handoff.',
  ].join('\n');
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


function renderEnforcement(truth: CompiledGovernance['target_binding']['enforcement']): string {
  const groups = new Map<string, string[]>();
  for (const [constraint, status] of Object.entries(truth)) {
    const current = groups.get(status) ?? [];
    current.push(constraint);
    groups.set(status, current);
  }
  return [...groups.entries()].map(([status, constraints]) => `${status}: ${constraints.join(', ')}`).join('; ');
}

function renderScopeEntries(directories: readonly string[], files: readonly string[]): string {
  const entries = [...directories, ...files];
  return entries.length > 0 ? entries.join(', ') : 'NONE';
}
