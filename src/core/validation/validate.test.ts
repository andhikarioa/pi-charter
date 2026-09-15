import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AuthorityBinder } from '../authority/binder.ts';
import { createAuthorityBinder } from '../authority/binder.ts';
import { NEGATIVE_CONTRACTS, POSITIVE_CONTRACTS, ROOT } from './fixtures.ts';
import { validateTaskContract } from './validate.ts';

const BINDER: AuthorityBinder = createAuthorityBinder({
  'canonical-master': { doc: 'PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md' },
  'reviewer-findings': { doc: 'review-findings.json' },
});

/** Binder that returns two candidates for every reference: ambiguity must fail closed. */
const AMBIGUOUS_BINDER: AuthorityBinder = {
  bind: () => [
    { id: 'candidate-a' },
    { id: 'candidate-b' },
  ],
};

function codes(result: ReturnType<typeof validateTaskContract>): string[] {
  return result.ok ? [] : [...new Set(result.errors.map((e) => e.code))];
}

test('positive fixtures are accepted', () => {
  for (const { name, contract } of POSITIVE_CONTRACTS) {
    const result = validateTaskContract(contract, { authorityBinder: BINDER });
    assert.equal(result.ok, true, `expected '${name}' to be accepted: ${JSON.stringify(codes(result))}`);
  }
});

test('negative fixtures fail closed with the expected canonical codes', () => {
  for (const { name, contract, expected, ambiguousBinder } of NEGATIVE_CONTRACTS) {
    const result = validateTaskContract(contract, {
      authorityBinder: ambiguousBinder ? AMBIGUOUS_BINDER : BINDER,
    });
    assert.equal(result.ok, false, `expected '${name}' to fail closed`);
    assert.deepEqual(codes(result), expected, `unexpected codes for '${name}'`);
  }
});

function byName(name: string) {
  const fixture = NEGATIVE_CONTRACTS.find((f) => f.name === name);
  assert.ok(fixture, `missing fixture '${name}'`);
  return fixture;
}

test('E2 — role/task/permission conflict fails closed', () => {
  for (const name of [
    'E2 review role with code_write=true',
    'E2 planner role with code_write=true',
    'E2 planner role with external_write=true',
    'E2 planner role with release=true',
    'E2 T4 without evidence',
  ]) {
    const { contract, expected } = byName(name);
    const result = validateTaskContract(contract, { authorityBinder: BINDER });
    assert.equal(result.ok, false);
    assert.deepEqual(codes(result), expected);
  }
});

test('E3 — unresolved or ambiguous authority fails closed', () => {
  for (const name of ['E3 unknown authority reference', 'E3 one of two references unresolved']) {
    const { contract, expected } = byName(name);
    assert.deepEqual(codes(validateTaskContract(contract, { authorityBinder: BINDER })), expected);
  }
  const ambiguous = byName('E3 ambiguous authority reference');
  assert.deepEqual(
    codes(validateTaskContract(ambiguous.contract, { authorityBinder: AMBIGUOUS_BINDER })),
    ambiguous.expected,
  );
  // No binder supplied is not a bypass.
  assert.deepEqual(codes(validateTaskContract(ambiguous.contract, {})), ['AUTHORITY_UNRESOLVED']);
});

test('E4 — invalid or overbroad scope fails closed', () => {
  for (const name of [
    'E4 bounded write role with empty scope',
    'E4 unrestricted scope without explicit override',
    'E4 scope entry escaping root',
    'E4 absolute scope entry',
  ]) {
    const { contract, expected } = byName(name);
    assert.deepEqual(codes(validateTaskContract(contract, { authorityBinder: BINDER })), expected, name);
  }
  // Unrestricted scope is admissible only through the explicit override.
  const override = POSITIVE_CONTRACTS.find((p) => p.name === 'unrestricted scope admitted by explicit override');
  assert.ok(override);
  assert.equal(validateTaskContract(override.contract, { authorityBinder: BINDER }).ok, true);
  // A bounded subtree is not overbroad.
  const bounded = structuredClone(byName('E4 unrestricted scope without explicit override').contract) as {
    scope: { files: string[] };
  };
  bounded.scope.files = ['internal/**'];
  assert.equal(validateTaskContract(bounded, { authorityBinder: BINDER }).ok, true);
});

test('E5 — unverifiable acceptance fails closed', () => {
  for (const name of [
    'E5 fuzzy command acceptance',
    'E5 fuzzy assertion acceptance',
    'E5 fuzzy single-token assertion',
    'E5 empty acceptance',
  ]) {
    const { contract, expected } = byName(name);
    assert.deepEqual(codes(validateTaskContract(contract, { authorityBinder: BINDER })), expected, name);
  }
});

test('E7 — forbidden structured action fails closed', () => {
  for (const name of [
    'E7 release=false with tag action',
    'E7 release=false with tag and publish actions',
    'E7 external_write=false with push action',
  ]) {
    const { contract, expected } = byName(name);
    assert.deepEqual(codes(validateTaskContract(contract, { authorityBinder: BINDER })), expected, name);
  }
  // Every contradictory action is reported, not just the first.
  const multiple = validateTaskContract(byName('E7 release=false with tag and publish actions').contract, {
    authorityBinder: BINDER,
  });
  assert.equal(multiple.ok ? 0 : multiple.errors.length, 2);
  // Structure is authoritative: the same contract with the permission admitted is accepted.
  const admitted = POSITIVE_CONTRACTS.find((p) => p.name === 'release action with release explicitly admitted');
  assert.ok(admitted);
  assert.equal(validateTaskContract(admitted.contract, { authorityBinder: BINDER }).ok, true);
});

test('validation is deterministic for equivalent inputs', () => {
  for (const { contract } of POSITIVE_CONTRACTS) {
    const first = validateTaskContract(contract, { authorityBinder: BINDER });
    const second = validateTaskContract(structuredClone(contract), { authorityBinder: BINDER });
    assert.deepEqual(first, second);
  }
  for (const { contract, ambiguousBinder } of NEGATIVE_CONTRACTS) {
    const env = { authorityBinder: ambiguousBinder ? AMBIGUOUS_BINDER : BINDER };
    const first = validateTaskContract(contract, env);
    const second = validateTaskContract(structuredClone(contract), env);
    assert.deepEqual(first, second);
  }
});

test('accepted contracts are returned normalized, not mutated', () => {
  const source = structuredClone(POSITIVE_CONTRACTS[0]!.contract);
  const result = validateTaskContract(source, { authorityBinder: BINDER });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.contract, source);
  assert.notEqual(result.contract.scope, source.scope);
  assert.deepEqual(result.contract, source);
});

// ── Finding 1 / C1: Closed runtime objects ──────────────────────────────────
test('C1 — unknown structured fields fail closed with INVALID_TASK_CONTRACT', () => {
  const base = structuredClone(POSITIVE_CONTRACTS[0]!.contract);

  const testCases: { name: string; mutate: (c: Record<string, any>) => void; expectedPath: string }[] = [
    {
      name: 'top-level unbounded_mode',
      mutate: (c) => { c.unbounded_mode = true; },
      expectedPath: 'unbounded_mode',
    },
    {
      name: 'permissions.deploy',
      mutate: (c) => { c.permissions.deploy = true; },
      expectedPath: 'permissions.deploy',
    },
    {
      name: 'scope.everything',
      mutate: (c) => { c.scope.everything = true; },
      expectedPath: 'scope.everything',
    },
    {
      name: 'authority.precedence',
      mutate: (c) => { c.authority.precedence = 'highest'; },
      expectedPath: 'authority.precedence',
    },
    {
      name: 'acceptance.magic',
      mutate: (c) => { c.acceptance.magic = true; },
      expectedPath: 'acceptance.magic',
    },
    {
      name: 'task.unknown_field',
      mutate: (c) => { c.task.unknown_field = 'foo'; },
      expectedPath: 'task.unknown_field',
    },
    {
      name: 'acceptance.review.extra',
      mutate: (c) => {
        c.acceptance.review = { required: true, independence: 'none', extra: 'bad' };
      },
      expectedPath: 'acceptance.review.extra',
    },
    {
      name: 'verification.extra',
      mutate: (c) => { c.verification.extra = true; },
      expectedPath: 'verification.extra',
    },
    {
      name: 'limits.extra',
      mutate: (c) => { c.limits = { ...c.limits, extra: 42 }; },
      expectedPath: 'limits.extra',
    },
  ];

  for (const { name, mutate, expectedPath } of testCases) {
    const candidate = structuredClone(base);
    mutate(candidate);
    const result = validateTaskContract(candidate, { authorityBinder: BINDER });
    assert.equal(result.ok, false, `expected '${name}' to fail validation`);
    assert.ok(
      result.errors.some((e) => e.code === 'INVALID_TASK_CONTRACT' && e.path === expectedPath),
      `expected '${name}' to fail with INVALID_TASK_CONTRACT at path '${expectedPath}', got: ${JSON.stringify(result.errors)}`,
    );
  }
});

// ── Finding 2 / C2: Planner authority restrictions ──────────────────────────
test('C2 — planner authority rejects code_write, external_write, and release', () => {
  const basePlanner = POSITIVE_CONTRACTS.find((p) => p.name === 'planner decomposition (no mutation)')!.contract;

  // code_write=true rejected
  const codeWritePlanner = structuredClone(basePlanner);
  codeWritePlanner.permissions.code_write = true;
  const r1 = validateTaskContract(codeWritePlanner, { authorityBinder: BINDER });
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.code === 'INVALID_TASK_CONTRACT' && e.path === 'permissions.code_write'));

  // external_write=true rejected
  const extWritePlanner = structuredClone(basePlanner);
  extWritePlanner.permissions.external_write = true;
  const r2 = validateTaskContract(extWritePlanner, { authorityBinder: BINDER });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.code === 'INVALID_TASK_CONTRACT' && e.path === 'permissions.external_write'));

  // release=true rejected
  const releasePlanner = structuredClone(basePlanner);
  releasePlanner.permissions.release = true;
  const r3 = validateTaskContract(releasePlanner, { authorityBinder: BINDER });
  assert.equal(r3.ok, false);
  assert.ok(r3.errors.some((e) => e.code === 'INVALID_TASK_CONTRACT' && e.path === 'permissions.release'));

  // research=true allowed for planner
  const researchPlanner = structuredClone(basePlanner);
  researchPlanner.permissions.research = true;
  const rResearch = validateTaskContract(researchPlanner, { authorityBinder: BINDER });
  assert.equal(rResearch.ok, true, `expected research=true to be accepted for planner: ${JSON.stringify(rResearch)}`);
});

// ── Finding 3 / C3: T4 evidence-backed semantics across roles ───────────────
test('C3 — evidence-backed T4 accepted across roles; unevidenced T4 rejected', () => {
  // Evidence-backed T4 with role=implement is accepted
  const t4Implement = {
    version: 'charter/v0.1' as const,
    task: { id: 't4-impl', class: 'T4' as const, risk: 'critical' as const, evidence: ['conflict-report-7'] },
    role: 'implement' as const,
    execution_target: 'parent' as const,
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { assertions: ['conflict-resolved'] },
    verification: { level: 'V1' as const },
  };
  const rImpl = validateTaskContract(t4Implement, { authorityBinder: BINDER });
  assert.equal(rImpl.ok, true, `expected evidence-backed T4 implement to be accepted: ${JSON.stringify(rImpl)}`);

  // Evidence-backed T4 with role=correct is accepted
  const t4Correct = {
    ...t4Implement,
    task: { ...t4Implement.task, id: 't4-corr' },
    role: 'correct' as const,
  };
  const rCorr = validateTaskContract(t4Correct, { authorityBinder: BINDER });
  assert.equal(rCorr.ok, true, `expected evidence-backed T4 correct to be accepted: ${JSON.stringify(rCorr)}`);

  // Evidence-backed T4 with role=review is accepted
  const t4Review = {
    ...t4Implement,
    task: { ...t4Implement.task, id: 't4-rev' },
    role: 'review' as const,
    permissions: { code_write: false, research: false, external_write: false, release: false },
  };
  const rRev = validateTaskContract(t4Review, { authorityBinder: BINDER });
  assert.equal(rRev.ok, true, `expected evidence-backed T4 review to be accepted: ${JSON.stringify(rRev)}`);

  // Evidence-backed T4 with role=planner is accepted
  const t4Planner = {
    ...t4Implement,
    task: { ...t4Implement.task, id: 't4-plan' },
    role: 'planner' as const,
    scope: {},
    permissions: { code_write: false, research: false, external_write: false, release: false },
  };
  const rPlan = validateTaskContract(t4Planner, { authorityBinder: BINDER });
  assert.equal(rPlan.ok, true, `expected evidence-backed T4 planner to be accepted: ${JSON.stringify(rPlan)}`);

  // Evidence-backed T4 with role=adjudicate is accepted
  const t4Adjudicate = {
    ...t4Implement,
    task: { ...t4Implement.task, id: 't4-adj' },
    role: 'adjudicate' as const,
    permissions: { code_write: false, research: false, external_write: false, release: false },
  };
  const rAdj = validateTaskContract(t4Adjudicate, { authorityBinder: BINDER });
  assert.equal(rAdj.ok, true, `expected evidence-backed T4 adjudicate to be accepted: ${JSON.stringify(rAdj)}`);

  // T4 without evidence (undefined) is rejected
  const t4NoEvidence = {
    ...t4Implement,
    task: { id: 't4-no-ev', class: 'T4' as const, risk: 'critical' as const },
  };
  const rNoEv = validateTaskContract(t4NoEvidence, { authorityBinder: BINDER });
  assert.equal(rNoEv.ok, false);
  assert.ok(rNoEv.errors.some((e) => e.code === 'INVALID_TASK_CONTRACT' && e.path === 'task.evidence'));

  // T4 with empty evidence list is rejected
  const t4EmptyEvidence = {
    ...t4Implement,
    task: { id: 't4-empty-ev', class: 'T4' as const, risk: 'critical' as const, evidence: [] },
  };
  const rEmptyEv = validateTaskContract(t4EmptyEvidence, { authorityBinder: BINDER });
  assert.equal(rEmptyEv.ok, false);
  assert.ok(rEmptyEv.errors.some((e) => e.code === 'INVALID_TASK_CONTRACT' && e.path === 'task.evidence'));
});
