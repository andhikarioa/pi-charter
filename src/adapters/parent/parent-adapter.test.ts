import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createAuthorityBinder } from '../../core/authority/binder.ts';
import type { ExecutionContract } from '../../core/contracts/execution-contract.ts';
import type { TaskContract } from '../../core/contracts/task-contract.ts';
import { resolveExecutionContract, type ResolverEnv } from '../../core/resolver/resolve.ts';
import { POSITIVE_CONTRACTS } from '../../core/validation/fixtures.ts';
import type { ExecutionTargetCapabilitySnapshot } from '../../core/enforcement/target-binding.ts';
import { bindParentTarget } from './parent-adapter.ts';

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
const PARENT_SNAPSHOT: ExecutionTargetCapabilitySnapshot = {
  name: 'parent',
  capabilities: {
    model_selection: true,
    fresh_session: false,
    tool_ceiling: false,
    file_scope_enforcement: false,
    independent_review: false,
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

test('parent adapter — binds a parent contract without any subagents runtime', () => {
  const contract = contractFor('critical correction');
  const result = bindParentTarget({ execution_contract: contract, capability_snapshot: PARENT_SNAPSHOT });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;
  assert.equal(result.handoff.target, 'parent');
  assert.deepEqual(Object.keys(result.handoff).sort(), ['enforcement', 'execution_contract', 'target']);
  assert.equal(result.handoff.enforcement.model_selection, 'ENFORCED');
  assert.equal(result.handoff.enforcement.allowed_tools, 'INSTRUCTED');
  // A handoff is a binding, not a session: it exposes no handle, no step, and no state.
  assert.deepEqual(result.handoff.execution_contract, contract);
  assert.notEqual(result.handoff.execution_contract, contract);
});

test('parent adapter — refuses a subagents contract instead of substituting the target', () => {
  const contract = contractFor('subagents implement with independent review');
  // A snapshot that truthfully describes the subagents target: the core binds it, and it is the
  // adapter that must refuse rather than serve a target the contract did not select.
  const subagentsSnapshot: ExecutionTargetCapabilitySnapshot = {
    name: 'subagents',
    capabilities: {
      model_selection: true,
      fresh_session: true,
      tool_ceiling: true,
      file_scope_enforcement: false,
      independent_review: true,
    },
  };
  const result = bindParentTarget({ execution_contract: contract, capability_snapshot: subagentsSnapshot });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual([...new Set(result.errors.map((e) => e.code))], ['CONTRACT_CONTRADICTION']);
  assert.deepEqual(result.errors.map((e) => e.path), ['execution_target']);
});

test('parent adapter — refuses what the parent target cannot enforce', () => {
  // The hard requirement is carried by resolution onto the contract itself; the adapter receives
  // it only inside the resolved contract and owns no requirements parameter of its own.
  const contract = contractRequiring('critical correction', { enforcement: { allowed_tools: 'required' } });
  assert.equal(contract.requirements?.enforcement?.allowed_tools, 'required');
  const result = bindParentTarget({ execution_contract: contract, capability_snapshot: PARENT_SNAPSHOT });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual([...new Set(result.errors.map((e) => e.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  // No adapter-level requirement channel exists: a smuggled one fails closed instead of binding.
  const smuggled = bindParentTarget({
    execution_contract: contract,
    capability_snapshot: PARENT_SNAPSHOT,
    requirements: { enforcement: { model_selection: 'required' } },
  } as unknown as Parameters<typeof bindParentTarget>[0]);
  assert.equal(smuggled.ok, false);
  if (smuggled.ok) return;
  assert.deepEqual([...new Set(smuggled.errors.map((e) => e.code))], ['INVALID_TASK_CONTRACT']);
});

test('parent adapter — depends on the Phase 3 core only, and no other adapter or runtime', () => {
  // Static architectural guard: the parent target must work with zero subagents dependency.
  const source = readFileSync(new URL('./parent-adapter.ts', import.meta.url), 'utf8');
  const sources: string[] = [...source.matchAll(/from '([^']+)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  assert.ok(sources.length > 0, 'the adapter must import the core binding it uses');
  for (const path of sources) {
    assert.equal(/subagents|intercom|pi-/.test(path), false, `the parent adapter must not depend on '${path}'`);
    assert.equal(path.startsWith('../../core/'), true, `unexpected dependency '${path}'`);
  }
  // And no lifecycle, timer, clock, or randomness lives in the adapter itself.
  for (const forbidden of ['async ', 'await ', 'Promise', 'setTimeout', 'setInterval', 'Date.now', 'Math.random', 'child_process']) {
    assert.equal(source.includes(forbidden), false, `parent adapter must not contain '${forbidden}'`);
  }
});
