import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../authority/binder.ts';
import type { CharterError } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  type ExecutionTargetName,
  type TaskContract,
} from '../contracts/task-contract.ts';
import {
  bindExecutionTarget,
  type EnforcementTruth,
  type ExecutionTargetCapabilities,
  type TargetBinding,
  type TargetBindingResult,
} from '../enforcement/target-binding.ts';
import { resolveExecutionContract, type ResolverEnv } from '../resolver/resolve.ts';
import { ASSERTION_BINDER, CORRECTION_BINDER, POSITIVE_CONTRACTS } from '../validation/fixtures.ts';
import {
  ENFORCEMENT_WORDING,
  compileRoleEnvelope,
  renderRoleEnvelope,
  type RoleEnvelope,
  type RoleEnvelopeResult,
} from './role-envelope.ts';

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

const ALL_TRUE: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: true,
  independent_review: true,
};

const ALL_FALSE: ExecutionTargetCapabilities = {
  model_selection: false,
  fresh_session: false,
  tool_ceiling: false,
  file_scope_enforcement: false,
  independent_review: false,
};

const MIXED: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: false,
  tool_ceiling: false,
  file_scope_enforcement: true,
  independent_review: false,
};

/** Every field a compiled envelope may carry. An invented field is a governance-bearing surprise. */
const ENVELOPE_FIELDS = [
  'acceptance',
  'assertion_bindings',
  'authority',
  'capability_evidence',
  'correction_targets',
  'enforcement_truth',
  'execution_target',
  'jurisdiction',
  'limits',
  'model',
  'model_availability',
  'non_goals',
  'objective',
  'operating_rules',
  'permissions',
  'prohibitions',
  'role',
  'scope',
  'stop_conditions',
  'task_id',
  'terminal_state',
  'verification',
  'version',
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function fixtureContract(name: string): TaskContract {
  const found = POSITIVE_CONTRACTS.find((entry) => entry.name === name);
  assert.ok(found, `fixture '${name}' must exist`);
  return found.contract;
}

function resolved(contract: TaskContract): ExecutionContract {
  const result = resolveExecutionContract(contract, ENV);
  assert.equal(result.ok, true, `fixture must resolve: ${JSON.stringify(result)}`);
  return (result as { ok: true; contract: ExecutionContract }).contract;
}

/**
 * Bind on the STRONG path: attested capability traceable to an explicit adapter identity. A raw
 * claim cannot satisfy a hard capability requirement (T2), so envelope truth is evidenced here.
 */
function bindToTarget(contract: ExecutionContract, capabilities: ExecutionTargetCapabilities): TargetBinding {
  const result: TargetBindingResult = bindExecutionTarget({
    execution_contract: contract,
    capability_attestation: {
      source_kind: 'execution_adapter',
      source: 'pi-target-fixture',
      source_version: '0.1.0',
      payload: { target: contract.execution_target as ExecutionTargetName, capabilities },
    },
  });
  assert.equal(result.ok, true, `contract must bind: ${JSON.stringify(result)}`);
  return (result as { ok: true; binding: TargetBinding }).binding;
}

/** The same binding on the low-level CLAIM path: nothing is attested, so nothing is ENFORCED (T2). */
function bindToTargetFromClaim(contract: ExecutionContract, capabilities: ExecutionTargetCapabilities): TargetBinding {
  const result: TargetBindingResult = bindExecutionTarget({
    execution_contract: contract,
    capability_claim: { name: contract.execution_target as ExecutionTargetName, capabilities },
  });
  assert.equal(result.ok, true, `claim-bound contract must bind: ${JSON.stringify(result)}`);
  return (result as { ok: true; binding: TargetBinding }).binding;
}

function compiled(binding: TargetBinding): RoleEnvelope {
  const result = compileRoleEnvelope({ target_binding: binding });
  assert.equal(result.ok, true, `envelope must compile: ${JSON.stringify(result)}`);
  return (result as { ok: true; envelope: RoleEnvelope }).envelope;
}

function envelopeFor(name: string, capabilities: ExecutionTargetCapabilities = ALL_TRUE): RoleEnvelope {
  return compiled(bindToTarget(resolved(fixtureContract(name)), capabilities));
}

function codes(result: RoleEnvelopeResult): string[] {
  return result.ok ? [] : result.errors.map((error: CharterError) => error.code);
}

function paths(result: RoleEnvelopeResult): string[] {
  return result.ok ? [] : result.errors.map((error: CharterError) => error.path ?? '');
}

/** The body lines of one rendered section, by its canonical heading. */
function section(text: string, heading: string): string[] {
  for (const block of text.trimEnd().split('\n\n')) {
    const [head, ...body] = block.split('\n');
    if (head === heading) return body;
  }
  assert.fail(`rendered envelope has no '${heading}' section`);
}

function containing(lines: readonly string[], expected: readonly string[]): void {
  for (const fragment of expected) {
    assert.ok(lines.some((line) => line.includes(fragment)), `expected a line containing '${fragment}'`);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// ── P4-A planner ────────────────────────────────────────────────────────────

test('P4-A — planner envelope: decomposition only, no write/release/architecture authority', () => {
  const envelope = envelopeFor('planner decomposition (no mutation)');
  assert.equal(envelope.role, 'planner');
  assert.equal(envelope.jurisdiction.implementation, 'none');
  assert.equal(envelope.jurisdiction.architecture, 'none');
  assert.equal(envelope.jurisdiction.product_semantics, 'none');
  assert.equal(envelope.jurisdiction.semantic_adjudication, 'none');
  assert.equal(envelope.jurisdiction.mutation.repository, 'none');
  assert.equal(envelope.permissions.code_write, false);

  const text = renderRoleEnvelope(envelope);
  containing(section(text, 'JURISDICTION'), [
    'implementation: none',
    'architecture: none',
    'product_semantics: none',
    'semantic_adjudication: none',
    'mutation.repository: none',
  ]);
  assert.deepEqual(section(text, 'PERMISSIONS'), [
    'code_write: false',
    'research: false',
    'external_write: false',
    'release: false',
  ]);
  for (const forbidden of [
    'implementation: bounded',
    'repository: write',
    'release: authorized',
    'external: write',
    'architecture: bounded',
  ]) {
    assert.equal(text.includes(forbidden), false, `planner text must not contain '${forbidden}'`);
  }

  for (const boundary of [
    'write, modify, or delete repository content',
    'authorize release or live mutation',
    'reopen or redesign product architecture',
    'invent product capability, roadmap, release thesis',
    'broaden the admitted scope or authority',
  ]) {
    assert.ok(
      envelope.prohibitions.some((rule) => rule.includes(boundary)),
      `planner envelope must state the boundary: '${boundary}'`,
    );
  }
  assert.ok(envelope.operating_rules.some((rule) => rule.includes('produce bounded child TaskContract candidates only')));
});

// ── P4-B implement ──────────────────────────────────────────────────────────

test('P4-B — implement envelope: bounded implementation, no product-semantic or architecture authority', () => {
  const envelope = envelopeFor('subagents implement with independent review');
  assert.equal(envelope.role, 'implement');
  assert.equal(envelope.jurisdiction.implementation, 'bounded');
  assert.equal(envelope.jurisdiction.architecture, 'none');
  assert.equal(envelope.jurisdiction.product_semantics, 'none');
  assert.equal(envelope.permissions.code_write, true);

  const text = renderRoleEnvelope(envelope);
  containing(section(text, 'JURISDICTION'), ['implementation: bounded', 'architecture: none', 'product_semantics: none']);
  for (const forbidden of ['architecture: bounded', 'product_semantics: bounded', 'architecture authority']) {
    assert.equal(text.includes(forbidden), false, `implement text must not contain '${forbidden}'`);
  }

  for (const boundary of [
    'reopen product semantics, architecture, or the specification',
    'expand the declared scope or authority',
    'refactor adjacent code',
    'implement future phases',
  ]) {
    assert.ok(
      envelope.prohibitions.some((rule) => rule.includes(boundary)),
      `implement envelope must state the boundary: '${boundary}'`,
    );
  }
  assert.ok(envelope.operating_rules.some((rule) => rule.includes('minimum sufficient patch')));
  assert.ok(
    envelope.operating_rules.some((rule) => rule.includes('release is not authorized')),
    'release=false must yield an explicit release prohibition',
  );
});

// ── P4-C review ─────────────────────────────────────────────────────────────

test('P4-C — review envelope: read-only, bounded findings, honest independence truth', () => {
  const envelope = envelopeFor('read-only review');
  assert.equal(envelope.role, 'review');
  assert.equal(envelope.jurisdiction.mutation.repository, 'none');
  assert.equal(envelope.jurisdiction.implementation, 'none');
  assert.equal(envelope.permissions.code_write, false);

  const text = renderRoleEnvelope(envelope);
  assert.equal(text.includes('mutation.repository: write'), false);
  containing(section(text, 'PERMISSIONS'), ['code_write: false', 'release: false']);
  for (const boundary of ['implement a fix', 'invent requirements', 'general architecture audit', 'broaden the review jurisdiction']) {
    assert.ok(
      envelope.prohibitions.some((rule) => rule.includes(boundary)),
      `review envelope must state the boundary: '${boundary}'`,
    );
  }

  // Independence is never fabricated: nothing here is required, so no independence is claimed.
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('describe this review as independent')));
  containing(section(text, 'ACCEPTANCE'), [
    'review: required=false, independence=none, executor=none',
    'review_independence: no review is required by this contract',
  ]);
  assert.equal(/independent review is required/.test(text), false);
  assert.ok(text.includes('PASS'), 'review must be allowed to return a clean PASS');

  // Same-session review is never presented as independence (spec §26.1).
  const sameSession = renderRoleEnvelope(envelopeFor('critical correction'));
  containing(section(sameSession, 'ACCEPTANCE'), [
    'review: required=true, independence=none, executor=same_session',
    'review_independence: review is same-session; this is NOT independent review',
  ]);

  // Positive control: where the contract does require independent review, the same renderer says so.
  const independent = renderRoleEnvelope(envelopeFor('subagents implement with independent review'));
  containing(section(independent, 'ACCEPTANCE'), [
    'review_independence: independent review is required by this contract',
  ]);
});

// ── P4-D correct ────────────────────────────────────────────────────────────

test('P4-D — correct envelope: frozen accepted findings only, never a second review', () => {
  const envelope = envelopeFor('critical correction');
  assert.equal(envelope.role, 'correct');
  assert.equal(envelope.jurisdiction.implementation, 'bounded');
  assert.equal(envelope.permissions.code_write, true);

  const rules = envelope.operating_rules.join('\n');
  // Two separate sets: the target is WHAT to correct, the evidence links are WHY it is admitted.
  assert.match(rules, /the accepted findings are frozen; the admitted correction targets are: blocker-a\./);
  assert.match(rules, /each target is admitted by two resolved evidence links: blocker-a ← finding review-finding:blocker-a/);
  assert.match(rules, /accepted by owner-acceptance:blocker-a/);
  assert.match(rules, /A blocker identifier alone admits nothing/);
  assert.match(rules, /canonical-master, reviewer-findings/);
  for (const boundary of ["reviewer's jurisdiction", 'invent new findings', 'redesign architecture', 'unrelated technical debt']) {
    assert.ok(
      envelope.prohibitions.some((rule) => rule.includes(boundary)),
      `correct envelope must state the boundary: '${boundary}'`,
    );
  }
  assert.ok(envelope.prohibitions.some((rule) => rule.includes('second audit')));
  assert.ok(envelope.stop_conditions.some((condition) => condition.includes('outside the accepted findings')));
});

// ── P4-E adjudicate ─────────────────────────────────────────────────────────

test('P4-E — adjudicate envelope: one bounded decision, no implementation or architecture authority', () => {
  const envelope = envelopeFor('adjudicate evidence-backed architecture conflict');
  assert.equal(envelope.role, 'adjudicate');
  assert.equal(envelope.jurisdiction.semantic_adjudication, 'bounded');
  assert.equal(envelope.jurisdiction.implementation, 'none');
  assert.equal(envelope.jurisdiction.architecture, 'none');
  assert.equal(envelope.jurisdiction.product_semantics, 'none');
  assert.equal(envelope.permissions.code_write, false);

  const text = renderRoleEnvelope(envelope);
  containing(section(text, 'JURISDICTION'), [
    'semantic_adjudication: bounded',
    'implementation: none',
    'architecture: none',
  ]);
  for (const outcome of ['FROZEN_DECISION', 'HUMAN_DECISION_REQUIRED', 'UNRESOLVED']) {
    assert.ok(text.includes(outcome), `adjudicate must be allowed to emit ${outcome}`);
  }
  assert.match(text, /does not execute it/);
  for (const boundary of ['implement code', 'own architecture review', 'broad semantic audit', 'expand the declared scope']) {
    assert.ok(
      envelope.prohibitions.some((rule) => rule.includes(boundary)),
      `adjudicate envelope must state the boundary: '${boundary}'`,
    );
  }
});

// ── P4-F non-broadening ─────────────────────────────────────────────────────

test('P4-F — every envelope value is a copy of resolved truth, never a broadening', () => {
  for (const { name } of POSITIVE_CONTRACTS) {
    const contract = resolved(fixtureContract(name));
    const binding = bindToTarget(contract, ALL_TRUE);
    const envelope = compiled(binding);

    assert.deepEqual(Object.keys(envelope).sort(), ENVELOPE_FIELDS, name);
    assert.equal(envelope.version, 'charter/v0.1', name);
    assert.equal(envelope.role, contract.role, name);
    assert.equal(envelope.task_id, contract.task_id, name);
    assert.equal(envelope.execution_target, contract.execution_target, name);
    assert.deepEqual(envelope.model, contract.model, name);
    assert.deepEqual(envelope.authority, contract.authority, name);
    assert.deepEqual(envelope.scope, contract.scope, name);
    assert.deepEqual(envelope.permissions, contract.permissions, name);
    assert.deepEqual(envelope.jurisdiction, contract.jurisdiction, name);
    assert.deepEqual(envelope.acceptance, contract.acceptance, name);
    assert.deepEqual(envelope.verification, contract.verification, name);
    assert.deepEqual(envelope.limits, contract.limits, name);
    assert.deepEqual(envelope.non_goals, contract.non_goals, name);
    assert.deepEqual(envelope.terminal_state, contract.terminal_state, name);
    assert.deepEqual(envelope.enforcement_truth, binding.enforcement, name);
    assert.deepEqual(envelope.capability_evidence, binding.capability_evidence, name);
    assert.deepEqual(envelope.model_availability, contract.model_availability, name);
    assert.deepEqual(envelope.assertion_bindings, contract.assertion_bindings, name);
    assert.deepEqual(envelope.correction_targets, contract.correction_targets, name);
  }
});

// ── P4-G enforcement truth rendering ────────────────────────────────────────

test('P4-G — enforcement truth is transported faithfully and never upgraded (E10)', () => {
  const cases: { name: string; capabilities: ExecutionTargetCapabilities }[] = [
    { name: 'read-only review', capabilities: ALL_FALSE },
    { name: 'read-only review', capabilities: MIXED },
    { name: 'read-only review', capabilities: ALL_TRUE },
    { name: 'release action with release explicitly admitted', capabilities: ALL_FALSE },
    { name: 'release action with release explicitly admitted', capabilities: ALL_TRUE },
  ];

  for (const { name, capabilities } of cases) {
    const binding = bindToTarget(resolved(fixtureContract(name)), capabilities);
    const envelope = compiled(binding);
    const lines = section(renderRoleEnvelope(envelope), 'ENFORCEMENT TRUTH');
    assert.equal(
      lines.filter((line) => ENFORCEMENT_CONSTRAINTS.some((constraint) => line.startsWith(`${constraint}: `))).length,
      ENFORCEMENT_CONSTRAINTS.length,
    );

    for (const constraint of ENFORCEMENT_CONSTRAINTS) {
      const truth: EnforcementTruth = binding.enforcement[constraint];
      const expected = `${constraint}: ${truth} — ${ENFORCEMENT_WORDING[constraint][truth]}`;
      assert.ok(lines.includes(expected), `${name}: expected the exact truthful line '${expected}'`);

      if (truth === 'ENFORCED') {
        assert.ok(expected.includes('hard-enforced'), `${constraint} is ENFORCED and must say so`);
      } else {
        // No upgrade: only ENFORCED truth may claim hard enforcement (E10).
        assert.equal(expected.includes('hard-enforced'), false, `${constraint}=${truth} must not claim hard enforcement`);
      }
      if (truth !== 'INSTRUCTED') assert.equal(expected.includes('instruction-level'), false, constraint);
      if (truth !== 'UNSUPPORTED') assert.equal(expected.includes('cannot be enforced'), false, constraint);
    }
  }

  // E10 regression: a target with no file-scope primitive reports INSTRUCTED, never ENFORCED.
  const parent = compiled(bindToTarget(resolved(fixtureContract('read-only review')), ALL_FALSE));
  assert.equal(parent.enforcement_truth.allowed_files, 'INSTRUCTED');
  containing(section(renderRoleEnvelope(parent), 'ENFORCEMENT TRUTH'), [
    'allowed_files: INSTRUCTED',
    'Do not access files outside the declared file policy',
  ]);
  containing(section(renderRoleEnvelope(parent), 'ENFORCEMENT TRUTH'), ['model_selection: UNSUPPORTED']);

  // T2: the low-level claim path is never attested, so nothing is hard-enforced however capable the
  // claim says the target is — and the envelope says exactly which evidence class it rests on.
  const claimed = compiled(bindToTargetFromClaim(resolved(fixtureContract('read-only review')), ALL_TRUE));
  assert.deepEqual(Object.values(claimed.enforcement_truth).includes('ENFORCED'), false);
  containing(section(renderRoleEnvelope(claimed), 'ENFORCEMENT TRUTH'), [
    'capability_evidence: unattested claim',
    'model_selection: UNSUPPORTED',
  ]);
  assert.deepEqual(claimed.assertion_bindings.map((binding) => binding.verifier), ['review:findings-reported']);
  const claimedText = renderRoleEnvelope(claimed);
  assert.match(claimedText, /ASSERTION_BOUND, not ASSERTION_VERIFIED/);

  // T3: a policy-bearing dimension with no declared policy is NOT_APPLICABLE, never ENFORCED.
  containing(section(renderRoleEnvelope(parent), 'ENFORCEMENT TRUTH'), [
    'policy.allowed_tools: none declared',
  ]);
});

// ── P4-H determinism and immutability ──────────────────────────────────────

test('P4-H — deterministic compilation and rendering over frozen inputs', () => {
  const binding = deepFreeze(structuredClone(bindToTarget(resolved(fixtureContract('critical correction')), ALL_FALSE)));
  const before = JSON.stringify(binding);

  const first = compiled(binding);
  const second = compiled(binding);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(binding), before, 'compilation must not mutate its input');

  const text = renderRoleEnvelope(first);
  assert.equal(renderRoleEnvelope(second), text, 'same envelope must render byte-identical text');
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(text), false, 'rendering must carry no timestamp or date');
  assert.equal(text.includes('this envelope describes one bounded piece of work and stops.'), true);

  // Same truth through a different object yields the same envelope: no aliasing, no identity coupling.
  assert.deepEqual(compiled(structuredClone(binding)), first);

  // Frozen artifact: truth cannot be widened after compilation.
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.permissions), true);
  assert.equal(Object.isFrozen(first.operating_rules), true);
  assert.equal(Object.isFrozen(first.enforcement_truth), true);

  // No aliasing: the envelope was copied out, so freezing it cannot reach into Phase 2 artifacts.
  const fresh = bindToTarget(resolved(fixtureContract('critical correction')), ALL_FALSE);
  compiled(fresh);
  assert.equal(Object.isFrozen(fresh.execution_contract.permissions), false);
  assert.equal(Object.isFrozen(fresh.enforcement), false);
  assert.equal(Object.isFrozen(fresh.execution_contract), false);
});

// ── P4-I runtime override attempts ─────────────────────────────────────────

test('P4-I — override attempts through unknown compiler input fields fail closed', () => {
  const binding = bindToTarget(resolved(fixtureContract('critical correction')), ALL_FALSE);

  const overrideFields = [
    'role',
    'model',
    'scope',
    'authority',
    'permissions',
    'jurisdiction',
    'requirements',
    'enforcement',
    'enforcement_truth',
    'acceptance',
    'verification',
    'limits',
    'target',
    'execution_target',
    'stop_conditions',
    'operating_rules',
  ];
  for (const field of overrideFields) {
    const result = compileRoleEnvelope({ target_binding: binding, [field]: { override: true } });
    assert.equal(result.ok, false, `${field} must not be an admitted compiler input field`);
    assert.deepEqual(codes(result), ['INVALID_TASK_CONTRACT'], field);
    assert.deepEqual(paths(result), [field], field);
    assert.equal('envelope' in result, false, field);
  }

  // The exact attack from the Phase 4 charter §18: no parallel authority channel exists.
  const attack = compileRoleEnvelope({
    target_binding: binding,
    role: 'implement',
    permissions: { release: true },
    scope: ['**/*'],
    model: 'some-other-model',
    authority: ['other-source'],
    enforcement_truth: { allowed_files: 'ENFORCED' },
  });
  assert.equal(attack.ok, false);
  assert.deepEqual(paths(attack), [
    'role',
    'permissions',
    'scope',
    'model',
    'authority',
    'enforcement_truth',
  ]);

  // Hidden overrides inside the binding itself are refused too.
  const inner = compileRoleEnvelope({ target_binding: { ...binding, permissions: { release: true } } });
  assert.deepEqual(codes(inner), ['INVALID_TASK_CONTRACT']);
  assert.deepEqual(paths(inner), ['target_binding.permissions']);

  // A forged target identity is a contradiction, not a silent retarget.
  const forged = compileRoleEnvelope({ target_binding: { ...binding, target: 'subagents' } });
  assert.deepEqual(codes(forged), ['CONTRACT_CONTRADICTION']);
  assert.deepEqual(paths(forged), ['target_binding.execution_contract.execution_target']);

  // A malformed truth table is refused rather than rendered as truth.
  const incomplete = compileRoleEnvelope({ target_binding: { ...binding, enforcement: { allowed_files: 'ENFORCED' } } });
  assert.equal(incomplete.ok, false);
  assert.ok(codes(incomplete).every((code) => code === 'INVALID_TASK_CONTRACT'));
  assert.ok(paths(incomplete).includes('target_binding.enforcement.allowed_tools'));

  const invented = compileRoleEnvelope({
    target_binding: { ...binding, enforcement: { ...binding.enforcement, sandbox_escape: 'ENFORCED' } },
  });
  assert.equal(invented.ok, false);
  assert.ok(paths(invented).includes('target_binding.enforcement.sandbox_escape'));

  // Non-object inputs never compile.
  for (const value of [null, undefined, [], 'x', 42, { target_binding: null }]) {
    assert.equal(compileRoleEnvelope(value).ok, false, String(value));
  }
});

// ── P4-J parent / subagents equivalence ────────────────────────────────────

test('P4-J — role semantics are target-independent; only target truth differs', () => {
  const template = fixtureContract('release action with release explicitly admitted');
  const subagentsContract = resolved(structuredClone(template));
  const parentContract = resolved({ ...structuredClone(template), execution_target: 'parent' });

  const subagentsEnvelope = compiled(bindToTarget(subagentsContract, ALL_TRUE));
  const parentEnvelope = compiled(bindToTarget(parentContract, ALL_FALSE));

  assert.equal(subagentsEnvelope.execution_target, 'subagents');
  assert.equal(parentEnvelope.execution_target, 'parent');
  for (const field of [
    'role',
    'model',
    'objective',
    'operating_rules',
    'prohibitions',
    'stop_conditions',
    'authority',
    'scope',
    'jurisdiction',
    'permissions',
    'acceptance',
    'verification',
    'limits',
    'non_goals',
    'terminal_state',
  ] as const) {
    assert.deepEqual(parentEnvelope[field], subagentsEnvelope[field], `${field} must not differ by target`);
  }

  // Only target facts differ: target identity and the enforcement truth an attested target can
  // actually provide. The tool dimension is policy-blocked for BOTH targets because this contract
  // declares no tool policy (T3), so the file-scope dimension is the one that differs here.
  assert.notDeepEqual(parentEnvelope.execution_target, subagentsEnvelope.execution_target);
  assert.notDeepEqual(parentEnvelope.enforcement_truth, subagentsEnvelope.enforcement_truth);
  assert.equal(parentEnvelope.enforcement_truth.allowed_tools, 'NOT_APPLICABLE');
  assert.equal(subagentsEnvelope.enforcement_truth.allowed_tools, 'NOT_APPLICABLE');
  containing(section(renderRoleEnvelope(parentEnvelope), 'ENFORCEMENT TRUTH'), [
    'allowed_files: INSTRUCTED',
    'allowed_tools: NOT_APPLICABLE',
  ]);
  containing(section(renderRoleEnvelope(subagentsEnvelope), 'ENFORCEMENT TRUTH'), [
    'allowed_files: ENFORCED',
    'allowed_tools: NOT_APPLICABLE',
  ]);
});

// ── Corrector #4 R1–R6: named targets required, sources are not findings ───

test('R1 — a named correction target compiles and is rendered as the target', () => {
  const envelope = envelopeFor('critical correction');
  assert.equal(envelope.role, 'correct');
  assert.deepEqual(envelope.scope.blockers, ['blocker-a']);

  const rules = envelope.operating_rules.join('\n');
  assert.match(rules, /the admitted correction targets are: blocker-a\./);
  const text = renderRoleEnvelope(envelope);
  containing(section(text, 'SCOPE'), ['blockers: blocker-a']);
  containing(section(text, 'OPERATING RULES'), ['blocker-a']);
});

test('R2 — multiple named correction targets all render as bounded accepted targets', () => {
  const template = fixtureContract('unrestricted scope admitted by explicit override');
  const declared = { ...structuredClone(template), scope: { ...template.scope, blockers: ['finding-1', 'finding-2'] } };
  const envelope = compiled(bindToTarget(resolved(declared), ALL_TRUE));

  // The targets are carried truth, not authored text — and the declared scope stays unbroadened.
  assert.deepEqual(envelope.scope.blockers, ['finding-1', 'finding-2']);
  assert.equal(envelope.scope.allow_unrestricted, true);
  assert.match(
    envelope.operating_rules.join('\n'),
    /the admitted correction targets are: finding-1, finding-2\./,
  );
  containing(section(renderRoleEnvelope(envelope), 'SCOPE'), [
    'blockers: finding-1, finding-2',
    'allow_unrestricted: true',
  ]);
});

test('R3 — a correction with no named target fails closed at resolution', () => {
  const template = fixtureContract('critical correction');
  const scope = { files: ['internal/example.go', 'internal/example_test.go'] };
  // T6: an anonymous correction has no admitted authority, so it cannot even resolve — there is no
  // binding to compile, and no envelope can describe targets that do not exist.
  const anonymous = resolveExecutionContract({ ...structuredClone(template), scope }, ENV);
  assert.equal(anonymous.ok, false);
  if (anonymous.ok) return;
  assert.deepEqual([...new Set(anonymous.errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
  assert.deepEqual(anonymous.errors.map((error) => error.path), ['scope.blockers']);
});

test('R4 — an empty correction-target list fails closed at resolution', () => {
  const template = fixtureContract('critical correction');
  const empty = resolveExecutionContract({ ...structuredClone(template), scope: { ...template.scope, blockers: [] } }, ENV);
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.deepEqual([...new Set(empty.errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
});

test('R5 — a bound authority source alone is not a correction target', () => {
  const template = fixtureContract('critical correction');
  const sourcesOnly = resolveExecutionContract(
    {
      ...structuredClone(template),
      authority: { sources: ['reviewer-findings'] },
      scope: { files: ['internal/example.go', 'internal/example_test.go'] },
    },
    ENV,
  );
  assert.equal(sourcesOnly.ok, false);
  if (sourcesOnly.ok) return;
  assert.deepEqual([...new Set(sourcesOnly.errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
});

test('R5b — a named target with no finding or acceptance provenance is refused', () => {
  const template = fixtureContract('critical correction');
  const arbitrary = { ...structuredClone(template), scope: { files: ['internal/example.go'], blockers: ['fix-whatever-i-want'] } };
  // An arbitrary blocker identifier is not authority: neither evidence link resolves for it, so no
  // correction target is admitted (T6).
  const result = resolveExecutionContract(arbitrary, ENV);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual([...new Set(result.errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
  const messages = result.errors.map((error) => error.message).join('\n');
  assert.match(messages, /has no admitted finding provenance/);

  // Finding provenance without acceptance provenance is refused too: half the chain is not authority.
  const findingOnly = resolveExecutionContract(
    { ...structuredClone(template), scope: { files: ['internal/example.go'], blockers: ['blocker-a'] } },
    { ...ENV, correctionBinder: { findings: CORRECTION_BINDER.findings, acceptances: { bind: () => [] } } },
  );
  assert.equal(findingOnly.ok, false);
  if (findingOnly.ok) return;
  assert.match(findingOnly.errors.map((error) => error.message).join('\n'), /has no explicit acceptance provenance/);

  // Acceptance provenance without finding provenance is refused as well.
  const acceptanceOnly = resolveExecutionContract(
    { ...structuredClone(template), scope: { files: ['internal/example.go'], blockers: ['blocker-a'] } },
    { ...ENV, correctionBinder: { findings: { bind: () => [] }, acceptances: CORRECTION_BINDER.acceptances } },
  );
  assert.equal(acceptanceOnly.ok, false);
  if (acceptanceOnly.ok) return;
  assert.match(acceptanceOnly.errors.map((error) => error.message).join('\n'), /has no admitted finding provenance/);
});

test('R6 — the named-target requirement is scoped to `correct` alone', () => {
  const roles: { name: string; role: string }[] = [
    { name: 'planner decomposition (no mutation)', role: 'planner' },
    { name: 'subagents implement with independent review', role: 'implement' },
    { name: 'read-only review', role: 'review' },
    { name: 'adjudicate evidence-backed architecture conflict', role: 'adjudicate' },
  ];
  for (const { name, role } of roles) {
    const envelope = envelopeFor(name);
    assert.equal(envelope.role, role, name);
    const rules = envelope.operating_rules.join('\n');
    assert.equal(rules.includes('correction target'), false, `${role} must not gain correction wording`);
    assert.equal(rules.includes('accepted findings are frozen'), false, `${role} must not claim frozen findings`);
  }
  // A role that corrects nothing needs no targets: only `correct` requires one.
  assert.equal(envelopeFor('planner decomposition (no mutation)').scope.blockers, undefined);
});

// ── Phase boundary ─────────────────────────────────────────────────────────

test('Phase 4 surface — an envelope is an instruction artifact, not a lifecycle handle', () => {
  const envelope = envelopeFor('critical correction');
  for (const [key, value] of Object.entries(envelope)) {
    assert.equal(typeof value === 'function', false, `${key} must not be callable`);
    assert.equal(value instanceof Promise, false, `${key} must not be async`);
  }
  const fields = Object.keys(envelope);
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
    'run',
    'run_id',
    'current_step',
    'workflow',
    'escalation_loop',
    'correction_loop',
    'findings_store',
    'pending_findings',
  ]) {
    assert.equal(fields.includes(forbidden), false, `lifecycle field '${forbidden}' leaked into an envelope`);
  }
});
