import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../authority/binder.ts';
import type { CharterError } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import type { Role, TaskContract } from '../contracts/task-contract.ts';
import { compileBoundRoleEnvelope, type RoleEnvelope } from '../envelopes/role-envelope.ts';
import {
  bindExecutionTarget,
  type ExecutionTargetCapabilities,
} from '../enforcement/target-binding.ts';
import { resolveExecutionContract, type ResolverEnv } from '../resolver/resolve.ts';
import { ASSERTION_BINDER, CORRECTION_BINDER, ROOT } from '../validation/fixtures.ts';
import {
  EXECUTION_OUTCOMES,
  NEXT_ACTIONS,
  decideNextAction,
  type EscalationCounters,
  type NextAction,
  type NextActionDecision,
  type NextActionResult,
} from './escalation-policy.ts';

// ── Inputs ──────────────────────────────────────────────────────────────────

const BINDER = createAuthorityBinder({
  'canonical-master': { doc: 'PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md' },
  'reviewer-findings': { doc: 'review-findings.json' },
});

const ENV: ResolverEnv = {
  authorityBinder: BINDER,
  assertionBinder: ASSERTION_BINDER,
  correctionBinder: CORRECTION_BINDER,
  profile: {
    workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
    reviewer: { preferred: 'gpt-5.6-sol', fallback: [] },
    reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
  },
  available: ['gemini-3.8-flash', 'gpt-5.6-sol'],
};

/** Environment input for these tests only: Charter stores no capability facts (spec §25). */
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

/** Shape-complete TaskContract with per-test overrides. Test input only — never a Charter default. */
function task(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'p5-bounded-work', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V2' },
    ...overrides,
  };
}

/** Resolve → bind target → compile the Phase 4 artifact. The Phase 5 policy reads this artifact. */
function envelopeFor(
  contract: TaskContract,
  capabilities: ExecutionTargetCapabilities = PARENT_CAPABILITIES,
): RoleEnvelope {
  const resolved = resolveExecutionContract(contract, ENV);
  assert.ok(resolved.ok, 'fixture contract must resolve');
  // Attested capability: a review that requires independence cannot rest on a raw claim (T2).
  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_attestation: {
      source_kind: 'execution_adapter',
      source: `pi-${resolved.contract.execution_target}`,
      source_version: '0.1.0',
      payload: { target: resolved.contract.execution_target, capabilities },
    },
  });
  assert.ok(bound.ok, 'fixture contract must bind to its execution target');
  const compiled = compileBoundRoleEnvelope(bound.binding);
  assert.ok(compiled.ok, 'fixture contract must compile a role envelope');
  return compiled.envelope;
}

const LIMITS = { correction_rounds: 2, semantic_escalations: 1 };

const IMPLEMENT = envelopeFor(task({ limits: LIMITS }));
const CORRECT = envelopeFor(
  task({ role: 'correct', scope: { blockers: ['finding-1'], files: ['src/feature.ts'] }, limits: LIMITS }),
);
const ADJUDICATE = envelopeFor(
  task({
    task: { id: 'p5-adjudication', class: 'T4', risk: 'critical', evidence: ['contradiction-report-1'] },
    role: 'adjudicate',
    scope: { sections: ['3. Product Boundary'] },
    permissions: { code_write: false, research: false, external_write: false, release: false },
    acceptance: { assertions: ['decision-frozen'] },
    verification: { level: 'V0' },
    limits: { semantic_escalations: 1 },
  }),
);
const REVIEW = envelopeFor(
  task({
    role: 'review',
    execution_target: 'subagents',
    permissions: { code_write: false, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'], review: { required: true, independence: 'independent', executor: 'fresh_session' } },
    limits: LIMITS,
  }),
  SUBAGENTS_CAPABILITIES,
);
/** No declared limits: the fixture that proves an undeclared bound is not an invented bound. */
const IMPLEMENT_NO_LIMITS = envelopeFor(task());

const NO_COUNTERS: EscalationCounters = {
  clean_retries_used: 0,
  correction_rounds_used: 0,
  semantic_escalations_used: 0,
};

function decide(
  envelope: RoleEnvelope,
  outcome: unknown,
  counters: EscalationCounters = NO_COUNTERS,
  resume_role?: Role,
): NextActionResult {
  return decideNextAction({
    role_envelope: envelope,
    outcome,
    counters,
    ...(resume_role === undefined ? {} : { resume_role }),
  });
}

/** The decided action, or the failure codes. One bounded decision per call, no re-ask. */
function actionOf(result: NextActionResult): NextAction {
  assert.ok(result.ok, `expected a decision, got ${JSON.stringify(result.ok ? [] : result.errors)}`);
  return result.decision.action;
}

function decisionOf(result: NextActionResult): NextActionDecision {
  assert.ok(result.ok, `expected a decision, got ${JSON.stringify(result.ok ? [] : result.errors)}`);
  return result.decision;
}

function codesOf(result: NextActionResult): string[] {
  return result.ok ? [] : [...new Set(result.errors.map((e: CharterError) => e.code))];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// ── P5-A — success terminal ─────────────────────────────────────────────────

test('P5-A SUCCESS is terminal: PASS, no role, and no further action', () => {
  for (const envelope of [IMPLEMENT, CORRECT, ADJUDICATE, REVIEW]) {
    const decision = decisionOf(decide(envelope, 'SUCCESS'));
    assert.equal(decision.action, 'PASS', `role=${envelope.role} must reach PASS on SUCCESS`);
    assert.equal(decision.role, undefined, 'a terminal decision routes to no role');
    assert.deepEqual(Object.keys(decision).sort(), ['action', 'reason']);
  }
});

test('P5-A a green result stays green even when every limit is already spent', () => {
  const decision = decisionOf(
    decide(IMPLEMENT, 'SUCCESS', { clean_retries_used: 5, correction_rounds_used: 5, semantic_escalations_used: 5 }),
  );
  assert.equal(decision.action, 'PASS');
});

// ── P5-B — mechanical failure and the one-clean-retry policy ────────────────

test('P5-B / E6-A MECHANICAL_FAILURE with clean_retries_used=0 → RETRY_SAME_ROLE', () => {
  for (const envelope of [IMPLEMENT, REVIEW]) {
    const decision = decisionOf(decide(envelope, 'MECHANICAL_FAILURE'));
    assert.equal(decision.action, 'RETRY_SAME_ROLE');
    assert.equal(decision.role, envelope.role, 'the retry is the same role, never another one');
  }
});

test('P5-B / E6-B MECHANICAL_FAILURE with clean_retries_used=1 → HUMAN_DECISION_REQUIRED', () => {
  const decision = decisionOf(
    decide(IMPLEMENT, 'MECHANICAL_FAILURE', { ...NO_COUNTERS, clean_retries_used: 1 }),
  );
  assert.equal(decision.action, 'HUMAN_DECISION_REQUIRED');
  assert.equal(decision.role, undefined);
});

test('P5-B beyond the policy (clean_retries_used=2) is still HUMAN_DECISION_REQUIRED', () => {
  assert.equal(
    actionOf(decide(IMPLEMENT, 'MECHANICAL_FAILURE', { ...NO_COUNTERS, clean_retries_used: 2 })),
    'HUMAN_DECISION_REQUIRED',
  );
});

// ── P5-C — semantic ambiguity bounded escalation ────────────────────────────

test('P5-C / E6-C SEMANTIC_AMBIGUITY below the declared limit → ADJUDICATE', () => {
  const decision = decisionOf(decide(IMPLEMENT, 'SEMANTIC_AMBIGUITY'));
  assert.equal(decision.action, 'ADJUDICATE');
  assert.equal(decision.role, 'adjudicate', 'the canonical ambiguity route is adjudication');
});

test('P5-C / E6-D SEMANTIC_AMBIGUITY at the declared limit → HUMAN_DECISION_REQUIRED', () => {
  const decision = decisionOf(
    decide(IMPLEMENT, 'SEMANTIC_AMBIGUITY', { ...NO_COUNTERS, semantic_escalations_used: 1 }),
  );
  assert.equal(decision.action, 'HUMAN_DECISION_REQUIRED');
  assert.equal(decision.role, undefined);
});

test('P5-C above the declared limit is still HUMAN_DECISION_REQUIRED', () => {
  assert.equal(
    actionOf(decide(IMPLEMENT, 'SEMANTIC_AMBIGUITY', { ...NO_COUNTERS, semantic_escalations_used: 4 })),
    'HUMAN_DECISION_REQUIRED',
  );
});

test('P5-C an undeclared limit is not an invented bound: the canonical default response applies', () => {
  const decision = decisionOf(
    decide(IMPLEMENT_NO_LIMITS, 'SEMANTIC_AMBIGUITY', { ...NO_COUNTERS, semantic_escalations_used: 3 }),
  );
  assert.equal(decision.action, 'ADJUDICATE');
  assert.equal(decision.role, 'adjudicate');
});

// ── P5-D — authority contradiction bounded escalation ───────────────────────

test('P5-D / E6-E AUTHORITY_CONTRADICTION below the limit → ADJUDICATE', () => {
  const decision = decisionOf(decide(IMPLEMENT, 'AUTHORITY_CONTRADICTION'));
  assert.equal(decision.action, 'ADJUDICATE');
  assert.equal(decision.role, 'adjudicate');
});

test('P5-D AUTHORITY_CONTRADICTION at the limit → HUMAN_DECISION_REQUIRED', () => {
  assert.equal(
    actionOf(decide(IMPLEMENT, 'AUTHORITY_CONTRADICTION', { ...NO_COUNTERS, semantic_escalations_used: 1 })),
    'HUMAN_DECISION_REQUIRED',
  );
});

// ── P5-E — architecture contradiction is always a human decision ────────────

test('P5-E / E6-F ARCHITECTURE_CONTRADICTION → HUMAN_DECISION_REQUIRED, always', () => {
  const decision = decisionOf(decide(ADJUDICATE, 'ARCHITECTURE_CONTRADICTION'));
  assert.equal(decision.action, 'HUMAN_DECISION_REQUIRED');
  assert.equal(decision.role, undefined, 'no architecture-review role is invented');
  // Even with escalation budget remaining: architecture is never routed to adjudication.
  assert.equal(actionOf(decide(IMPLEMENT, 'ARCHITECTURE_CONTRADICTION')), 'HUMAN_DECISION_REQUIRED');
});

// ── P5-F / P5-G — stops for model and target gaps ───────────────────────────

test('P5-F / E6-G MODEL_UNAVAILABLE → STOP_MODEL_UNAVAILABLE, no substitution', () => {
  const decision = decisionOf(decide(IMPLEMENT, 'MODEL_UNAVAILABLE'));
  assert.equal(decision.action, 'STOP_MODEL_UNAVAILABLE');
  assert.equal(decision.role, undefined, 'no model or role is selected here');
});

test('P5-G / E6-H EXECUTION_TARGET_UNSUPPORTED → STOP_UNSUPPORTED_BY_EXECUTION_TARGET', () => {
  const decision = decisionOf(decide(IMPLEMENT, 'EXECUTION_TARGET_UNSUPPORTED'));
  assert.equal(decision.action, 'STOP_UNSUPPORTED_BY_EXECUTION_TARGET');
  assert.equal(decision.role, undefined, 'the target is not switched');
});

// ── P5-H — limit exhaustion ─────────────────────────────────────────────────

test('P5-H / E6-I an exhausted correction round → HUMAN_DECISION_REQUIRED, no loop', () => {
  const decision = decisionOf(
    decide(CORRECT, 'MECHANICAL_FAILURE', { ...NO_COUNTERS, correction_rounds_used: 2 }),
  );
  assert.equal(decision.action, 'HUMAN_DECISION_REQUIRED');
  assert.equal(decision.role, undefined, 'no automatic next execution is decided');
});

test('P5-H a correction round inside the declared budget still retries the correction role once', () => {
  const decision = decisionOf(
    decide(CORRECT, 'MECHANICAL_FAILURE', { ...NO_COUNTERS, correction_rounds_used: 1 }),
  );
  assert.equal(decision.action, 'RETRY_SAME_ROLE');
  assert.equal(decision.role, 'correct');
});

test('P5-H an undeclared correction budget bounds nothing that was not declared', () => {
  assert.equal(actionOf(decide(IMPLEMENT_NO_LIMITS, 'MECHANICAL_FAILURE')), 'RETRY_SAME_ROLE');
});

test('P5-H the two limits are independent: a spent semantic limit does not move the retry policy', () => {
  assert.equal(
    actionOf(decide(IMPLEMENT, 'MECHANICAL_FAILURE', { ...NO_COUNTERS, semantic_escalations_used: 9 })),
    'RETRY_SAME_ROLE',
  );
});

// ── P5-H — de-escalation after adjudication (§7, §31) ───────────────────────

test('P5-H ADJUDICATION_RESOLVED de-escalates to the explicitly supplied downstream role', () => {
  for (const downstream of ['implement', 'correct', 'review', 'planner'] as const) {
    const decision = decisionOf(decide(ADJUDICATE, 'ADJUDICATION_RESOLVED', NO_COUNTERS, downstream));
    assert.equal(decision.action, 'DE_ESCALATE_TO_ROLE');
    assert.equal(decision.role, downstream, 'the downstream role is the supplied one, never inferred');
  }
});

test('P5-H ADJUDICATION_RESOLVED without an explicit downstream role → HUMAN_DECISION_REQUIRED', () => {
  assert.equal(actionOf(decide(ADJUDICATE, 'ADJUDICATION_RESOLVED')), 'HUMAN_DECISION_REQUIRED');
});

test('P5-H ADJUDICATION_RESOLVED must not keep the adjudicator as its own successor', () => {
  const decision = decisionOf(decide(ADJUDICATE, 'ADJUDICATION_RESOLVED', NO_COUNTERS, 'adjudicate'));
  assert.equal(decision.action, 'HUMAN_DECISION_REQUIRED');
  assert.equal(decision.role, undefined);
});

test('P5-H ADJUDICATION_UNRESOLVED → HUMAN_DECISION_REQUIRED, with no automatic re-adjudication', () => {
  const decision = decisionOf(decide(ADJUDICATE, 'ADJUDICATION_UNRESOLVED', NO_COUNTERS, 'implement'));
  assert.equal(decision.action, 'HUMAN_DECISION_REQUIRED');
  assert.equal(decision.role, undefined);
});

test('P5-H an adjudication outcome from a non-adjudicating envelope fails closed', () => {
  for (const outcome of ['ADJUDICATION_RESOLVED', 'ADJUDICATION_UNRESOLVED'] as const) {
    const result = decide(IMPLEMENT, outcome, NO_COUNTERS, 'implement');
    assert.equal(result.ok, false, `${outcome} must not be accepted from role=implement`);
    assert.deepEqual(codesOf(result), ['CONTRACT_CONTRADICTION']);
  }
});

// ── P5-I — determinism and immutability ─────────────────────────────────────

test('P5-I identical inputs produce deep-equivalent decisions', () => {
  const matrix: [RoleEnvelope, unknown, EscalationCounters][] = [
    [IMPLEMENT, 'SUCCESS', NO_COUNTERS],
    [IMPLEMENT, 'MECHANICAL_FAILURE', NO_COUNTERS],
    [IMPLEMENT, 'MECHANICAL_FAILURE', { ...NO_COUNTERS, clean_retries_used: 1 }],
    [IMPLEMENT, 'SEMANTIC_AMBIGUITY', NO_COUNTERS],
    [IMPLEMENT, 'AUTHORITY_CONTRADICTION', { ...NO_COUNTERS, semantic_escalations_used: 1 }],
    [IMPLEMENT, 'ARCHITECTURE_CONTRADICTION', NO_COUNTERS],
    [IMPLEMENT, 'MODEL_UNAVAILABLE', NO_COUNTERS],
    [IMPLEMENT, 'EXECUTION_TARGET_UNSUPPORTED', NO_COUNTERS],
    [CORRECT, 'MECHANICAL_FAILURE', { ...NO_COUNTERS, correction_rounds_used: 2 }],
    [ADJUDICATE, 'ADJUDICATION_RESOLVED', NO_COUNTERS],
    [ADJUDICATE, 'ADJUDICATION_UNRESOLVED', NO_COUNTERS],
  ];
  for (const [envelope, outcome, counters] of matrix) {
    const first = decideNextAction({ role_envelope: envelope, outcome, counters });
    const second = decideNextAction({ role_envelope: envelope, outcome, counters });
    assert.deepEqual(first, second, `non-deterministic decision for outcome=${String(outcome)}`);
  }
});

test('P5-I deep-frozen inputs are accepted and no input is mutated', () => {
  const envelope = envelopeFor(task({ limits: LIMITS }));
  const counters: EscalationCounters = { clean_retries_used: 0, correction_rounds_used: 1, semantic_escalations_used: 0 };
  const frozenEnvelope = structuredClone(envelope);
  const frozenCounters = structuredClone(counters);
  const input = deepFreeze({ role_envelope: envelope, outcome: 'SEMANTIC_AMBIGUITY', counters, resume_role: 'implement' });

  const before = JSON.stringify({ envelope, counters, input });
  const decision = decisionOf(decideNextAction(input));
  assert.equal(decision.action, 'ADJUDICATE');
  assert.equal(JSON.stringify({ envelope, counters, input }), before, 'inputs were mutated');
  assert.deepEqual(structuredClone(envelope), frozenEnvelope);
  assert.deepEqual(structuredClone(counters), frozenCounters);
});

test('P5-I the returned decision is sealed against widening', () => {
  const decision = decisionOf(decide(IMPLEMENT, 'SEMANTIC_AMBIGUITY'));
  assert.equal(Object.isFrozen(decision), true);
});

test('P5-I the decision cannot express a runtime lifecycle state', () => {
  const forbidden = ['QUEUED', 'RUNNING', 'WAITING', 'BLOCKED_WORKER', 'RESUMING', 'RECOVERING'];
  for (const state of forbidden) {
    assert.equal((NEXT_ACTIONS as readonly string[]).includes(state), false, `'${state}' must not be a next action`);
    assert.equal((EXECUTION_OUTCOMES as readonly string[]).includes(state), false, `'${state}' must not be an outcome`);
  }
  const decision = decisionOf(decide(IMPLEMENT, 'MECHANICAL_FAILURE'));
  assert.deepEqual(Object.keys(decision).sort(), ['action', 'reason', 'role']);
});

// ── P5-J — unknown lifecycle/runtime fields fail closed ─────────────────────

test('P5-J unknown ephemeral policy fields fail closed rather than being ignored', () => {
  const attacks: Record<string, unknown>[] = [
    { retry_forever: true },
    { force_continue: true },
    { auto_switch_target: true },
    { next_model: 'stronger-model' },
    { worker_id: 'worker-7' },
    { resume_from_state: 'step-3' },
    { current_step: 2 },
    { queue: ['next-task'] },
    { limits: { correction_rounds: 99 } },
    { role: 'implement' },
    { terminal_state: { limit_exceeded: 'continue' } },
    { action: 'PASS' },
  ];
  for (const attack of attacks) {
    const result = decideNextAction({
      role_envelope: IMPLEMENT,
      outcome: 'SUCCESS',
      counters: NO_COUNTERS,
      ...attack,
    });
    assert.equal(result.ok, false, `attack ${JSON.stringify(attack)} must fail closed`);
    assert.deepEqual(codesOf(result), ['INVALID_TASK_CONTRACT']);
    assert.deepEqual(
      result.ok ? [] : result.errors.map((e) => e.path),
      Object.keys(attack).map((key) => key),
    );
  }
});

test('P5-J a caller cannot supply a replacement limits channel', () => {
  const result = decideNextAction({
    role_envelope: IMPLEMENT,
    outcome: 'SEMANTIC_AMBIGUITY',
    counters: NO_COUNTERS,
    limits: { semantic_escalations: 0 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.errors[0]?.path, 'limits');
});

test('P5-J malformed counters fail closed', () => {
  const malformed: unknown[] = [
    undefined,
    null,
    {},
    { clean_retries_used: 0, correction_rounds_used: 0 },
    { ...NO_COUNTERS, clean_retries_used: -1 },
    { ...NO_COUNTERS, clean_retries_used: 1.5 },
    { ...NO_COUNTERS, semantic_escalations_used: '1' },
    { ...NO_COUNTERS, correction_rounds_used: Number.NaN },
    { ...NO_COUNTERS, worker_id: 'worker-3' },
  ];
  for (const counters of malformed) {
    const result = decideNextAction({ role_envelope: IMPLEMENT, outcome: 'SUCCESS', counters });
    assert.equal(result.ok, false, `counters ${JSON.stringify(counters)} must fail closed`);
    assert.deepEqual(codesOf(result), ['INVALID_TASK_CONTRACT']);
  }
});

test('P5-J a missing or unknown outcome fails closed', () => {
  assert.deepEqual(codesOf(decide(IMPLEMENT, undefined)), ['INVALID_TASK_CONTRACT']);
  assert.deepEqual(codesOf(decide(IMPLEMENT, 'PARTIAL_SUCCESS')), ['INVALID_TASK_CONTRACT']);
  assert.deepEqual(codesOf(decide(IMPLEMENT, 'BLOCKED')), ['INVALID_TASK_CONTRACT']);
});

test('P5-J a non-canonical resume_role fails closed', () => {
  const result = decide(ADJUDICATE, 'ADJUDICATION_RESOLVED', NO_COUNTERS, 'architect' as Role);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.errors[0]?.path, 'resume_role');
});

test('P5-J a missing or malformed role envelope fails closed', () => {
  const noEnvelope = decideNextAction({ outcome: 'SUCCESS', counters: NO_COUNTERS });
  assert.equal(noEnvelope.ok, false);
  assert.equal(noEnvelope.ok ? undefined : noEnvelope.errors[0]?.path, 'role_envelope');

  const noRole = decideNextAction({
    role_envelope: { limits: {}, terminal_state: IMPLEMENT.terminal_state },
    outcome: 'SUCCESS',
    counters: NO_COUNTERS,
  });
  assert.equal(noRole.ok, false);

  const noLimits = decideNextAction({
    role_envelope: { role: 'implement', terminal_state: IMPLEMENT.terminal_state },
    outcome: 'SUCCESS',
    counters: NO_COUNTERS,
  });
  assert.equal(noLimits.ok, false);
  assert.equal(noLimits.ok ? undefined : noLimits.errors[0]?.path, 'role_envelope.limits');

  const badLimit = decideNextAction({
    role_envelope: { role: 'implement', limits: { correction_rounds: -1 }, terminal_state: IMPLEMENT.terminal_state },
    outcome: 'SUCCESS',
    counters: NO_COUNTERS,
  });
  assert.equal(badLimit.ok, false);
  assert.equal(badLimit.ok ? undefined : badLimit.errors[0]?.path, 'role_envelope.limits.correction_rounds');

  const unknownLimit = decideNextAction({
    role_envelope: { role: 'implement', limits: { retries: 3 }, terminal_state: IMPLEMENT.terminal_state },
    outcome: 'SUCCESS',
    counters: NO_COUNTERS,
  });
  assert.equal(unknownLimit.ok, false);
  assert.equal(unknownLimit.ok ? undefined : unknownLimit.errors[0]?.path, 'role_envelope.limits.retries');

  const notAnObject = decideNextAction('decide');
  assert.equal(notAnObject.ok, false);
});

test('P5-J an artifact carrying a non-canonical terminal policy fails closed', () => {
  const result = decideNextAction({
    role_envelope: {
      role: 'implement',
      limits: LIMITS,
      terminal_state: { success: 'acceptance_verified', ambiguity: 'escalate', limit_exceeded: 'continue_anyway' },
    },
    outcome: 'SUCCESS',
    counters: NO_COUNTERS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.errors[0]?.path, 'role_envelope.terminal_state.limit_exceeded');
});

// ── Provenance: the policy cannot become a second authority channel ─────────

test('the policy reads role and limits from the resolved artifact only', () => {
  // Same explicit evidence, two artifacts with different declared limits: the artifact decides.
  const tight = IMPLEMENT;
  const loose = envelopeFor(task({ limits: { correction_rounds: 2, semantic_escalations: 2 } }));
  const counters: EscalationCounters = { ...NO_COUNTERS, semantic_escalations_used: 1 };
  assert.equal(actionOf(decide(tight, 'SEMANTIC_AMBIGUITY', counters)), 'HUMAN_DECISION_REQUIRED');
  assert.equal(actionOf(decide(loose, 'SEMANTIC_AMBIGUITY', counters)), 'ADJUDICATE');
});

test('the policy never reports the target, model, or role it did not receive', () => {
  const decision = decisionOf(decide(REVIEW, 'MECHANICAL_FAILURE'));
  assert.equal(decision.role, 'review', 'no role substitution');
  const envelopeText = JSON.stringify(decision);
  assert.equal(envelopeText.includes('gpt-5.6-sol'), false, 'no model appears in a decision');
  assert.equal(envelopeText.includes('subagents'), false, 'no target appears in a decision');
});

test('every outcome maps to a bounded decision and no outcome maps to an execution', () => {
  for (const outcome of EXECUTION_OUTCOMES) {
    const envelope = outcome.startsWith('ADJUDICATION_') ? ADJUDICATE : IMPLEMENT;
    const result = decide(envelope, outcome, NO_COUNTERS, 'implement');
    assert.ok(result.ok, `outcome=${outcome} must be decidable`);
    assert.ok(
      (NEXT_ACTIONS as readonly string[]).includes(result.decision.action),
      `outcome=${outcome} produced a non-vocabulary action`,
    );
    assert.equal(typeof result.decision.reason, 'string');
    assert.ok(result.decision.reason.length > 0, 'the reason must be deterministic prose, not empty');
  }
});
