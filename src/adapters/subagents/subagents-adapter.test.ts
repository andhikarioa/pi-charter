import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createAuthorityBinder } from '../../core/authority/binder.ts';
import type { ExecutionContract } from '../../core/contracts/execution-contract.ts';
import type { TaskContract } from '../../core/contracts/task-contract.ts';
import type { ExecutionTargetCapabilitySnapshot } from '../../core/enforcement/target-binding.ts';
import { resolveExecutionContract, type ResolverEnv } from '../../core/resolver/resolve.ts';
import { POSITIVE_CONTRACTS } from '../../core/validation/fixtures.ts';
import { bindSubagentsTarget } from './subagents-adapter.ts';

const ENV: ResolverEnv = {
  authorityBinder: createAuthorityBinder({ 'canonical-master': {}, 'reviewer-findings': {} }),
  profile: {
    workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
    reviewer: { preferred: 'gpt-5.6-sol', fallback: [] },
    reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
  },
  available: ['gemini-3.8-flash', 'gpt-5.6-sol'],
};

/** Canonical capability fixture (Phase 3 charter §3), supplied by the environment at runtime. */
const SUBAGENTS_SNAPSHOT: ExecutionTargetCapabilitySnapshot = {
  name: 'subagents',
  capabilities: {
    model_selection: true,
    fresh_session: true,
    tool_ceiling: true,
    file_scope_enforcement: false,
    independent_review: true,
  },
};

function contractFor(name: string): ExecutionContract {
  const fixture = POSITIVE_CONTRACTS.find((p) => p.name === name);
  assert.ok(fixture, `missing positive fixture '${name}'`);
  const result = resolveExecutionContract(structuredClone<TaskContract>(fixture.contract), ENV);
  if (!result.ok) assert.fail(`expected resolution to succeed, got ${JSON.stringify(result.errors)}`);
  return result.contract;
}

/** A resolved contract whose TaskContract declared hard enforcement requirements (the only channel). */
function contractRequiring(name: string, requirements: TaskContract['requirements']): ExecutionContract {
  const fixture = POSITIVE_CONTRACTS.find((p) => p.name === name);
  assert.ok(fixture, `missing positive fixture '${name}'`);
  const task: TaskContract = { ...structuredClone(fixture.contract), requirements };
  const result = resolveExecutionContract(task, ENV);
  if (!result.ok) assert.fail(`expected resolution to succeed, got ${JSON.stringify(result.errors)}`);
  return result.contract;
}

test('subagents adapter — translates bound truth into bounded handoff parameters', () => {
  const contract = contractFor('subagents implement with independent review');
  const result = bindSubagentsTarget({ execution_contract: contract, capability_snapshot: SUBAGENTS_SNAPSHOT });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;
  const handoff = result.handoff;
  assert.equal(handoff.target, 'subagents');
  assert.equal(handoff.role, 'implement');
  // The resolved model identity is handed over — not the tier preference, and never a substitute.
  assert.equal(handoff.model, contract.model.resolved);
  assert.equal(handoff.model, contract.model.preferred);
  assert.equal(handoff.fresh_session_required, true);
  assert.equal(handoff.enforcement.allowed_tools, 'ENFORCED');
  assert.equal(handoff.enforcement.allowed_files, 'INSTRUCTED');
  assert.deepEqual(handoff.execution_contract, contract);
  // No Phase 4 envelope, and no invented tool list: the contract declares no tools.
  assert.deepEqual(Object.keys(handoff).sort(), [
    'enforcement',
    'execution_contract',
    'fresh_session_required',
    'model',
    'role',
    'target',
  ]);
});

test('subagents adapter — a host-independent contract still reports its own truth', () => {
  const contract = contractFor('release action with release explicitly admitted');
  const result = bindSubagentsTarget({ execution_contract: contract, capability_snapshot: SUBAGENTS_SNAPSHOT });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;
  assert.equal(result.handoff.role, 'implement');
  // No review is required here, so no fresh session is demanded — nothing is invented.
  assert.equal(result.handoff.fresh_session_required, false);
  // Release stays instruction-only: the target defines no hard release primitive.
  assert.equal(result.handoff.enforcement.release_forbidden, 'INSTRUCTED');
  assert.equal(result.handoff.enforcement.allowed_files, 'INSTRUCTED');
});

test('subagents adapter — refuses a parent contract instead of substituting the target', () => {
  const result = bindSubagentsTarget({
    execution_contract: contractFor('critical correction'),
    capability_snapshot: SUBAGENTS_SNAPSHOT,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual([...new Set(result.errors.map((e) => e.code))], ['CONTRACT_CONTRADICTION']);
});

test('subagents adapter — fails closed where the target cannot enforce what is required', () => {
  const requirementsCases: TaskContract['requirements'][] = [
    { enforcement: { allowed_files: 'required' } },
    { enforcement: { release_forbidden: 'required' } },
  ];
  for (const requirements of requirementsCases) {
    // The requirement travels only inside the resolved contract — resolution carried it there.
    const contract = contractRequiring('subagents implement with independent review', requirements);
    assert.deepEqual(contract.requirements, requirements);
    const result = bindSubagentsTarget({ execution_contract: contract, capability_snapshot: SUBAGENTS_SNAPSHOT });
    assert.equal(result.ok, false, JSON.stringify(requirements));
    if (result.ok) return;
    assert.deepEqual([...new Set(result.errors.map((e) => e.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  }
  // No adapter-level requirement channel exists: a smuggled one fails closed instead of binding.
  const smuggled = bindSubagentsTarget({
    execution_contract: contractFor('subagents implement with independent review'),
    capability_snapshot: SUBAGENTS_SNAPSHOT,
    requirements: { enforcement: { allowed_tools: 'required' } },
  } as unknown as Parameters<typeof bindSubagentsTarget>[0]);
  assert.equal(smuggled.ok, false);
  if (smuggled.ok) return;
  assert.deepEqual([...new Set(smuggled.errors.map((e) => e.code))], ['INVALID_TASK_CONTRACT']);
});

test('subagents adapter — owns no child lifecycle and imports no runtime bridge', () => {
  const source = readFileSync(new URL('./subagents-adapter.ts', import.meta.url), 'utf8');
  // No pi-subagents API is assumed: there is no authorized runtime bridge in this repository, so
  // the adapter is the pure Charter-side translation boundary and nothing more.
  const sources: string[] = [...source.matchAll(/from '([^']+)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  assert.ok(sources.length > 0, 'the adapter must import the core truth it translates');
  for (const path of sources) {
    assert.equal(/subagents\/runtime|pi-subagents|intercom|pi-/.test(path), false, `forbidden import '${path}'`);
    assert.equal(path.startsWith('../../core/'), true, `unexpected dependency '${path}'`);
  }
  // No lifecycle, timer, clock, or randomness lives in the adapter itself.
  for (const forbidden of ['async ', 'await ', 'Promise', 'setTimeout', 'setInterval', 'Date.now', 'Math.random', 'child_process']) {
    assert.equal(source.includes(forbidden), false, `subagents adapter must not contain '${forbidden}'`);
  }
});
