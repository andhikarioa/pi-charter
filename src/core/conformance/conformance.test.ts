/**
 * Release-level conformance (spec §39, §41 Phase 5; Phase 5 charter §12–§18).
 *
 * Two groups, both executing real behavior — no labels, no mocks of Charter's own decisions:
 *
 *   P5-K  E1–E10 — the ten mandatory v0.1 edge cases, each driven through the real Phase 1–5 code.
 *   P5-L  end-to-end — complete TaskContract → validate → bind authority → resolve → bind target
 *                       capability truth → compile RoleEnvelope → decide bounded next action runs
 *                       over representative software-delivery fixtures, including the fail-closed one.
 *
 * Nothing here executes work: the substrate owns execution, and every fixture stops at an artifact or
 * a decision.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindSubagentsTarget } from '../../adapters/subagents/subagents-adapter.ts';
import { createAttestationVerifier, type AttestationVerifier } from '../attestation/attestation.ts';
import { createAuthorityBinder } from '../authority/binder.ts';
import type { CharterError } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import type { ExecutionTargetName, Role, TaskContract } from '../contracts/task-contract.ts';
import {
  bindExecutionTarget,
  type CapabilityClaim,
  type ExecutionTargetCapabilities,
  type TargetBindingResult,
} from '../enforcement/target-binding.ts';
import {
  compileBoundRoleEnvelope,
  compileRoleEnvelope,
  renderRoleEnvelope,
  type RoleEnvelope,
  type RoleEnvelopeResult,
} from '../envelopes/role-envelope.ts';
import {
  decideNextAction,
  type EscalationCounters,
  type ExecutionOutcome,
  type NextAction,
} from '../escalation/escalation-policy.ts';
import { resolveExecutionContract, type ResolutionResult, type ResolverEnv } from '../resolver/resolve.ts';
import {
  ASSERTION_BINDER,
  CORRECTION_BINDER,
  NEGATIVE_CONTRACTS,
  POSITIVE_CONTRACTS,
  ROOT,
} from '../validation/fixtures.ts';
import { validateTaskContract, type ValidationResult } from '../validation/validate.ts';

// ── Shared environment (explicit input; never a registry) ───────────────────

const BINDER = createAuthorityBinder({
  'canonical-master': { doc: 'PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md' },
  'reviewer-findings': { doc: 'review-findings.json' },
  'frozen-decision-4': { doc: 'decisions/frozen-4.md' },
});

const AMBIGUOUS_BINDER = {
  bind: () => [{ id: 'candidate-a' }, { id: 'candidate-b' }],
};

const ENV: ResolverEnv = {
  authorityBinder: BINDER,
  assertionBinder: ASSERTION_BINDER,
  correctionBinder: CORRECTION_BINDER,
  profile: {
    workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
    reviewer: { preferred: 'gpt-5.6-sol', fallback: ['deepseek-v4.1-flash'] },
    reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
  },
  available: ['gemini-3.8-flash', 'gpt-5.6-sol', 'deepseek-v4.1-flash'],
};

const PARENT_CAPABILITIES: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: false,
  tool_ceiling: false,
  file_scope_enforcement: false,
  independent_review: false,
};

const SUBAGENTS_CAPABILITIES: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: false,
  independent_review: true,
};

const PARENT_SNAPSHOT: CapabilityClaim = { name: 'parent', capabilities: PARENT_CAPABILITIES };

const SUBAGENTS_SNAPSHOT: CapabilityClaim = { name: 'subagents', capabilities: SUBAGENTS_CAPABILITIES };

const NO_COUNTERS: EscalationCounters = {
  clean_retries_used: 0,
  correction_rounds_used: 0,
  semantic_escalations_used: 0,
};

function positive(name: string): TaskContract {
  const fixture = POSITIVE_CONTRACTS.find((f) => f.name === name);
  assert.ok(fixture, `missing positive fixture '${name}'`);
  return structuredClone(fixture.contract);
}

function negative(name: string): (typeof NEGATIVE_CONTRACTS)[number] {
  const fixture = NEGATIVE_CONTRACTS.find((f) => f.name === name);
  assert.ok(fixture, `missing negative fixture '${name}'`);
  return fixture;
}

function codes(errors: readonly CharterError[]): string[] {
  return [...new Set(errors.map((e) => e.code))];
}

// ── Pipeline harness (§13) ──────────────────────────────────────────────────

interface PipelineRun {
  validated: ValidationResult;
  resolved?: ResolutionResult;
  bound?: TargetBindingResult;
  envelope?: RoleEnvelopeResult;
}

/**
 * The complete pipeline, each stage real and ordered. A later stage is only reached by a stage that
 * passed, so a failed binding has no artifact to compile from — the ordering, not a flag, is what
 * prevents it.
 */
function runPipeline(contract: unknown, capability: CapabilityInput, env: ResolverEnv = ENV): PipelineRun {
  const validated = validateTaskContract(contract, { authorityBinder: env.authorityBinder });
  if (!validated.ok) return { validated };
  const resolved = resolveExecutionContract(validated.contract, env);
  if (!resolved.ok) return { validated, resolved };
  const bound = bindExecutionTarget({ execution_contract: resolved.contract, ...capability });
  if (!bound.ok) return { validated, resolved, bound };
  return { validated, resolved, bound, envelope: compileBoundRoleEnvelope(bound.binding) };
}

/** The capability evidence channel a run is bound with. Both are explicit and never blended. */
export type CapabilityInput =
  | { capability_claim: unknown }
  | { capability_attestation: unknown; capability_attestation_verifier?: AttestationVerifier };

/** A raw capability CLAIM: low-level, never attested, so nothing it says can be hard-enforced (T2). */
function claimedClaim(claim: unknown): CapabilityInput {
  return { capability_claim: claim };
}

/**
 * Attested capability input for a target (T2).
 *
 * The submitted candidate carries the adapter identity; the boundary is the code in which this
 * environment states which attestation it actually issued, and only a candidate that IS that
 * attestation is vouched for (W1_ATTESTATION_SELF_PROMOTION). Shape alone, and a source name alone,
 * promote nothing. Only a vouched candidate can ground `ENFORCED`, and only with an applicable
 * canonical policy (T3).
 */
function attestedCapability(
  target: ExecutionTargetName,
  capabilities: ExecutionTargetCapabilities,
): CapabilityInput {
  const attestation = {
    source_kind: 'execution_adapter',
    source: `pi-${target}`,
    source_version: '0.1.0',
    payload: { target, capabilities },
  };
  return {
    capability_attestation: attestation,
    capability_attestation_verifier: createAttestationVerifier([attestation]),
  };
}

function envelopeOf(run: PipelineRun): RoleEnvelope {
  assert.ok(run.validated.ok, 'fixture must validate');
  assert.ok(run.resolved?.ok, 'fixture must resolve');
  assert.ok(run.bound?.ok, 'fixture must bind to its execution target');
  assert.ok(run.envelope?.ok, 'fixture must compile a role envelope');
  return run.envelope.envelope;
}

function contractOf(run: PipelineRun): ExecutionContract {
  assert.ok(run.resolved?.ok, 'fixture must resolve');
  return run.resolved.contract;
}

// ── P5-L fixtures (§14–§18) ─────────────────────────────────────────────────

/** §14 — bounded implementation on the parent session. */
const IMPLEMENT_PARENT: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'p5-implement-parent', class: 'T1', risk: 'medium' },
  role: 'implement',
  execution_target: 'parent',
  root: ROOT,
  authority: { sources: ['canonical-master'] },
  scope: { files: ['src/feature.ts'], directories: ['src/feature'] },
  permissions: { code_write: true, research: false, external_write: false, release: false },
  acceptance: {
    commands: ['npm test'],
    assertions: ['feature-implemented'],
    review: { required: true, independence: 'none', executor: 'same_session' },
  },
  verification: { level: 'V2' },
  limits: { correction_rounds: 2, semantic_escalations: 1 },
  non_goals: ['architecture redesign', 'unrelated refactor'],
};

/** §15 — read-only review with truthful, substrate-backed independence. */
const REVIEW_SUBAGENTS: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'p5-review-subagents', class: 'T2', risk: 'high' },
  role: 'review',
  execution_target: 'subagents',
  root: ROOT,
  authority: { sources: ['reviewer-findings', 'canonical-master'] },
  scope: { files: ['src/feature.ts'], sections: ['7.3 review'] },
  // The single canonical tool policy: the ceiling the substrate is asked to hard-enforce (T3).
  execution_policy: { allowed_tools: ['read', 'grep'] },
  permissions: { code_write: false, research: false, external_write: false, release: false },
  acceptance: {
    assertions: ['findings-reported'],
    review: { required: true, independence: 'independent', executor: 'fresh_session' },
  },
  verification: { level: 'V3' },
  limits: { semantic_escalations: 1 },
  non_goals: ['implementation', 'architecture review'],
};

/** §16 — correction of one frozen accepted finding, grounded in the accepted review. */
const CORRECT_FROZEN: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'p5-correct-frozen-finding', class: 'T3', risk: 'critical' },
  role: 'correct',
  execution_target: 'parent',
  root: ROOT,
  authority: { sources: ['reviewer-findings'] },
  scope: { blockers: ['finding-1'], files: ['src/feature.ts', 'src/feature.test.ts'] },
  permissions: { code_write: true, research: false, external_write: false, release: false },
  acceptance: {
    commands: ['npm test'],
    assertions: ['finding-1-eliminated'],
    review: { required: true, independence: 'none', executor: 'same_session' },
  },
  verification: { level: 'V2' },
  limits: { correction_rounds: 2, semantic_escalations: 1 },
  non_goals: ['unrelated refactor'],
};

/** §17 — one bounded semantic/authority contradiction, read-only. */
const ADJUDICATE_BOUNDED: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'p5-adjudicate-contradiction', class: 'T4', risk: 'critical', evidence: ['contradiction-report-2'] },
  role: 'adjudicate',
  execution_target: 'subagents',
  root: ROOT,
  authority: { sources: ['canonical-master', 'frozen-decision-4'] },
  scope: { sections: ['13. Authority Binding'], blockers: ['authority-contradiction-1'] },
  permissions: { code_write: false, research: false, external_write: false, release: false },
  acceptance: { assertions: ['decision-frozen'], review: { required: false, independence: 'none' } },
  verification: { level: 'V0' },
  limits: { semantic_escalations: 1 },
  non_goals: ['implementation', 'architecture redesign'],
};

/** §18 — a hard enforcement requirement the parent target cannot supply. */
const UNSUPPORTED_HARD_ENFORCEMENT: TaskContract = {
  ...structuredClone(IMPLEMENT_PARENT),
  task: { id: 'p5-unsupported-enforcement', class: 'T1', risk: 'medium' },
  requirements: { enforcement: { allowed_tools: 'required' } },
};

// ── P5-L — §14 implement / parent ───────────────────────────────────────────

test('P5-L implement/parent: valid → workhorse tier → no broadening → truthful parent truth → envelope', () => {
  const run = runPipeline(IMPLEMENT_PARENT, attestedCapability('parent', PARENT_CAPABILITIES));
  const contract = contractOf(run);
  const envelope = envelopeOf(run);

  assert.ok(run.bound?.ok);
  assert.equal(contract.role, 'implement');
  assert.equal(contract.execution_target, 'parent');
  assert.equal(contract.model.tier, 'workhorse');
  assert.equal(contract.model.resolved, 'gemini-3.8-flash');
  assert.equal(contract.model.fallback_used, false);

  // No authority broadening, no scope growth: the resolved artifact carries the declared set only.
  assert.deepEqual(contract.authority.bound_sources, [...IMPLEMENT_PARENT.authority.sources]);
  assert.deepEqual(contract.scope, IMPLEMENT_PARENT.scope);
  assert.deepEqual(contract.permissions, {
    code_write: true,
    research: false,
    external_write: false,
    release: false,
  });

  // Truthful parent enforcement (T2, T3): ENFORCED only for the attested model-selection primitive,
  // NOT_APPLICABLE where this contract declares no tool policy, INSTRUCTED where an exact file policy
  // exists without a substrate primitive.
  assert.deepEqual(run.bound.binding.enforcement, {
    model_selection: 'ENFORCED',
    allowed_tools: 'NOT_APPLICABLE',
    allowed_files: 'INSTRUCTED',
    archaeology_off: 'INSTRUCTED',
    release_forbidden: 'INSTRUCTED',
  });
  assert.equal(run.bound.binding.capability_evidence.class, 'attested');

  assert.equal(envelope.role, 'implement');
  assert.equal(envelope.execution_target, 'parent');
  assert.deepEqual(envelope.enforcement_truth, run.bound.binding.enforcement, 'envelope truth is transported, never upgraded');
  assert.equal(Object.isFrozen(envelope), true);

  // Release remains forbidden end to end.
  assert.equal(contract.permissions.release, false);
  assert.equal(contract.jurisdiction.mutation.release, 'none');
  assert.equal(envelope.permissions.release, false);
  assert.equal(envelope.jurisdiction.mutation.release, 'none');
  assert.ok(renderRoleEnvelope(envelope).includes('release is not authorized by this contract'));
});

test('P5-L implement/parent: the whole pipeline is deterministic', () => {
  const first = runPipeline(structuredClone(IMPLEMENT_PARENT), attestedCapability('parent', PARENT_CAPABILITIES));
  const second = runPipeline(structuredClone(IMPLEMENT_PARENT), attestedCapability('parent', PARENT_CAPABILITIES));
  assert.deepEqual(first.resolved, second.resolved);
  assert.deepEqual(first.bound, second.bound);
  assert.deepEqual(first.envelope, second.envelope);
  assert.deepEqual(renderRoleEnvelope(envelopeOf(first)), renderRoleEnvelope(envelopeOf(second)));
});

// ── P5-L — §15 review / subagents ──────────────────────────────────────────

test('P5-L review/subagents: reviewer tier, read-only jurisdiction, independent review admitted', () => {
  const run = runPipeline(REVIEW_SUBAGENTS, attestedCapability('subagents', SUBAGENTS_CAPABILITIES));
  const contract = contractOf(run);
  const envelope = envelopeOf(run);
  assert.ok(run.bound?.ok);

  assert.equal(contract.model.tier, 'reviewer');
  assert.equal(contract.jurisdiction.implementation, 'none');
  assert.equal(contract.jurisdiction.mutation.repository, 'none');
  assert.equal(contract.permissions.code_write, false);

  // Independence is admitted only because the substrate supplies it — and it is claimed truthfully.
  assert.deepEqual(envelope.acceptance.review, {
    required: true,
    independence: 'independent',
    executor: 'fresh_session',
  });
  const rendered = renderRoleEnvelope(envelope);
  assert.ok(rendered.includes('independent review is required by this contract'));
  assert.equal(rendered.includes('this is NOT independent review'), false);
  assert.equal(rendered.includes('describe this review as independent'), false);
});

test('P5-L review/subagents: the review envelope does not mutate', () => {
  const envelope = envelopeOf(runPipeline(REVIEW_SUBAGENTS, attestedCapability('subagents', SUBAGENTS_CAPABILITIES)));
  assert.deepEqual(envelope.permissions, {
    code_write: false,
    research: false,
    external_write: false,
    release: false,
  });
  assert.deepEqual(envelope.jurisdiction.mutation, { repository: 'none', external: 'none', release: 'none' });
  assert.equal(envelope.enforcement_truth.allowed_tools, 'ENFORCED', 'the subagents tool ceiling is real');
  assert.equal(envelope.enforcement_truth.allowed_files, 'INSTRUCTED', 'file scope is not hard-enforced here');
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('modify repository content')));
});

test('P5-L a parent review that needs independence is refused, not fabricated', () => {
  const parentReview: TaskContract = {
    ...structuredClone(REVIEW_SUBAGENTS),
    execution_target: 'parent',
    task: { id: 'p5-review-parent-independence', class: 'T2', risk: 'high' },
  };
  const run = runPipeline(parentReview, attestedCapability('parent', PARENT_CAPABILITIES));
  assert.ok(run.resolved?.ok, 'the contract itself is valid');
  assert.equal(run.bound?.ok, false);
  assert.equal(run.envelope, undefined, 'no envelope is compiled from a failed target binding');
  assert.deepEqual(run.bound?.ok === false ? codes(run.bound.errors) : [], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

// ── P5-L — §16 correct ─────────────────────────────────────────────────────

test('P5-L correct: finding-1 is the named correction target and authority only grounds it', () => {
  const run = runPipeline(CORRECT_FROZEN, attestedCapability('parent', PARENT_CAPABILITIES));
  const envelope = envelopeOf(run);

  assert.equal(envelope.role, 'correct');
  assert.deepEqual(envelope.scope.blockers, ['finding-1']);

  const targetRule = envelope.operating_rules.find((rule) => rule.includes('admitted correction targets are'));
  assert.ok(targetRule, 'the envelope must name its admitted correction targets');
  assert.ok(targetRule.includes('finding-1'), 'finding-1 must be named as the correction target');
  // T6: the target is admitted by finding provenance AND explicit acceptance provenance, not by the
  // identifier alone.
  const evidenceRule = envelope.operating_rules.find((rule) => rule.includes('two resolved evidence links'));
  assert.ok(evidenceRule, 'the envelope must state the evidence that admits each target');
  assert.ok(evidenceRule.includes('review-finding:finding-1'));
  assert.ok(evidenceRule.includes('owner-acceptance:finding-1'));
  assert.deepEqual(envelope.correction_targets.map((target) => target.id), ['finding-1']);

  // The finding is a target, never an authority source; no second audit authority appears.
  assert.deepEqual(envelope.authority.bound_sources, ['reviewer-findings']);
  assert.equal(envelope.authority.bound_sources.includes('finding-1'), false);
  assert.equal(envelope.jurisdiction.architecture, 'none');
  assert.equal(envelope.jurisdiction.product_semantics, 'none');
  assert.ok(envelope.prohibitions.some((rule) => rule.includes("reopen or contest the reviewer's jurisdiction")));
});

test('P5-L correct: MECHANICAL_FAILURE with clean_retries_used=0 decides RETRY_SAME_ROLE only', () => {
  const envelope = envelopeOf(runPipeline(CORRECT_FROZEN, attestedCapability('parent', PARENT_CAPABILITIES)));
  const counters: EscalationCounters = { ...NO_COUNTERS };
  const result = decideNextAction({ role_envelope: envelope, outcome: 'MECHANICAL_FAILURE', counters });

  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result.decision).sort(), ['action', 'reason', 'role']);
  assert.equal(result.decision.action, 'RETRY_SAME_ROLE');
  assert.equal(result.decision.role, 'correct');
  // Nothing was retried, nothing was incremented: the counters are the caller's, and they are intact.
  assert.deepEqual(counters, NO_COUNTERS);
});

// ── P5-L — §17 adjudicate ──────────────────────────────────────────────────

test('P5-L adjudicate: reasoning tier, bounded semantic authority, no implementation authority, no mutation', () => {
  const run = runPipeline(ADJUDICATE_BOUNDED, attestedCapability('subagents', SUBAGENTS_CAPABILITIES));
  const contract = contractOf(run);
  const envelope = envelopeOf(run);

  assert.equal(contract.model.tier, 'reasoning');
  assert.equal(contract.jurisdiction.semantic_adjudication, 'bounded');
  assert.equal(contract.jurisdiction.implementation, 'none');
  assert.equal(contract.jurisdiction.architecture, 'none');
  assert.deepEqual(contract.jurisdiction.mutation, { repository: 'none', external: 'none', release: 'none' });
  assert.equal(contract.permissions.code_write, false);
  assert.equal(envelope.jurisdiction.semantic_adjudication, 'bounded');
  assert.equal(envelope.permissions.code_write, false);
  assert.equal(Object.isFrozen(envelope), true);
  assert.ok(renderRoleEnvelope(envelope).includes('semantic_adjudication: bounded'));
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('implement code')));
});

test('P5-L adjudicate: an explicit resolved/unresolved outcome decides deterministically, with no auto-correction', () => {
  const envelope = envelopeOf(runPipeline(ADJUDICATE_BOUNDED, attestedCapability('subagents', SUBAGENTS_CAPABILITIES)));

  const resolved = decideNextAction({
    role_envelope: envelope,
    outcome: 'ADJUDICATION_RESOLVED',
    counters: NO_COUNTERS,
    resume_role: 'implement',
  });
  const again = decideNextAction({
    role_envelope: envelope,
    outcome: 'ADJUDICATION_RESOLVED',
    counters: NO_COUNTERS,
    resume_role: 'implement',
  });
  assert.deepEqual(resolved, again);
  assert.ok(resolved.ok);
  assert.equal(resolved.decision.action, 'DE_ESCALATE_TO_ROLE');
  assert.equal(resolved.decision.role, 'implement', 'de-escalation returns to the supplied role');

  const unresolved = decideNextAction({
    role_envelope: envelope,
    outcome: 'ADJUDICATION_UNRESOLVED',
    counters: NO_COUNTERS,
  });
  assert.ok(unresolved.ok);
  assert.equal(unresolved.decision.action, 'HUMAN_DECISION_REQUIRED');

  const noDownstream = decideNextAction({
    role_envelope: envelope,
    outcome: 'ADJUDICATION_RESOLVED',
    counters: NO_COUNTERS,
  });
  assert.ok(noDownstream.ok);
  assert.equal(noDownstream.decision.action, 'HUMAN_DECISION_REQUIRED', 'no downstream role is invented');
});

// ── P5-L — §18 fail-closed pipeline ────────────────────────────────────────

test('P5-L fail-closed: parent + allowed_tools=required stops at Phase 3 with no envelope', () => {
  const run = runPipeline(UNSUPPORTED_HARD_ENFORCEMENT, attestedCapability('parent', PARENT_CAPABILITIES));

  assert.ok(run.validated.ok, 'the TaskContract itself is valid; the target cannot supply the guarantee');
  assert.ok(run.resolved?.ok, 'resolution does not drop the carried requirement');
  assert.equal(run.resolved.contract.requirements?.enforcement?.allowed_tools, 'required');
  assert.equal(run.bound?.ok, false);
  assert.deepEqual(run.bound?.ok === false ? codes(run.bound.errors) : [], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  assert.equal(run.bound?.ok === false ? 'binding' in run.bound : true, false, 'a failed binding carries no artifact');

  // A failed binding compiles nothing: the compiler refuses the absent artifact rather than inventing one.
  assert.equal(run.envelope, undefined);
  assert.equal(compileRoleEnvelope({ target_binding: undefined }).ok, false);
});

test('P5-L fail-closed: the Phase 5 policy has no route around the unsupported target', () => {
  // The same contract without the unsatisfiable requirement, so an envelope exists to ask the policy with.
  const envelope = envelopeOf(runPipeline(IMPLEMENT_PARENT, attestedCapability('parent', PARENT_CAPABILITIES)));
  const result = decideNextAction({
    role_envelope: envelope,
    outcome: 'EXECUTION_TARGET_UNSUPPORTED',
    counters: NO_COUNTERS,
    resume_role: 'implement',
  });
  assert.ok(result.ok);
  assert.equal(result.decision.action, 'STOP_UNSUPPORTED_BY_EXECUTION_TARGET');
  assert.equal(result.decision.role, undefined, 'no target switch, no role substitution');
  // Without an envelope the policy decides nothing at all, so it cannot route around a failed binding.
  assert.equal(
    decideNextAction({ outcome: 'EXECUTION_TARGET_UNSUPPORTED', counters: NO_COUNTERS }).ok,
    false,
  );
});

// ── P5-K — E1–E10 final conformance ────────────────────────────────────────

test('P5-K E1 model unavailable: explicit fallback only, never silent substitution', () => {
  const contract = taskWithRole('implement');
  // Preferred unavailable; a fallback is available only where the profile explicitly admits it.
  const preferredUnavailable: ResolverEnv = { ...ENV, available: ['gpt-5.6-sol', 'deepseek-v4.1-flash'] };

  const noAdmittedFallback = resolveExecutionContract(contract, {
    ...preferredUnavailable,
    profile: { ...ENV.profile, workhorse: { preferred: 'gemini-3.8-flash', fallback: [] } },
  });
  assert.equal(noAdmittedFallback.ok, false);
  assert.deepEqual(noAdmittedFallback.ok ? [] : codes(noAdmittedFallback.errors), ['MODEL_UNAVAILABLE']);

  const withFallback = resolveExecutionContract(contract, {
    ...preferredUnavailable,
    profile: { ...ENV.profile, workhorse: { preferred: 'gemini-3.8-flash', fallback: ['deepseek-v4.1-flash'] } },
  });
  assert.ok(withFallback.ok);
  assert.equal(withFallback.contract.model.resolved, 'deepseek-v4.1-flash');
  assert.equal(withFallback.contract.model.fallback_used, true);
  assert.equal(withFallback.contract.model.preferred, 'gemini-3.8-flash');

  // A model that is available but not admitted for the tier is never selected: no closest-model,
  // same-vendor, or strongest-available guessing.
  const unrelated = resolveExecutionContract(contract, {
    ...preferredUnavailable,
    profile: { ...ENV.profile, workhorse: { preferred: 'gemini-3.8-flash', fallback: [] } },
  });
  assert.equal(unrelated.ok, false);
  assert.equal(unrelated.ok ? undefined : unrelated.errors[0]?.code, 'MODEL_UNAVAILABLE');
  // The stop is only reachable through the Phase 5 policy as one terminal decision.
  const stopped = decideNextAction({
    role_envelope: envelopeOf(runPipeline(IMPLEMENT_PARENT, attestedCapability('parent', PARENT_CAPABILITIES))),
    outcome: 'MODEL_UNAVAILABLE',
    counters: NO_COUNTERS,
  });
  assert.ok(stopped.ok);
  assert.equal(stopped.decision.action, 'STOP_MODEL_UNAVAILABLE');
});

test('P5-K E2 role/task/permission conflict fails closed', () => {
  for (const name of ['E2 review role with code_write=true', 'E2 planner role with code_write=true', 'E2 T4 without evidence']) {
    const fixture = negative(name);
    const result = validateTaskContract(fixture.contract, { authorityBinder: BINDER });
    assert.equal(result.ok, false, name);
    assert.deepEqual(codes(result.ok ? [] : result.errors), fixture.expected, name);
  }
  // Resolution does not accept what validation rejects, either.
  assert.equal(resolveExecutionContract(negative('E2 review role with code_write=true').contract, ENV).ok, false);
});

test('P5-K E3 unresolved or ambiguous authority fails closed', () => {
  for (const name of ['E3 unknown authority reference', 'E3 ambiguous authority reference', 'E3 one of two references unresolved']) {
    const fixture = negative(name);
    const result = validateTaskContract(fixture.contract, {
      authorityBinder: fixture.ambiguousBinder ? AMBIGUOUS_BINDER : BINDER,
    });
    assert.equal(result.ok, false, name);
    assert.deepEqual(codes(result.ok ? [] : result.errors), ['AUTHORITY_UNRESOLVED'], name);
  }
  // No binder at all is still a refusal, never a guess.
  const unbound = validateTaskContract(positive('read-only review'), {});
  assert.equal(unbound.ok, false);
  assert.deepEqual(codes(unbound.ok ? [] : unbound.errors), ['AUTHORITY_UNRESOLVED']);
});

test('P5-K E4 invalid or overbroad scope fails closed', () => {
  for (const name of ['E4 bounded write role with empty scope', 'E4 unrestricted scope without explicit override', 'E4 scope entry escaping root', 'E4 absolute scope entry']) {
    const fixture = negative(name);
    const result = validateTaskContract(fixture.contract, { authorityBinder: BINDER });
    assert.equal(result.ok, false, name);
    assert.deepEqual(codes(result.ok ? [] : result.errors), fixture.expected, name);
  }
  // The explicit override is the only admission of unrestricted scope.
  assert.ok(validateTaskContract(positive('unrestricted scope admitted by explicit override'), { authorityBinder: BINDER }).ok);
});

test('P5-K E5 unverifiable acceptance fails closed', () => {
  for (const name of ['E5 fuzzy command acceptance', 'E5 fuzzy assertion acceptance', 'E5 fuzzy single-token assertion', 'E5 empty acceptance']) {
    const fixture = negative(name);
    const result = validateTaskContract(fixture.contract, { authorityBinder: BINDER });
    assert.equal(result.ok, false, name);
    assert.deepEqual(codes(result.ok ? [] : result.errors), ['ACCEPTANCE_INVALID'], name);
  }
});

test('P5-K E6 bounded escalation: the canonical decision mapping, end to end', () => {
  const implement = envelopeOf(runPipeline(IMPLEMENT_PARENT, attestedCapability('parent', PARENT_CAPABILITIES)));
  const correct = envelopeOf(runPipeline(CORRECT_FROZEN, attestedCapability('parent', PARENT_CAPABILITIES)));
  const adjudicate = envelopeOf(runPipeline(ADJUDICATE_BOUNDED, attestedCapability('subagents', SUBAGENTS_CAPABILITIES)));

  const matrix: {
    id: string;
    envelope: RoleEnvelope;
    outcome: ExecutionOutcome;
    counters: EscalationCounters;
    resume_role?: Role;
    expected: NextAction;
  }[] = [
    { id: 'E6-A', envelope: implement, outcome: 'MECHANICAL_FAILURE', counters: NO_COUNTERS, expected: 'RETRY_SAME_ROLE' },
    { id: 'E6-B', envelope: implement, outcome: 'MECHANICAL_FAILURE', counters: { ...NO_COUNTERS, clean_retries_used: 1 }, expected: 'HUMAN_DECISION_REQUIRED' },
    { id: 'E6-C', envelope: implement, outcome: 'SEMANTIC_AMBIGUITY', counters: NO_COUNTERS, expected: 'ADJUDICATE' },
    { id: 'E6-D', envelope: implement, outcome: 'SEMANTIC_AMBIGUITY', counters: { ...NO_COUNTERS, semantic_escalations_used: 1 }, expected: 'HUMAN_DECISION_REQUIRED' },
    { id: 'E6-E', envelope: implement, outcome: 'AUTHORITY_CONTRADICTION', counters: NO_COUNTERS, expected: 'ADJUDICATE' },
    { id: 'E6-F', envelope: adjudicate, outcome: 'ARCHITECTURE_CONTRADICTION', counters: NO_COUNTERS, expected: 'HUMAN_DECISION_REQUIRED' },
    { id: 'E6-G', envelope: implement, outcome: 'MODEL_UNAVAILABLE', counters: NO_COUNTERS, expected: 'STOP_MODEL_UNAVAILABLE' },
    { id: 'E6-H', envelope: implement, outcome: 'EXECUTION_TARGET_UNSUPPORTED', counters: NO_COUNTERS, expected: 'STOP_UNSUPPORTED_BY_EXECUTION_TARGET' },
    { id: 'E6-I', envelope: correct, outcome: 'MECHANICAL_FAILURE', counters: { ...NO_COUNTERS, correction_rounds_used: 2 }, expected: 'HUMAN_DECISION_REQUIRED' },
  ];

  for (const row of matrix) {
    const result = decideNextAction({
      role_envelope: row.envelope,
      outcome: row.outcome,
      counters: row.counters,
      ...(row.resume_role === undefined ? {} : { resume_role: row.resume_role }),
    });
    assert.ok(result.ok, `${row.id} must be decidable`);
    assert.equal(result.decision.action, row.expected, row.id);
    assert.deepEqual(row.counters, { ...row.counters }, `${row.id} must not mutate its counters`);
  }
});

test('P5-K E7 forbidden structured action fails closed', () => {
  for (const name of ['E7 release=false with tag action', 'E7 release=false with tag and publish actions', 'E7 external_write=false with push action']) {
    const fixture = negative(name);
    const result = validateTaskContract(fixture.contract, { authorityBinder: BINDER });
    assert.equal(result.ok, false, name);
    assert.deepEqual(codes(result.ok ? [] : result.errors), ['CONTRACT_CONTRADICTION'], name);
  }
  assert.ok(validateTaskContract(positive('release action with release explicitly admitted'), { authorityBinder: BINDER }).ok);
});

test('P5-K E8 monotonic narrowing: the resolved artifact never broadens the contract', () => {
  for (const fixture of POSITIVE_CONTRACTS) {
    const resolved = resolveExecutionContract(structuredClone(fixture.contract), ENV);
    assert.ok(resolved.ok, fixture.name);
    const contract = resolved.contract;

    assert.ok(subset(contract.authority.bound_sources, fixture.contract.authority.sources), `${fixture.name}: authority broadened`);
    for (const dimension of ['blockers', 'files', 'symbols', 'directories', 'sections'] as const) {
      assert.ok(
        subset(contract.scope[dimension] ?? [], fixture.contract.scope[dimension] ?? []),
        `${fixture.name}: scope.${dimension} broadened`,
      );
    }
    for (const key of ['code_write', 'research', 'external_write', 'release'] as const) {
      if (contract.permissions[key]) {
        assert.equal(fixture.contract.permissions[key], true, `${fixture.name}: permissions.${key} broadened`);
      }
    }
    assert.equal(contract.scope.allow_unrestricted, fixture.contract.scope.allow_unrestricted ?? undefined);
  }

  // A read-only contract cannot resolve into a write standing, whatever the role default says.
  const readOnly = resolveExecutionContract(positive('read-only review'), ENV);
  assert.ok(readOnly.ok);
  assert.equal(readOnly.contract.permissions.code_write, false);
  assert.equal(readOnly.contract.jurisdiction.mutation.repository, 'none');
  assert.equal(readOnly.contract.jurisdiction.implementation, 'none');
});

test('P5-K E9 equivalent explicit inputs resolve to equivalent ExecutionContracts', () => {
  for (const fixture of POSITIVE_CONTRACTS) {
    const first = resolveExecutionContract(structuredClone(fixture.contract), ENV);
    const second = resolveExecutionContract(structuredClone(fixture.contract), ENV);
    assert.ok(first.ok && second.ok, fixture.name);
    assert.deepEqual(first.contract, second.contract, `${fixture.name}: resolution is not deterministic`);
  }
  // The same availability snapshot in a different array order is the same input.
  const reordered: ResolverEnv = { ...ENV, available: [...(ENV.available ?? [])].reverse() };
  assert.deepEqual(
    resolveExecutionContract(positive('critical correction'), ENV),
    resolveExecutionContract(positive('critical correction'), reordered),
  );
});

test('P5-K E10 enforcement truth is never ENFORCED without an attested primitive and a policy', () => {
  const cases: [string, unknown, ExecutionTargetCapabilities][] = [
    ['critical correction', positive('critical correction'), PARENT_CAPABILITIES],
    ['read-only review', positive('read-only review'), PARENT_CAPABILITIES],
    ['subagents implement with independent review', positive('subagents implement with independent review'), SUBAGENTS_CAPABILITIES],
  ];
  for (const [label, contract, capabilities] of cases) {
    const run = runPipeline(contract, attestedCapability(label.startsWith('subagents') ? 'subagents' : 'parent', capabilities));
    assert.ok(run.bound?.ok, label);
    if (!run.bound.ok) return;
    const truth = run.bound.binding.enforcement;

    assert.equal(truth.model_selection === 'ENFORCED', capabilities.model_selection, label);
    // No positive fixture declares a tool policy, so the tool dimension is NOT_APPLICABLE — and never
    // ENFORCED — however capable the attested target is (T3).
    assert.equal(truth.allowed_tools, 'NOT_APPLICABLE', label);
    assert.equal(truth.allowed_files === 'ENFORCED', capabilities.file_scope_enforcement, label);
    // Neither v0.1 target owns a primitive for these: instruction only, never ENFORCED.
    assert.equal(truth.archaeology_off, 'INSTRUCTED', label);
    assert.equal(truth.release_forbidden, 'INSTRUCTED', label);
  }

  // A raw claim is never attested, so nothing it says can produce ENFORCED at all (T2).
  const claimed = runPipeline(positive('critical correction'), claimedClaim({
    name: 'parent',
    capabilities: { ...PARENT_CAPABILITIES, model_selection: true, tool_ceiling: true, file_scope_enforcement: true },
  }));
  assert.ok(claimed.bound?.ok);
  if (!claimed.bound.ok) return;
  assert.equal(claimed.bound.binding.capability_evidence.class, 'unattested_claim');
  assert.equal(Object.values(claimed.bound.binding.enforcement).includes('ENFORCED'), false);

  const required = runPipeline(UNSUPPORTED_HARD_ENFORCEMENT, attestedCapability('parent', PARENT_CAPABILITIES));
  assert.ok(required.validated.ok);
  assert.equal(required.bound?.ok, false);
  assert.deepEqual(required.bound?.ok === false ? codes(required.bound.errors) : [], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

// ── Shared fixture helpers ─────────────────────────────────────────────────

function taskWithRole(role: Role): TaskContract {
  const base = structuredClone(IMPLEMENT_PARENT);
  return { ...base, role, task: { ...base.task, id: `p5-${role}-availability` } };
}

function subset(inner: readonly string[], outer: readonly string[]): boolean {
  return inner.every((entry) => outer.includes(entry));
}

// ── P5-M — remaining canonical §41 representative fixtures ──────────────────

/**
 * §41 names three representative fixtures this suite did not yet cover end to end: planner
 * decomposition, a parent-only end-to-end cycle, and a subagents execution handoff.
 *
 * All three run the same real Phase 1–4 chain. None of them adds state to Charter: the TEST
 * sequences the calls, and every stage receives one explicit TaskContract and returns one artifact.
 */

/** A read-only review bound to the parent session, where independence is truthfully not claimed. */
function parentReviewContract(id: string): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id, class: 'T2', risk: 'high' },
    role: 'review',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['reviewer-findings', 'canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: false, research: false, external_write: false, release: false },
    acceptance: {
      assertions: ['findings-reported'],
      review: { required: true, independence: 'none', executor: 'same_session' },
    },
    verification: { level: 'V3' },
    limits: { semantic_escalations: 1 },
    non_goals: ['implementation'],
  };
}

/** Fields that would mean Charter owns a lifecycle. None of them may appear on any artifact. */
const LIFECYCLE_FIELDS = [
  'cycle',
  'cycle_step',
  'current_step',
  'previous_step',
  'next_step',
  'step_index',
  'workflow',
  'scheduler',
  'history',
  'run_state',
  'attempt',
  'retry_pending',
  'resume_token',
  'lease',
  'lock',
] as const;

function assertNoLifecycle(artifact: object, what: string): void {
  for (const field of LIFECYCLE_FIELDS) {
    assert.equal(field in artifact, false, `${what} must not carry lifecycle field '${field}'`);
  }
}

// ── §41 planner decomposition — full pipeline ───────────────────────────────

test('P5-M planner: the full decomposition pipeline on the parent target ends at the planner envelope', () => {
  const run = runPipeline(positive('planner decomposition (no mutation)'), attestedCapability('parent', PARENT_CAPABILITIES));
  const contract = contractOf(run);
  const envelope = envelopeOf(run);

  assert.ok(run.validated.ok);
  assert.ok(run.bound?.ok);
  assert.equal(contract.execution_target, 'parent');
  assert.equal(contract.model.tier, 'workhorse');
  assert.equal(contract.model.resolved, ENV.profile.workhorse?.preferred);

  // No mutation, and no implementation, architecture, or product authority.
  assert.deepEqual(contract.permissions, { code_write: false, research: false, external_write: false, release: false });
  assert.deepEqual(contract.jurisdiction.mutation, { repository: 'none', external: 'none', release: 'none' });
  assert.equal(contract.jurisdiction.implementation, 'none');
  assert.equal(contract.jurisdiction.architecture, 'none');
  assert.equal(contract.jurisdiction.product_semantics, 'none');
  assert.equal(contract.jurisdiction.research, false);

  // The planner decomposition envelope is compiled from exactly that binding.
  assert.equal(envelope.role, 'planner');
  assert.deepEqual(envelope.permissions, contract.permissions);
  assert.deepEqual(envelope.jurisdiction, contract.jurisdiction);
  assert.deepEqual(envelope.scope, contract.scope);
  assert.equal(envelope.enforcement_truth.model_selection, 'ENFORCED');
  // The planner fixture declares no scope entries, so there is no exact file policy to act on (T3).
  assert.equal(envelope.enforcement_truth.allowed_files, 'NOT_APPLICABLE');
  assert.ok(renderRoleEnvelope(envelope).includes('role: planner'));
  assert.ok(envelope.operating_rules.some((rule) => rule.includes('bounded child TaskContract candidates only')));
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('write, modify, or delete repository content; planning is read-only')));
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('implement code')));
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('reopen or redesign product architecture')));
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('invent product capability, roadmap')));
  assert.ok(envelope.stop_conditions.some((rule) => rule.includes('decomposition is complete')));

  // No child execution: the pipeline stops at an artifact, and its result has no child channel.
  assert.deepEqual(Object.keys(run).sort(), ['bound', 'envelope', 'resolved', 'validated']);
  assertNoLifecycle(run, 'the pipeline result');
  assert.equal('children' in run, false);
  assert.equal('child_contracts' in run, false);
});

// ── §41 parent-only end-to-end cycle ────────────────────────────────────────

test('P5-M cycle: planner → implement → review → correct → review on the parent target alone', () => {
  // The TEST owns the sequence. Each stage is one explicit TaskContract and one separate call.
  const cycle: { contract: TaskContract }[] = [
    { contract: positive('planner decomposition (no mutation)') },
    { contract: structuredClone(IMPLEMENT_PARENT) },
    { contract: parentReviewContract('p5-cycle-review-1') },
    { contract: structuredClone(CORRECT_FROZEN) },
    { contract: parentReviewContract('p5-cycle-review-2') },
  ];

  const stages = cycle.map(({ contract }) => {
    const run = runPipeline(contract, attestedCapability('parent', PARENT_CAPABILITIES));
    return { contract, run, resolved: contractOf(run), envelope: envelopeOf(run) };
  });

  assert.deepEqual(stages.map((s) => s.resolved.role), ['planner', 'implement', 'review', 'correct', 'review']);
  assert.deepEqual(stages.map((s) => s.resolved.task_id), [
    'decompose-frozen-work',
    'p5-implement-parent',
    'p5-cycle-review-1',
    'p5-correct-frozen-finding',
    'p5-cycle-review-2',
  ]);
  for (const stage of stages) {
    assert.ok(stage.run.bound?.ok, `${stage.resolved.role}: the stage must bind on the parent target`);
    assert.equal(stage.resolved.execution_target, 'parent');
    assert.equal(stage.run.bound.binding.execution_contract.execution_target, 'parent');
    assert.equal(stage.envelope.execution_target, 'parent');
  }

  // Both reviews are same-session and truthfully not independent — no independence is fabricated.
  const [plannerStage, implementStage, firstReview, correction, secondReview] = stages;
  assert.ok(plannerStage && implementStage && firstReview && correction && secondReview);
  for (const reviewStage of [firstReview, secondReview]) {
    assert.deepEqual(reviewStage.envelope.acceptance.review, {
      required: true,
      independence: 'none',
      executor: 'same_session',
    });
    const text = renderRoleEnvelope(reviewStage.envelope);
    assert.ok(text.includes('review is same-session; this is NOT independent review'));
    assert.equal(text.includes('independent review is required by this contract'), false);
    assert.ok(reviewStage.envelope.prohibitions.some((rule) => rule.includes('describe this review as independent')));
    assert.deepEqual(reviewStage.envelope.permissions, {
      code_write: false,
      research: false,
      external_write: false,
      release: false,
    });
  }

  // The correction carries its named blocker, and stays bounded implementation — not a second review.
  assert.deepEqual(correction.envelope.scope.blockers, ['finding-1']);
  assert.deepEqual(correction.envelope.correction_targets.map((target) => target.id), ['finding-1']);
  assert.ok(
    correction.envelope.operating_rules.some((rule) => rule.includes('admitted correction targets are') && rule.includes('finding-1')),
  );
  assert.equal(correction.envelope.jurisdiction.implementation, 'bounded');
  assert.equal(correction.envelope.jurisdiction.architecture, 'none');

  // The cycle works WITHOUT Charter owning cycle state. Every stage artifact is a pure function of its
  // own single contract: recomputed in reverse order, after the whole cycle ran, the artifacts are
  // deep-equal — nothing accumulated, and no artifact carries a step or lifecycle field.
  const recomputed = [...cycle]
    .reverse()
    .map(({ contract }) => runPipeline(structuredClone(contract), attestedCapability('parent', PARENT_CAPABILITIES)))
    .reverse();
  assert.deepEqual(
    recomputed.map((run) => ({ resolved: run.resolved, bound: run.bound, envelope: run.envelope })),
    stages.map((stage) => ({ resolved: stage.run.resolved, bound: stage.run.bound, envelope: stage.run.envelope })),
    'stage artifacts must not depend on the other stages',
  );
  for (const stage of stages) {
    assertNoLifecycle(stage.envelope, `${stage.resolved.role} envelope`);
    assertNoLifecycle(stage.resolved, `${stage.resolved.role} resolved contract`);
    assertNoLifecycle(stage.run, `${stage.resolved.role} pipeline result`);
  }
});

// ── §41 subagents execution handoff ─────────────────────────────────────────

test('P5-M subagents handoff: validate → resolve → bindSubagentsTarget hands off bound truth', () => {
  const validated = validateTaskContract(structuredClone(REVIEW_SUBAGENTS), { authorityBinder: ENV.authorityBinder });
  assert.ok(validated.ok);
  const resolved = resolveExecutionContract(validated.contract, ENV);
  assert.ok(resolved.ok, 'the review contract must resolve');
  const bound = bindSubagentsTarget({
    execution_contract: resolved.contract,
    ...attestedCapability('subagents', SUBAGENTS_CAPABILITIES),
  });
  assert.ok(bound.ok, 'the subagents target must accept this contract');
  if (!bound.ok) return;
  const handoff = bound.handoff;

  // Handoff truth: target, resolved role, resolved model, fresh-session requirement, enforcement truth.
  assert.equal(handoff.target, 'subagents');
  assert.equal(handoff.role, resolved.contract.role);
  assert.equal(handoff.role, 'review');
  assert.equal(handoff.model, resolved.contract.model.resolved);
  assert.equal(handoff.model, ENV.profile.reviewer?.preferred);
  assert.equal(handoff.fresh_session_required, true);
  // The review contract declares an exact tool policy, so the attested ceiling is really ENFORCED.
  assert.deepEqual(handoff.enforcement, {
    model_selection: 'ENFORCED',
    allowed_tools: 'ENFORCED',
    allowed_files: 'INSTRUCTED',
    archaeology_off: 'INSTRUCTED',
    release_forbidden: 'INSTRUCTED',
  });
  assert.deepEqual(handoff.allowed_tools, REVIEW_SUBAGENTS.execution_policy?.allowed_tools);
  assert.equal(handoff.capability_evidence.class, 'attested');

  // The resolved ExecutionContract crosses unchanged, as a value rather than a handle.
  assert.deepEqual(handoff.execution_contract, resolved.contract);
  assert.notEqual(handoff.execution_contract, resolved.contract);

  // The handoff surface is exactly these fields: no role envelope rides in it, and no runtime bridge,
  // child, session, or lifecycle handle exists to cross.
  assert.deepEqual(Object.keys(handoff).sort(), [
    'allowed_tools',
    'capability_evidence',
    'enforcement',
    'execution_contract',
    'fresh_session_required',
    'model',
    'role',
    'target',
  ]);
  for (const field of ['envelope', 'role_envelope', 'prompt', 'child', 'child_id', 'session', 'session_id', 'worker', 'worker_id', 'spawn', 'retry', 'recovery']) {
    assert.equal(field in handoff, false, `the handoff must not carry '${field}'`);
  }
  assertNoLifecycle(handoff, 'the handoff');

  // RoleEnvelope stays core-only: it is compiled from a Phase 3 binding, never from the handoff.
  // That binding must be attested — a claim cannot satisfy this contract's hard capability
  // requirements (T2), which is why the envelope is compiled from the strong path here.
  const claimedBinding = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_claim: SUBAGENTS_SNAPSHOT,
  });
  assert.equal(claimedBinding.ok, false, 'a raw claim cannot satisfy this contract\'s hard capability requirements');
  const coreBinding = bindExecutionTarget({
    execution_contract: resolved.contract,
    ...attestedCapability('subagents', SUBAGENTS_CAPABILITIES),
  });
  assert.ok(coreBinding.ok);
  const envelope = compileBoundRoleEnvelope(coreBinding.binding);
  assert.ok(envelope.ok);
  assert.equal(envelope.envelope.role, handoff.role);
  assert.deepEqual(envelope.envelope.enforcement_truth, handoff.enforcement);
  assert.equal('role_envelope' in handoff, false, 'the envelope is not a handoff channel');
});

test('P5-M subagents handoff: another target is refused, and an absent review requirement is reported truthfully', () => {
  // No target substitution: a parent contract cannot borrow the subagents path.
  const parentResolved = resolveExecutionContract(structuredClone(IMPLEMENT_PARENT), ENV);
  assert.ok(parentResolved.ok);
  const refused = bindSubagentsTarget({
    execution_contract: parentResolved.contract,
    ...attestedCapability('parent', PARENT_CAPABILITIES),
  });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.ok === false ? codes(refused.errors) : [], ['CONTRACT_CONTRADICTION']);

  // A subagents contract that requires no independent review reports fresh_session_required=false:
  // nothing is upgraded, and nothing is spawned to find out.
  const noReview = structuredClone(positive('subagents implement with independent review'));
  noReview.task.id = 'p5-subagents-no-review';
  delete noReview.acceptance.review;
  const validated = validateTaskContract(noReview, { authorityBinder: ENV.authorityBinder });
  assert.ok(validated.ok);
  const resolved = resolveExecutionContract(validated.contract, ENV);
  assert.ok(resolved.ok);
  assert.equal(resolved.contract.execution_target, 'subagents');
  const bound = bindSubagentsTarget({ execution_contract: resolved.contract, capability_claim: SUBAGENTS_SNAPSHOT });
  assert.ok(bound.ok);
  assert.equal(bound.ok ? bound.handoff.fresh_session_required : true, false);
  assert.equal(bound.ok ? bound.handoff.model : undefined, resolved.contract.model.resolved);
});
