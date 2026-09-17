import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NEGATIVE_CONTRACTS, POSITIVE_CONTRACTS, ROOT } from './fixtures.ts';
import { validateTaskContract } from './validate.ts';

function codes(result: ReturnType<typeof validateTaskContract>): string[] {
  return result.ok ? [] : [...new Set(result.errors.map((e) => e.code))];
}

function byName(name: string) {
  const fixture = NEGATIVE_CONTRACTS.find((f) => f.name === name);
  assert.ok(fixture, `missing fixture '${name}'`);
  return fixture;
}

test('positive fixtures are structurally and semantically valid', () => {
  for (const { name, contract } of POSITIVE_CONTRACTS) {
    const result = validateTaskContract(contract);
    assert.equal(result.ok, true, `expected '${name}' to validate: ${JSON.stringify(codes(result))}`);
  }
});

test('non-authority negative fixtures fail closed with their canonical codes', () => {
  for (const { name, contract, expected } of NEGATIVE_CONTRACTS.filter((fixture) => !fixture.name.startsWith('E3 '))) {
    const result = validateTaskContract(contract);
    assert.equal(result.ok, false, `expected '${name}' to fail closed`);
    assert.deepEqual(codes(result), expected, `unexpected codes for '${name}'`);
  }
});

test('authority existence/ambiguity is not duplicated in Phase 1 validation', () => {
  for (const name of ['E3 unknown authority reference', 'E3 ambiguous authority reference', 'E3 one of two references unresolved']) {
    const { contract } = byName(name);
    assert.equal(validateTaskContract(contract).ok, true, `${name} should be resolved by Phase 2, not validation`);
  }
});

test('role and permission contradictions fail closed', () => {
  for (const name of [
    'E2 review role with code_write=true',
    'E2 planner role with code_write=true',
    'E2 planner role with external_write=true',
    'E2 planner role with release=true',
    'E2 T4 without evidence',
  ]) {
    const { contract, expected } = byName(name);
    assert.deepEqual(codes(validateTaskContract(contract)), expected, name);
  }
});

test('scope and acceptance contradictions fail closed', () => {
  for (const name of [
    'E4 bounded write role with empty scope',
    'E4 unrestricted scope without explicit override',
    'E4 scope entry escaping root',
    'E4 absolute scope entry',
    'E5 fuzzy command acceptance',
    'E5 fuzzy assertion acceptance',
    'E5 fuzzy single-token assertion',
    'E5 empty acceptance',
  ]) {
    const { contract, expected } = byName(name);
    assert.deepEqual(codes(validateTaskContract(contract)), expected, name);
  }

  const override = POSITIVE_CONTRACTS.find((p) => p.name === 'unrestricted scope admitted by explicit override');
  assert.ok(override);
  assert.equal(validateTaskContract(override.contract).ok, true);
});

test('forbidden structured actions fail closed and admitted release remains valid', () => {
  for (const name of [
    'E7 release=false with tag action',
    'E7 release=false with tag and publish actions',
    'E7 external_write=false with push action',
  ]) {
    const { contract, expected } = byName(name);
    assert.deepEqual(codes(validateTaskContract(contract)), expected, name);
  }
  const admitted = POSITIVE_CONTRACTS.find((p) => p.name === 'release action with release explicitly admitted');
  assert.ok(admitted);
  assert.equal(validateTaskContract(admitted.contract).ok, true);
});

test('unknown governance-bearing fields fail closed, including removed lifecycle fields', () => {
  const base = structuredClone(POSITIVE_CONTRACTS[0]!.contract) as Record<string, any>;
  const cases: { path: string; mutate: (candidate: Record<string, any>) => void }[] = [
    { path: 'unbounded_mode', mutate: (c) => { c.unbounded_mode = true; } },
    { path: 'permissions.deploy', mutate: (c) => { c.permissions.deploy = true; } },
    { path: 'scope.everything', mutate: (c) => { c.scope.everything = true; } },
    { path: 'authority.precedence', mutate: (c) => { c.authority.precedence = 'highest'; } },
    { path: 'acceptance.magic', mutate: (c) => { c.acceptance.magic = true; } },
    { path: 'task.unknown_field', mutate: (c) => { c.task.unknown_field = 'foo'; } },
    { path: 'verification.extra', mutate: (c) => { c.verification.extra = true; } },
    { path: 'limits', mutate: (c) => { c.limits = { correction_rounds: 1, semantic_escalations: 1 }; } },
  ];

  for (const { path, mutate } of cases) {
    const candidate = structuredClone(base);
    mutate(candidate);
    const result = validateTaskContract(candidate);
    assert.equal(result.ok, false, path);
    if (result.ok) continue;
    assert.ok(result.errors.some((error) => error.code === 'INVALID_TASK_CONTRACT' && error.path === path), path);
  }
});

test('validation is deterministic and returns a normalized copy without mutating input', () => {
  const source = structuredClone(POSITIVE_CONTRACTS[0]!.contract);
  const first = validateTaskContract(source);
  const second = validateTaskContract(structuredClone(source));
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.notEqual(first.contract, source);
  assert.notEqual(first.contract.scope, source.scope);
  assert.deepEqual(first.contract, source);
});

test('evidence-backed T4 works across roles; missing evidence does not', () => {
  const base = {
    version: 'charter/v0.1' as const,
    task: { id: 't4', class: 'T4' as const, risk: 'critical' as const, evidence: ['conflict-report-7'] },
    role: 'implement' as const,
    execution_target: 'parent' as const,
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { assertions: ['conflict-resolved'] },
    verification: { level: 'V1' as const },
  };

  assert.equal(validateTaskContract(base).ok, true);
  assert.equal(validateTaskContract({ ...base, role: 'review', permissions: { ...base.permissions, code_write: false } }).ok, true);
  assert.equal(validateTaskContract({ ...base, role: 'planner', scope: {}, permissions: { ...base.permissions, code_write: false } }).ok, true);
  assert.equal(validateTaskContract({ ...base, role: 'adjudicate', permissions: { ...base.permissions, code_write: false } }).ok, true);

  const missing = validateTaskContract({ ...base, task: { id: 't4-missing', class: 'T4' as const, risk: 'critical' as const } });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.ok(missing.errors.some((error) => error.path === 'task.evidence'));
});
