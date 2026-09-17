import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AuthorityBinder } from '../authority/binder.ts';
import { createAuthorityBinder } from '../authority/binder.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import { ASSERTION_BINDER, CORRECTION_BINDER, NEGATIVE_CONTRACTS, POSITIVE_CONTRACTS } from '../validation/fixtures.ts';
import { resolveExecutionContract, type ResolutionResult, type ResolverEnv } from './resolve.ts';

const BINDER = createAuthorityBinder({
  'canonical-master': { doc: 'PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md' },
  'reviewer-findings': { doc: 'review-findings.json' },
  'extra-source-a': { doc: 'unrelated-a.md' },
});

const PROFILE = {
  workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
  reviewer: { preferred: 'gpt-5.6-sol', fallback: ['deepseek-v4.1-flash'] },
  reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
} as const;
const AVAILABLE = ['gemini-3.8-flash', 'gpt-5.6-sol', 'deepseek-v4.1-flash'];

function env(overrides: Partial<ResolverEnv> = {}): ResolverEnv {
  return {
    authorityBinder: BINDER,
    assertionBinder: ASSERTION_BINDER,
    correctionBinder: CORRECTION_BINDER,
    profile: PROFILE,
    available: AVAILABLE,
    ...overrides,
  };
}

function resolve(contract: unknown, overrides: Partial<ResolverEnv> = {}): ResolutionResult {
  return resolveExecutionContract(contract, env(overrides));
}

function resolved(contract: unknown, overrides: Partial<ResolverEnv> = {}): ExecutionContract {
  const result = resolve(contract, overrides);
  if (!result.ok) assert.fail(`expected resolution to succeed: ${JSON.stringify(result.errors)}`);
  return result.contract;
}

function fixture(name: string): TaskContract {
  const found = POSITIVE_CONTRACTS.find((entry) => entry.name === name);
  assert.ok(found, `missing positive fixture '${name}'`);
  return found.contract;
}

function negative(name: string): TaskContract {
  const found = NEGATIVE_CONTRACTS.find((entry) => entry.name === name);
  assert.ok(found, `missing negative fixture '${name}'`);
  return found.contract as TaskContract;
}

function codes(result: ResolutionResult): string[] {
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.code))];
}

test('positive fixtures resolve to one canonical rich ExecutionContract without widening', () => {
  for (const { name, contract } of POSITIVE_CONTRACTS) {
    const result = resolve(contract);
    assert.equal(result.ok, true, name);
    if (!result.ok) continue;
    const out = result.contract;
    assert.equal(out.task_id, contract.task.id, name);
    assert.equal(out.role, contract.role, name);
    assert.equal(out.execution_target, contract.execution_target, name);
    assert.deepEqual(out.scope, contract.scope, name);
    assert.deepEqual(out.acceptance, contract.acceptance, name);
    assert.deepEqual(out.verification, { level: contract.verification.level }, name);
    assert.deepEqual(out.non_goals, contract.non_goals ?? [], name);
    assert.deepEqual(out.authority.bound_sources, contract.authority.sources, name);
    for (const key of ['code_write', 'research', 'external_write', 'release'] as const) {
      assert.ok(!out.permissions[key] || contract.permissions[key], `${name}: ${key} widened`);
    }
    assert.equal('jurisdiction' in out, false, `${name}: Jurisdiction must not be canonical state`);
  }
});

test('authority is resolved once per declared reference and provenance is retained', () => {
  const calls = new Map<string, number>();
  const counting: AuthorityBinder = {
    bind(reference) {
      calls.set(reference, (calls.get(reference) ?? 0) + 1);
      return BINDER.bind(reference);
    },
  };
  const contract = structuredClone(fixture('subagents implement with independent review'));
  contract.authority.sources = ['canonical-master', 'reviewer-findings'];
  const result = resolve(contract, { authorityBinder: counting });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.fromEntries(calls), { 'canonical-master': 1, 'reviewer-findings': 1 });
  assert.equal(result.contract.authority.provenance.length, 2);
  assert.deepEqual(result.contract.authority.bound_sources, contract.authority.sources);
});

test('missing and ambiguous authority fail closed in resolution', () => {
  assert.deepEqual(codes(resolve(negative('E3 unknown authority reference'))), ['AUTHORITY_UNRESOLVED']);
  assert.deepEqual(codes(resolve(negative('E3 one of two references unresolved'))), ['AUTHORITY_UNRESOLVED']);

  const ambiguous: AuthorityBinder = { bind: () => [{ id: 'a' }, { id: 'b' }] };
  assert.deepEqual(codes(resolve(negative('E3 ambiguous authority reference'), { authorityBinder: ambiguous })), ['AUTHORITY_UNRESOLVED']);
});

test('binder catalogue never widens declared authority', () => {
  const out = resolved(fixture('release action with release explicitly admitted'));
  assert.deepEqual(out.authority.bound_sources, ['canonical-master']);
  assert.equal(out.authority.bound_sources.includes('extra-source-a'), false);
});

test('model routing is role-based and uses explicit fallback only', () => {
  const parent = resolved(fixture('release action with release explicitly admitted'));
  assert.equal(parent.model.tier, 'workhorse');
  assert.equal(parent.model.resolved, 'gemini-3.8-flash');
  assert.equal(parent.model.fallback_used, false);

  const review = resolved(fixture('read-only review'), { available: ['deepseek-v4.1-flash'] });
  assert.equal(review.model.tier, 'reviewer');
  assert.equal(review.model.resolved, 'deepseek-v4.1-flash');
  assert.equal(review.model.fallback_used, true);

  const unavailable = resolve(fixture('read-only review'), { available: ['unlisted-model'] });
  assert.deepEqual(codes(unavailable), ['MODEL_UNAVAILABLE']);
});

test('task class and risk do not silently change model tier or grant authority', () => {
  const base = structuredClone(fixture('release action with release explicitly admitted'));
  const variants: TaskContract[] = [
    { ...base, task: { ...base.task, class: 'T2', risk: 'high' } },
    { ...base, task: { ...base.task, class: 'T3', risk: 'critical' } },
  ];
  const baseline = resolved(base);
  for (const variant of variants) {
    const out = resolved(variant);
    assert.equal(out.model.tier, baseline.model.tier);
    assert.deepEqual(out.permissions, baseline.permissions);
    assert.deepEqual(out.scope, baseline.scope);
    assert.deepEqual(out.authority, baseline.authority);
  }
});

test('raw model availability remains explicitly an unattested claim', () => {
  const out = resolved(fixture('release action with release explicitly admitted'));
  assert.equal(out.model_availability.class, 'unattested_claim');
});

test('assertions and correction targets must bind to evidence before resolution succeeds', () => {
  const review = fixture('read-only review');
  const noAssertionBinder = resolve(review, { assertionBinder: undefined });
  if (review.acceptance.assertions?.length) assert.equal(noAssertionBinder.ok, false);

  const correction = fixture('critical correction');
  const noCorrectionBinder = resolve(correction, { correctionBinder: undefined });
  assert.equal(noCorrectionBinder.ok, false);
  if (!noCorrectionBinder.ok) assert.ok(noCorrectionBinder.errors.some((error) => error.path?.startsWith('scope.blockers') === true));

  const good = resolved(correction);
  assert.ok(good.correction_targets.length > 0);
  assert.ok(good.correction_targets.every((target) => target.finding && target.acceptance));
});

test('declared execution policy and hard requirements are carried verbatim, never invented', () => {
  const base = fixture('subagents implement with independent review');
  const declared: TaskContract = {
    ...base,
    execution_policy: { allowed_tools: ['read', 'edit'] },
    requirements: { enforcement: { allowed_tools: 'required' } },
  };
  const out = resolved(declared);
  assert.deepEqual(out.execution_policy, declared.execution_policy);
  assert.deepEqual(out.requirements, declared.requirements);

  const plain = resolved(base);
  assert.equal('requirements' in plain, false);
});

test('resolver refuses unknown environment configuration and unusable authority binder', () => {
  const contract = fixture('release action with release explicitly admitted');
  const unknown = resolveExecutionContract(contract, { ...env(), future_policy: true } as unknown as ResolverEnv);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.ok(unknown.errors.some((error) => error.path === 'env.future_policy'));

  const missingBinder = resolveExecutionContract(contract, { ...env(), authorityBinder: undefined } as unknown as ResolverEnv);
  assert.equal(missingBinder.ok, false);
  if (!missingBinder.ok) assert.ok(missingBinder.errors.some((error) => error.path === 'env.authorityBinder'));
});

test('resolution is deterministic and does not mutate caller inputs', () => {
  const contract = structuredClone(fixture('subagents implement with independent review'));
  const before = structuredClone(contract);
  const first = resolve(contract);
  const second = resolve(structuredClone(contract));
  assert.deepEqual(first, second);
  assert.deepEqual(contract, before);
  if (first.ok) assert.notEqual(first.contract, contract);
});

test('ExecutionContract contains no target capability or enforcement truth', () => {
  const out = resolved(fixture('subagents implement with independent review')) as unknown as Record<string, unknown>;
  for (const forbidden of ['enforcement', 'capabilities', 'capability_evidence', 'jurisdiction']) {
    assert.equal(forbidden in out, false, forbidden);
  }
});
