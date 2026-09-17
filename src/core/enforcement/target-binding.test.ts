import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAttestationVerifier } from '../attestation/attestation.ts';
import { createAuthorityBinder } from '../authority/binder.ts';
import type { CharterError } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import { ENFORCEMENT_CONSTRAINTS, type ExecutionTargetName, type TaskContract } from '../contracts/task-contract.ts';
import { resolveExecutionContract, type ResolverEnv } from '../resolver/resolve.ts';
import { ASSERTION_BINDER, CORRECTION_BINDER, POSITIVE_CONTRACTS } from '../validation/fixtures.ts';
import { validateTaskContract } from '../validation/validate.ts';
import {
  ENFORCEMENT_TRUTHS,
  TARGET_CAPABILITY_KEYS,
  bindExecutionTarget,
  evaluateEnforcement,
  type EnforcementTruth,
  type EnforcementTruthTable,
  type ExecutionTargetCapabilities,
  type CapabilityClaim,
  type TargetBinding,
  type TargetBindingResult,
} from './target-binding.ts';

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

/**
 * Canonical capability fixtures (Phase 3 charter §3). Environment input for these tests only: the
 * runtime snapshot is whatever the execution environment supplies, never a fact Charter stores.
 */
const PARENT_SNAPSHOT: CapabilityClaim = {
  name: 'parent',
  capabilities: {
    model_selection: true,
    fresh_session: false,
    tool_ceiling: false,
    file_scope_enforcement: false,
    independent_review: false,
  },
};

const SUBAGENTS_SNAPSHOT: CapabilityClaim = {
  name: 'subagents',
  capabilities: {
    model_selection: true,
    fresh_session: true,
    tool_ceiling: true,
    file_scope_enforcement: false,
    independent_review: true,
  },
};

function fixtureContract(name: string): TaskContract {
  const fixture = POSITIVE_CONTRACTS.find((p) => p.name === name);
  assert.ok(fixture, `missing positive fixture '${name}'`);
  return structuredClone(fixture.contract);
}

function resolved(contract: TaskContract): ExecutionContract {
  const result = resolveExecutionContract(contract, ENV);
  if (!result.ok) assert.fail(`expected resolution to succeed, got ${JSON.stringify(result.errors)}`);
  return result.contract;
}

function bind(contract: ExecutionContract, snapshot: unknown): TargetBindingResult {
  return bindExecutionTarget({ execution_contract: contract, capability_claim: snapshot });
}

/**
 * Attested capability input for a target (T2): the submitted candidate, plus the boundary that
 * vouches for what this environment issued (W1_ATTESTATION_SELF_PROMOTION). The source identity is
 * what makes the strong path distinguishable from a raw claim — and the boundary is what makes the
 * submitted envelope trusted at all.
 */
function attested(
  capabilities: ExecutionTargetCapabilities,
  target: ExecutionTargetName,
): { capability_attestation: unknown; capability_attestation_verifier: ReturnType<typeof createAttestationVerifier> } {
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

/** Bind on the strong path. Only capability a boundary vouched for can ground `ENFORCED` (T2). */
function bindAttested(contract: ExecutionContract, capabilities: ExecutionTargetCapabilities): TargetBindingResult {
  return bindExecutionTarget({
    execution_contract: contract,
    ...attested(capabilities, contract.execution_target),
  });
}

function boundAttested(contract: ExecutionContract, capabilities: ExecutionTargetCapabilities): TargetBinding {
  const result = bindAttested(contract, capabilities);
  if (!result.ok) assert.fail(`expected attested binding to succeed, got ${JSON.stringify(result.errors)}`);
  return result.binding;
}

/** Attach a canonical tool policy exactly as resolution carries it: verbatim on the contract (T3). */
function carryingTools(contract: ExecutionContract, allowed_tools: string[]): ExecutionContract {
  return { ...contract, execution_policy: { allowed_tools } } as ExecutionContract;
}

function bound(contract: ExecutionContract, snapshot: unknown): TargetBinding {
  const result = bind(contract, snapshot);
  if (!result.ok) assert.fail(`expected binding to succeed, got ${JSON.stringify(result.errors)}`);
  return result.binding;
}

/**
 * Attach requirements to a resolved contract exactly as resolution carries them: verbatim on the
 * contract. Binding has no other requirement channel, so this is the only way to exercise one.
 */
function carrying(contract: ExecutionContract, requirements: unknown): ExecutionContract {
  return { ...contract, requirements } as ExecutionContract;
}

function errors(result: TargetBindingResult): CharterError[] {
  return result.ok ? [] : result.errors;
}

function codes(result: TargetBindingResult): string[] {
  return [...new Set(errors(result).map((e) => e.code))];
}

function paths(result: TargetBindingResult): string[] {
  return errors(result).map((e) => e.path ?? '');
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The parent-target fixture carrying a fresh-session review requirement. */
function freshSessionReview(independence: 'none' | 'independent'): ExecutionContract {
  const contract = fixtureContract('critical correction');
  contract.acceptance.review = { required: true, independence, executor: 'fresh_session' };
  return resolved(contract);
}

/** The subagents-target fixture: required, independent, fresh-session review. */
function subagentsReviewFixture(): ExecutionContract {
  const contract = resolved(fixtureContract('subagents implement with independent review'));
  assert.equal(contract.execution_target, 'subagents');
  return contract;
}

const ALL_CAPABLE: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: true,
  independent_review: true,
};

// ── E10 — enforcement truthfulness ──────────────────────────────────────────

test('E10-A — parent: attested model_selection is ENFORCED, a claim never is', () => {
  const contract = resolved(fixtureContract('critical correction'));
  const binding = boundAttested(contract, { ...PARENT_SNAPSHOT.capabilities });
  assert.equal(binding.target, 'parent');
  assert.equal(binding.enforcement.model_selection, 'ENFORCED');
  assert.equal(binding.capability_evidence.class, 'attested');
  // The same claim saying the same thing is not evidence: it is recorded as a claim and it can never
  // report ENFORCED (T2).
  const claimed = bound(contract, PARENT_SNAPSHOT);
  assert.equal(claimed.enforcement.model_selection, 'UNSUPPORTED');
  assert.equal(claimed.capability_evidence.class, 'unattested_claim');
});

test('E10-B — parent: allowed_tools needs a policy, and is never ENFORCED on a claim', () => {
  const contract = resolved(fixtureContract('critical correction'));
  // No tool policy exists in this contract, so there is nothing to enforce and nothing to instruct.
  assert.equal(bound(contract, PARENT_SNAPSHOT).enforcement.allowed_tools, 'NOT_APPLICABLE');
  // With a canonical tool policy and an attested capability that is FALSE, the ceiling is
  // instruction-level — and never ENFORCED.
  const withPolicy = carryingTools(contract, ['read', 'edit']);
  const truth = boundAttested(withPolicy, { ...PARENT_SNAPSHOT.capabilities }).enforcement.allowed_tools;
  assert.equal(truth, 'INSTRUCTED');
  assert.notEqual(truth, 'ENFORCED');
});

test('E10-C — subagents: an attested tool ceiling plus a declared tool policy is ENFORCED', () => {
  const contract = carryingTools(resolved(fixtureContract('critical correction')), ['read', 'edit']);
  assert.equal(boundAttested(contract, { ...SUBAGENTS_SNAPSHOT.capabilities }).enforcement.allowed_tools, 'ENFORCED');
  // Capability alone is not enough: the identical attestation with no tool policy enforces nothing.
  assert.equal(
    boundAttested(resolved(fixtureContract('critical correction')), { ...SUBAGENTS_SNAPSHOT.capabilities })
      .enforcement.allowed_tools,
    'NOT_APPLICABLE',
  );
});

test('E10-D — a file policy without the primitive is INSTRUCTED; sections-only scope is not a policy', () => {
  const cases: [string, ExecutionContract, ExecutionTargetCapabilities][] = [
    ['parent fixture', resolved(fixtureContract('critical correction')), { ...PARENT_SNAPSHOT.capabilities }],
    ['subagents fixture', subagentsReviewFixture(), { ...SUBAGENTS_SNAPSHOT.capabilities }],
  ];
  for (const [label, contract, capabilities] of cases) {
    // Both fixtures report file_scope_enforcement=false, so neither may claim a file sandbox.
    assert.equal(capabilities.file_scope_enforcement, false, label);
    assert.equal(boundAttested(contract, capabilities).enforcement.allowed_files, 'INSTRUCTED', label);
  }
  // Positive control: exact non-empty `scope.files` plus an attested primitive IS ENFORCED (T3).
  const fileCapable: ExecutionTargetCapabilities = {
    model_selection: false,
    fresh_session: false,
    tool_ceiling: false,
    file_scope_enforcement: true,
    independent_review: false,
  };
  const contract = resolved(fixtureContract('critical correction'));
  assert.equal(boundAttested(contract, fileCapable).enforcement.allowed_files, 'ENFORCED');
  // ...and sections-only scope is NOT a file policy: the same attested primitive enforces nothing.
  const sectionsOnly = { ...contract, scope: { sections: ['P7'] } } as ExecutionContract;
  assert.equal(boundAttested(sectionsOnly, fileCapable).enforcement.allowed_files, 'NOT_APPLICABLE');
});

test('E10-E — archaeology_off and release_forbidden are INSTRUCTED: no hard primitive is invented', () => {
  const cases: [string, CapabilityClaim][] = [
    ['parent fixture', PARENT_SNAPSHOT],
    ['subagents fixture', SUBAGENTS_SNAPSHOT],
    // Even a maximally capable target cannot make them ENFORCED: v0.1 defines no such primitive.
    ['maximally capable target', { name: 'parent', capabilities: ALL_CAPABLE }],
  ];
  for (const [label, snapshot] of cases) {
    const truth = evaluateEnforcement(snapshot.capabilities, { allowed_tools: ['tool-a'], files: ['src/a.ts'] });
    assert.equal(truth.archaeology_off, 'INSTRUCTED', label);
    assert.equal(truth.release_forbidden, 'INSTRUCTED', label);
  }
});

test('E10-F — model_selection=false reports UNSUPPORTED, not INSTRUCTED', () => {
  const snapshot = { ...PARENT_SNAPSHOT, capabilities: { ...PARENT_SNAPSHOT.capabilities, model_selection: false } };
  const binding = bound(resolved(fixtureContract('critical correction')), snapshot);
  assert.equal(binding.enforcement.model_selection, 'UNSUPPORTED');
});

test('E10 — ENFORCED tracks exactly the attested capability and the applicable policy, across every combination', () => {
  // Exhaustive over all 32 capability states: the fabrication this suite exists to prevent is
  // reporting ENFORCED where the substrate has no primitive, or where the contract declares no
  // policy for the dimension (T2, T3).
  const policy = { allowed_tools: ['tool-a'], files: ['src/a.ts'] };
  for (let mask = 0; mask < 2 ** TARGET_CAPABILITY_KEYS.length; mask++) {
    const capabilities = Object.fromEntries(
      TARGET_CAPABILITY_KEYS.map((key, index) => [key, (mask & (1 << index)) !== 0]),
    ) as ExecutionTargetCapabilities;
    const truth = evaluateEnforcement(capabilities, policy);
    const label = JSON.stringify(capabilities);
    assert.deepEqual(Object.keys(truth).sort(), [...ENFORCEMENT_CONSTRAINTS].sort(), label);
    assert.equal(truth.model_selection, capabilities.model_selection ? 'ENFORCED' : 'UNSUPPORTED', label);
    assert.equal(truth.allowed_tools, capabilities.tool_ceiling ? 'ENFORCED' : 'INSTRUCTED', label);
    assert.equal(truth.allowed_files, capabilities.file_scope_enforcement ? 'ENFORCED' : 'INSTRUCTED', label);
    // No combination of capabilities can manufacture an archaeology or release primitive.
    assert.equal(truth.archaeology_off, 'INSTRUCTED', label);
    assert.equal(truth.release_forbidden, 'INSTRUCTED', label);
    for (const constraint of ENFORCEMENT_CONSTRAINTS) {
      assert.ok(ENFORCEMENT_TRUTHS.includes(truth[constraint]), `${label} ${constraint}`);
    }
    // ENFORCED is reported only for the three axes that have a real primitive behind them.
    const enforced = ENFORCEMENT_CONSTRAINTS.filter((c) => truth[c] === 'ENFORCED');
    for (const constraint of enforced) {
      assert.ok(['model_selection', 'allowed_tools', 'allowed_files'].includes(constraint), label);
    }

    // Without an applicable policy, neither policy-bearing dimension can be ENFORCED at all, however
    // capable the target is: a ceiling nobody declared is a ceiling nothing enforces (T3).
    const policyless = evaluateEnforcement(capabilities, {});
    assert.equal(policyless.allowed_tools, 'NOT_APPLICABLE', label);
    assert.equal(policyless.allowed_files, 'NOT_APPLICABLE', label);
  }

  // Nothing attested means nothing enforced, even where the contract declares a policy (T2).
  const unattested = evaluateEnforcement(undefined, policy);
  assert.equal(unattested.model_selection, 'UNSUPPORTED');
  assert.equal(unattested.allowed_tools, 'INSTRUCTED');
  assert.equal(unattested.allowed_files, 'INSTRUCTED');
});

// ── §24 — required hard enforcement ─────────────────────────────────────────

test('E10-G — a required tool ceiling on the parent fixture fails closed', () => {
  const contract = carrying(resolved(fixtureContract('critical correction')), {
    enforcement: { allowed_tools: 'required' },
  });
  const result = bind(contract, PARENT_SNAPSHOT);
  assert.deepEqual(codes(result), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  assert.deepEqual(paths(result), ['execution_contract.requirements.enforcement.allowed_tools']);
  const [error] = errors(result);
  assert.ok(error);
  // The truth is reported exactly: no policy exists, so nothing is enforced and nothing is instructed.
  assert.match(error.message, /NOT_APPLICABLE/);
  // The missing capability or policy is reported, not invented.
  assert.match(error.message, /does not invent the missing capability or policy/);
});

test('E10-H — the same requirement binds with an attested tool ceiling and a declared tool policy', () => {
  const required = carrying(subagentsReviewFixture(), { enforcement: { allowed_tools: 'required' } });
  const binding = boundAttested(carryingTools(required, ['read', 'edit']), { ...ALL_CAPABLE });
  assert.equal(binding.enforcement.allowed_tools, 'ENFORCED');
  // Without the policy the identical requirement fails closed: capability alone is insufficient (T3).
  assert.deepEqual(codes(bindAttested(required, { ...ALL_CAPABLE })), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

test('E10-I — a required file scope on the canonical subagents fixture fails closed', () => {
  const result = bindAttested(
    carrying(subagentsReviewFixture(), { enforcement: { allowed_files: 'required' } }),
    // Independence is attested, but the file-scope primitive is not: the two axes stay distinct.
    { ...ALL_CAPABLE, file_scope_enforcement: false },
  );
  assert.deepEqual(codes(result), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  assert.deepEqual(paths(result), ['execution_contract.requirements.enforcement.allowed_files']);
});

test('E10 — a required model_selection binds only where attested model selection is real', () => {
  const contract = carrying(resolved(fixtureContract('critical correction')), {
    enforcement: { model_selection: 'required' },
  });
  assert.equal(boundAttested(contract, { ...PARENT_SNAPSHOT.capabilities }).enforcement.model_selection, 'ENFORCED');
  // An attested capability that says false refuses; a CLAIM that says true cannot satisfy it (T2).
  const withoutSelection = { ...PARENT_SNAPSHOT.capabilities, model_selection: false };
  assert.deepEqual(codes(bindAttested(contract, withoutSelection)), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  assert.deepEqual(codes(bind(contract, PARENT_SNAPSHOT)), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

test('E10 — archaeology_off and release_forbidden can never satisfy a hard requirement', () => {
  const cases: [ExecutionContract, ExecutionTargetCapabilities][] = [
    [resolved(fixtureContract('critical correction')), { ...PARENT_SNAPSHOT.capabilities }],
    [subagentsReviewFixture(), { ...ALL_CAPABLE }],
  ];
  for (const [contract, capabilities] of cases) {
    for (const constraint of ['archaeology_off', 'release_forbidden'] as const) {
      const result = bindAttested(carrying(contract, { enforcement: { [constraint]: 'required' } }), capabilities);
      assert.deepEqual(codes(result), ['UNSUPPORTED_BY_EXECUTION_TARGET'], `${contract.task_id} ${constraint}`);
    }
  }
});

// ── §26.1 — review capability truth ─────────────────────────────────────────

test('§26.1 — parent cannot satisfy a fresh-session review requirement', () => {
  for (const independence of ['none', 'independent'] as const) {
    const contract = freshSessionReview(independence);
    assert.equal(contract.execution_target, 'parent');
    assert.equal(contract.acceptance.review?.executor, 'fresh_session');
    const result = bind(contract, PARENT_SNAPSHOT);
    assert.deepEqual(codes(result), ['UNSUPPORTED_BY_EXECUTION_TARGET'], independence);
    assert.deepEqual(paths(result)[0], 'acceptance.review.executor', independence);
  }
});

test('§26.1 — parent cannot satisfy an independent review requirement', () => {
  const result = bind(freshSessionReview('independent'), PARENT_SNAPSHOT);
  assert.deepEqual(codes(result), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  // Every unmet capability of the review is named, not just the first one found.
  assert.deepEqual(paths(result), ['acceptance.review.executor', 'acceptance.review.independence']);
  // Both missing capabilities are named in the independence refusal itself, and a claim is reported
  // as UNATTESTED rather than as false: an untrusted claim is not a capability fact (T2).
  assert.match(
    errors(result).map((error) => error.message).join('\n'),
    /fresh_session=unattested, independent_review=unattested/,
  );
});

test('§26.1 — the subagents fixture truthfully binds independent fresh-session review', () => {
  const contract = subagentsReviewFixture();
  assert.equal(contract.acceptance.review?.independence, 'independent');
  assert.equal(contract.acceptance.review?.executor, 'fresh_session');
  // Independence demands attested capability: a claim that says "independent_review: true" satisfies
  // nothing, and the binding refuses instead of reporting unprovable independence as a fact (T2).
  assert.deepEqual(codes(bind(contract, SUBAGENTS_SNAPSHOT)), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  const binding = boundAttested(carryingTools(contract, ['read']), { ...ALL_CAPABLE });
  assert.equal(binding.enforcement.allowed_tools, 'ENFORCED');
  assert.equal(binding.target, 'subagents');
});

test('§26.1 — independence is never reported when the target lacks either capability', () => {
  const contract = subagentsReviewFixture();
  const freshOnly = { name: 'subagents', capabilities: { ...SUBAGENTS_SNAPSHOT.capabilities, independent_review: false } };
  const reviewOnly = { name: 'subagents', capabilities: { ...SUBAGENTS_SNAPSHOT.capabilities, fresh_session: false } };
  for (const snapshot of [freshOnly, reviewOnly]) {
    assert.deepEqual(codes(bind(contract, snapshot)), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  }
  // A review that is not required is not a review requirement: nothing is claimed about independence.
  const optional = fixtureContract('adjudicate evidence-backed architecture conflict');
  optional.acceptance.review = { required: false, independence: 'independent', executor: 'fresh_session' };
  assert.equal(bound(resolved(optional), PARENT_SNAPSHOT).target, 'parent');
});

// ── §25 — fail-closed capability snapshots ──────────────────────────────────

test('§25 — an unusable capability snapshot never produces a binding', () => {
  const contract = resolved(fixtureContract('critical correction'));
  const missingAxis: Record<string, unknown> = { ...PARENT_SNAPSHOT.capabilities };
  delete missingAxis.tool_ceiling;
  const cases: [string, unknown, string[]][] = [
    ['unknown snapshot target', { name: 'intercom', capabilities: PARENT_SNAPSHOT.capabilities }, ['INVALID_TASK_CONTRACT']],
    ['snapshot/contract target mismatch', SUBAGENTS_SNAPSHOT, ['CONTRACT_CONTRADICTION']],
    [
      'unknown capability key',
      { ...PARENT_SNAPSHOT, capabilities: { ...PARENT_SNAPSHOT.capabilities, tool_ceilings: true } },
      ['INVALID_TASK_CONTRACT'],
    ],
    ['unknown snapshot field', { ...PARENT_SNAPSHOT, auto_discover: true }, ['INVALID_TASK_CONTRACT']],
    ['missing capability', { name: 'parent', capabilities: missingAxis }, ['INVALID_TASK_CONTRACT']],
    [
      'non-boolean capability',
      { ...PARENT_SNAPSHOT, capabilities: { ...PARENT_SNAPSHOT.capabilities, tool_ceiling: 'yes' } },
      ['INVALID_TASK_CONTRACT'],
    ],
    ['missing capabilities object', { name: 'parent' }, ['INVALID_TASK_CONTRACT']],
    ['snapshot is not an object', 'parent', ['INVALID_TASK_CONTRACT']],
    ['snapshot is absent', undefined, ['INVALID_TASK_CONTRACT']],
  ];
  for (const [label, snapshot, expected] of cases) {
    const result = bind(contract, snapshot);
    assert.deepEqual(codes(result), expected, label);
    // A refused binding carries no truth table at all: no partial enforcement claim leaks out.
    assert.equal('binding' in result, false, label);
  }
});

test('§25 — the snapshot must describe exactly the target the contract selected', () => {
  const result = bind(resolved(fixtureContract('critical correction')), SUBAGENTS_SNAPSHOT);
  assert.deepEqual(codes(result), ['CONTRACT_CONTRADICTION']);
  assert.deepEqual(paths(result), ['capability_claim.name']);
  const [error] = errors(result);
  assert.ok(error);
  assert.match(error.message, /execution_target=parent/);
  // The reverse direction fails identically rather than substituting a target.
  assert.deepEqual(codes(bind(subagentsReviewFixture(), PARENT_SNAPSHOT)), ['CONTRACT_CONTRADICTION']);
});

test('§25 — unknown binding input fields fail closed', () => {
  const result = bindExecutionTarget({
    execution_contract: resolved(fixtureContract('critical correction')),
    capability_claim: PARENT_SNAPSHOT,
    registry: {},
  } as unknown as Parameters<typeof bindExecutionTarget>[0]);
  assert.deepEqual(codes(result), ['INVALID_TASK_CONTRACT']);
  assert.deepEqual(paths(result), ['registry']);
});

test('§25 — a contract whose execution target is not canonical is refused before any truth', () => {
  const shapes: unknown[] = [{ execution_target: 'cluster' }, { execution_target: 7 }, {}, null, 'parent', [], undefined];
  for (const execution_contract of shapes) {
    const label = JSON.stringify(execution_contract) ?? 'undefined';
    const result = bindExecutionTarget({
      execution_contract,
      capability_claim: PARENT_SNAPSHOT,
    } as unknown as Parameters<typeof bindExecutionTarget>[0]);
    assert.deepEqual(codes(result), ['INVALID_TASK_CONTRACT'], label);
    // A refused binding carries no truth table and no contract: no partial claim leaks out.
    assert.equal('binding' in result, false, label);
  }
});

test('§25 — the binding validates the environment, not the Phase 2 artifact it is given', () => {
  // Re-validating a resolved contract is Phase 1/2 work and is deliberately not repeated here. What
  // Phase 3 must never do is guess the target, so identity is the one contract field it checks.
  const result = bindExecutionTarget({
    execution_contract: { execution_target: 'parent' } as unknown as ExecutionContract,
    capability_claim: PARENT_SNAPSHOT,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // No scope was supplied, so there is no file policy: nothing is fabricated in either direction.
  assert.equal(result.binding.enforcement.allowed_files, 'NOT_APPLICABLE');
  assert.equal(result.binding.capability_evidence.class, 'unattested_claim');
  assert.deepEqual(Object.keys(result.binding.execution_contract), ['execution_target']);
});

// ── §24 — fail-closed requirements ──────────────────────────────────────────

test('§24 — unknown requirement names, values, and shapes fail closed', () => {
  const contract = resolved(fixtureContract('critical correction'));
  const cases: [string, unknown, string[]][] = [
    ['unknown constraint name', { enforcement: { tool_sandbox: 'required' } }, ['INVALID_TASK_CONTRACT']],
    ['unknown requirement value', { enforcement: { allowed_tools: 'preferred' } }, ['INVALID_TASK_CONTRACT']],
    ['non-string requirement value', { enforcement: { allowed_tools: true } }, ['INVALID_TASK_CONTRACT']],
    ['unknown top-level requirement', { policy: { mode: 'soft' } }, ['INVALID_TASK_CONTRACT']],
    ['enforcement is not an object', { enforcement: 'required' }, ['INVALID_TASK_CONTRACT']],
    ['requirements is not an object', 'required', ['INVALID_TASK_CONTRACT']],
    [
      'unknown enforcement field',
      { enforcement: { allowed_tools: 'required', soft_tools: 'required' } },
      ['INVALID_TASK_CONTRACT'],
    ],
  ];
  for (const [label, requirements, expected] of cases) {
    const result = bind(carrying(contract, requirements), PARENT_SNAPSHOT);
    assert.deepEqual(codes(result), expected, label);
    assert.equal('binding' in result, false, label);
  }
  // The admitted shapes still bind: no requirement, and an emptied enforcement block.
  assert.equal(bound(contract, PARENT_SNAPSHOT).target, 'parent');
  assert.equal(bound(carrying(contract, {}), PARENT_SNAPSHOT).target, 'parent');
  assert.equal(bound(carrying(contract, { enforcement: {} }), PARENT_SNAPSHOT).target, 'parent');
  // The one admitted value is honoured against real truth rather than softened.
  const satisfied = boundAttested(
    carrying(contract, { enforcement: { model_selection: 'required' } }),
    { ...PARENT_SNAPSHOT.capabilities },
  );
  assert.equal(satisfied.enforcement.model_selection, 'ENFORCED');
});

test('§24 — declared truth is a closed table, never a free-form report', () => {
  const truth = boundAttested(resolved(fixtureContract('critical correction')), {
    ...PARENT_SNAPSHOT.capabilities,
  }).enforcement;
  const values: EnforcementTruth[] = ENFORCEMENT_CONSTRAINTS.map((constraint) => truth[constraint]);
  // ENFORCED only for the attested model-selection primitive, NOT_APPLICABLE where this contract
  // declares no tool policy, INSTRUCTED where a file policy exists without the primitive (T3).
  assert.deepEqual(values, ['ENFORCED', 'NOT_APPLICABLE', 'INSTRUCTED', 'INSTRUCTED', 'INSTRUCTED']);
  assert.deepEqual(Object.keys(truth), [...ENFORCEMENT_CONSTRAINTS]);
});

// ── §37 — determinism and immutability ──────────────────────────────────────

test('§37 — equivalent inputs produce deep-equivalent bindings, without touching the inputs', () => {
  // Requirements sit inside the contract, so they are part of the binding input identity.
  const contract = deepFreeze(
    carryingTools(
      carrying(subagentsReviewFixture(), { enforcement: { allowed_tools: 'required' as const } }),
      ['read'],
    ),
  );
  const snapshot = deepFreeze(attested(ALL_CAPABLE, 'subagents'));
  const before = JSON.stringify({ contract, snapshot });

  const first = boundAttested(contract, { ...ALL_CAPABLE });
  const second = boundAttested(contract, { ...ALL_CAPABLE });
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  // The Phase 2 artifact is carried as a value: downstream mutation cannot reach the original.
  assert.notEqual(first.execution_contract, contract);
  assert.deepEqual(first.execution_contract, contract);
  assert.deepEqual(first.execution_contract.requirements, { enforcement: { allowed_tools: 'required' } });
  assert.equal(JSON.stringify({ contract, snapshot }), before);
});

test('§37 — refusals are deterministic and carry no truth table', () => {
  const contract = deepFreeze(
    carrying(resolved(fixtureContract('critical correction')), { enforcement: { allowed_tools: 'required' } }),
  );
  const first = bind(contract, PARENT_SNAPSHOT);
  const second = bind(contract, PARENT_SNAPSHOT);
  assert.deepEqual(first, second);
  assert.equal('binding' in first, false);
  assert.ok(errors(first).length > 0);
});

test('§37 — the resolved Phase 2 execution contract is unchanged and unextended by Phase 3', () => {
  const contract = resolved(fixtureContract('critical correction'));
  const before = structuredClone(contract);
  const binding = bound(contract, PARENT_SNAPSHOT);
  assert.deepEqual(contract, before);
  // Phase 3 truth lives beside the contract, never inside it (§35 shape is untouched).
  assert.deepEqual(Object.keys(binding).sort(), ['capability_evidence', 'enforcement', 'execution_contract', 'target']);
  assert.deepEqual(Object.keys(binding.execution_contract), Object.keys(before));
  for (const forbidden of ['enforcement', 'capabilities', 'resolved_by']) {
    assert.equal(Object.keys(binding.execution_contract).includes(forbidden), false, forbidden);
  }
});

// ── requirements.enforcement — the authorized additive TaskContract field ───

test('requirements.enforcement — accepted, preserved, and carried through resolution unchanged', () => {
  const base = fixtureContract('subagents implement with independent review');
  const withRequirements: TaskContract = {
    ...base,
    requirements: { enforcement: { allowed_tools: 'required', allowed_files: 'required' } },
  };
  const validated = validateTaskContract(withRequirements);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.errors));
  if (!validated.ok) return;
  // The field survives normalization: a validated contract never silently drops a requirement.
  assert.deepEqual(validated.contract.requirements, {
    enforcement: { allowed_tools: 'required', allowed_files: 'required' },
  });
  // Resolution carries the validated requirements through verbatim (C1): nothing is narrowed,
  // broadened, reinterpreted, or invented for the selected target.
  const carried = resolved(withRequirements);
  assert.deepEqual(carried.requirements, validated.contract.requirements);
  assert.deepEqual({ ...carried, requirements: undefined }, { ...resolved(base), requirements: undefined });
  // A contract without requirements keeps exactly its previous shape at both ends.
  const plain = validateTaskContract(base);
  assert.equal(plain.ok, true);
  if (!plain.ok) return;
  assert.equal('requirements' in plain.contract, false);
  assert.deepEqual(plain.contract, base);
  assert.equal('requirements' in resolved(base), false);
});

test('requirements.enforcement — an empty requirements object admits nothing', () => {
  const base = fixtureContract('critical correction');
  for (const requirements of [{}, { enforcement: {} }]) {
    const result = validateTaskContract({ ...base, requirements });
    assert.equal(result.ok, true, JSON.stringify(requirements));
    if (!result.ok) return;
    assert.deepEqual(result.contract.requirements, requirements);
  }
  const contract = resolved(base);
  assert.equal(bound(contract, PARENT_SNAPSHOT).target, 'parent');
  // An empty requirement is carried as an empty requirement: it admits nothing and refuses nothing.
  assert.equal(bound(carrying(contract, {}), PARENT_SNAPSHOT).target, 'parent');
  assert.equal(bound(carrying(contract, { enforcement: {} }), PARENT_SNAPSHOT).target, 'parent');
});

test('requirements.enforcement — unknown names, unknown values, and unknown fields fail closed', () => {
  const base = fixtureContract('critical correction');
  const cases: [string, unknown, string][] = [
    ['unknown constraint name', { enforcement: { tool_sandbox: 'required' } }, 'requirements.enforcement.tool_sandbox'],
    [
      'unknown requirement value',
      { enforcement: { allowed_tools: 'preferred' } },
      'requirements.enforcement.allowed_tools',
    ],
    ['non-string requirement value', { enforcement: { allowed_tools: true } }, 'requirements.enforcement.allowed_tools'],
    ['unknown requirement field', { policy: 'soft' }, 'requirements.policy'],
    ['enforcement is not an object', { enforcement: [] }, 'requirements.enforcement'],
    ['requirements is not an object', 'required', 'requirements'],
  ];
  for (const [label, requirements, path] of cases) {
    const result = validateTaskContract({ ...base, requirements });
    assert.equal(result.ok, false, label);
    if (result.ok) return;
    assert.deepEqual([...new Set(result.errors.map((e) => e.code))], ['INVALID_TASK_CONTRACT'], label);
    assert.deepEqual(result.errors.map((e) => e.path), [path], label);
  }
});

test('requirements.enforcement — the declaration is what the binding honours', () => {
  // End to end: the TaskContract declares the hard requirement, resolution carries it onto the
  // ExecutionContract, the environment supplies the snapshot, and the selected target decides.
  const unsatisfiable: TaskContract = {
    ...fixtureContract('critical correction'),
    requirements: { enforcement: { allowed_files: 'required' } },
  };
  const declared = validateTaskContract(unsatisfiable);
  assert.equal(declared.ok, true);
  if (!declared.ok) return;
  const parentContract = resolved(declared.contract);
  assert.deepEqual(parentContract.requirements, declared.contract.requirements);
  assert.deepEqual(codes(bind(parentContract, PARENT_SNAPSHOT)), ['UNSUPPORTED_BY_EXECUTION_TARGET']);

  const satisfiable: TaskContract = {
    ...fixtureContract('subagents implement with independent review'),
    requirements: { enforcement: { allowed_tools: 'required' } },
    // The declared tool policy is the ceiling: the requirement without it refuses (T3).
    execution_policy: { allowed_tools: ['read', 'edit'] },
  };
  const accepted = validateTaskContract(satisfiable);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const subagentsContract = resolved(accepted.contract);
  assert.deepEqual(subagentsContract.requirements, accepted.contract.requirements);
  const truth: EnforcementTruthTable = boundAttested(subagentsContract, { ...ALL_CAPABLE }).enforcement;
  // The declared tool policy plus the attested ceiling is what makes this ENFORCED at all (T3).
  assert.equal(truth.allowed_tools, 'ENFORCED');
  // ALL_CAPABLE attests the file-scope primitive, and this fixture declares exact `scope.files`.
  assert.equal(truth.allowed_files, 'ENFORCED');
});

// ── correction — one authoritative enforcement-requirement path (C1–C3) ─────

test('A — a declared hard tool requirement survives resolution and truthfully refuses the parent target', () => {
  const declared: TaskContract = {
    ...fixtureContract('critical correction'),
    execution_target: 'parent',
    requirements: { enforcement: { allowed_tools: 'required' } },
  };
  const contract = resolved(declared);
  // C1 — carry-through: the resolved artifact owns the validated requirement, unreinterpreted.
  assert.deepEqual(contract.requirements, { enforcement: { allowed_tools: 'required' } });
  const result = bind(contract, PARENT_SNAPSHOT);
  assert.deepEqual(codes(result), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  assert.deepEqual(paths(result), ['execution_contract.requirements.enforcement.allowed_tools']);
  // A contract that declares nothing carries nothing: no requirement is invented at either end.
  assert.equal('requirements' in resolved(fixtureContract('critical correction')), false);
});

test('B — the same hard tool requirement binds truthfully on the subagents target', () => {
  const declared: TaskContract = {
    ...fixtureContract('subagents implement with independent review'),
    requirements: { enforcement: { allowed_tools: 'required' } },
    execution_policy: { allowed_tools: ['read', 'edit'] },
  };
  const contract = resolved(declared);
  assert.deepEqual(contract.requirements, { enforcement: { allowed_tools: 'required' } });
  assert.deepEqual(contract.execution_policy, { allowed_tools: ['read', 'edit'] });
  const binding = boundAttested(contract, { ...ALL_CAPABLE });
  assert.equal(binding.enforcement.allowed_tools, 'ENFORCED');
  // Provenance survives the binding clone: downstream reads the same requirement the contract declared.
  assert.deepEqual(binding.execution_contract.requirements, contract.requirements);
});

test('C/D/E — the caller cannot drop, replace, weaken, or strengthen the contract requirement at binding', () => {
  const contract = carrying(resolved(fixtureContract('critical correction')), {
    enforcement: { allowed_tools: 'required' },
  });
  const attempts: [string, Record<string, unknown>][] = [
    ['drop', { requirements: undefined }],
    ['replace', { requirements: { enforcement: { model_selection: 'required' } } }],
    ['weaken', { requirements: {} }],
    ['strengthen', { requirements: { enforcement: { allowed_tools: 'required', allowed_files: 'required' } } }],
  ];
  for (const [label, extra] of attempts) {
    const result = bindExecutionTarget({
      execution_contract: contract,
      capability_claim: PARENT_SNAPSHOT,
      ...extra,
    } as unknown as Parameters<typeof bindExecutionTarget>[0]);
    assert.deepEqual(codes(result), ['INVALID_TASK_CONTRACT'], label);
    assert.deepEqual(paths(result), ['requirements'], label);
    assert.equal('binding' in result, false, label);
  }
  // The second channel is refused, and the contract's own requirement still decides the outcome:
  // the target that cannot enforce it refuses no matter what any attempt tried to supply.
  assert.deepEqual(codes(bind(contract, PARENT_SNAPSHOT)), ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

test('F — requirements are part of the binding input identity: same contract and snapshot, same result', () => {
  const contract = deepFreeze(
    carrying(resolved(fixtureContract('critical correction')), { enforcement: { allowed_tools: 'required' } }),
  );
  const snapshot = deepFreeze(structuredClone(PARENT_SNAPSHOT));
  const before = JSON.stringify({ contract, snapshot });
  const first = bind(contract, snapshot);
  const second = bind(contract, snapshot);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ contract, snapshot }), before);
  assert.deepEqual(first, {
    ok: false,
    errors: [
      {
        code: 'UNSUPPORTED_BY_EXECUTION_TARGET',
        path: 'execution_contract.requirements.enforcement.allowed_tools',
        message:
          "execution_target=parent reports NOT_APPLICABLE for 'allowed_tools'; the contract requires hard enforcement and Charter does not invent the missing capability or policy",
      },
    ],
  });
  // Different requirements are a different contract identity with a different, honest outcome — on
  // the attested path, where model selection can actually be hard-enforced (T2).
  const other = carrying({ ...contract }, { enforcement: { model_selection: 'required' } });
  assert.equal(bindAttested(other, { ...PARENT_SNAPSHOT.capabilities }).ok, true);
});

// ── Phase boundary ──────────────────────────────────────────────────────────

test('Phase 3 surface — a binding is truth, not a lifecycle handle', () => {
  const binding = bound(resolved(fixtureContract('critical correction')), PARENT_SNAPSHOT);
  for (const [key, value] of Object.entries(binding)) {
    assert.equal(typeof value === 'function', false, `${key} must not be callable`);
    assert.equal(value instanceof Promise, false, `${key} must not be async`);
  }
  const fields = Object.keys(binding);
  for (const forbidden of [
    'session',
    'worker',
    'process',
    'lock',
    'lease',
    'retry',
    'resume',
    'worktree',
    'registry',
    'handle',
    'state',
  ]) {
    assert.equal(fields.includes(forbidden), false, `lifecycle field '${forbidden}' leaked into a binding`);
  }
});
