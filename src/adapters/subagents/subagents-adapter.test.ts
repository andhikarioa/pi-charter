import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createAttestationVerifier } from '../../core/attestation/attestation.ts';
import { createAuthorityBinder } from '../../core/authority/binder.ts';
import type { ExecutionContract } from '../../core/contracts/execution-contract.ts';
import type { TaskContract } from '../../core/contracts/task-contract.ts';
import type { CapabilityClaim } from '../../core/enforcement/target-binding.ts';
import { resolveExecutionContract, type ResolverEnv } from '../../core/resolver/resolve.ts';
import { ASSERTION_BINDER, CORRECTION_BINDER, POSITIVE_CONTRACTS } from '../../core/validation/fixtures.ts';
import { bindSubagentsTarget } from './subagents-adapter.ts';

const ENV: ResolverEnv = {
  authorityBinder: createAuthorityBinder({ 'canonical-master': {}, 'reviewer-findings': {} }),
  assertionBinder: ASSERTION_BINDER,
  correctionBinder: CORRECTION_BINDER,
  profile: {
    workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
    reviewer: { preferred: 'gpt-5.6-sol', fallback: [] },
    reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
  },
  available: ['gemini-3.8-flash', 'gpt-5.6-sol'],
};

/** Canonical capability fixture (Phase 3 charter §3), supplied by the environment at runtime. */
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

/** The same axes, ATTESTED by the explicit adapter identity that produces them (T2). */
const SUBAGENTS_ATTESTATION = {
  source_kind: 'execution_adapter' as const,
  source: 'pi-subagents',
  source_version: '0.1.0',
  payload: { target: 'subagents' as const, capabilities: SUBAGENTS_SNAPSHOT.capabilities },
};

/**
 * The environment's explicit attestation boundary (W1_ATTESTATION_SELF_PROMOTION): it vouches for
 * exactly the attestation this environment issues. The envelope below is a submitted candidate, and
 * this capability is the only thing that makes it trusted; a realistic adapter name is not.
 */
const ATTESTATION_VERIFIER = createAttestationVerifier([SUBAGENTS_ATTESTATION]);

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
  // A review that demands independence can only be bound to ATTESTED capability: a raw claim cannot
  // satisfy a hard capability requirement (T2).
  assert.equal(
    bindSubagentsTarget({ execution_contract: contract, capability_claim: SUBAGENTS_SNAPSHOT }).ok,
    false,
    'a raw claim must not satisfy the independent-review requirement',
  );
  const result = bindSubagentsTarget({
    execution_contract: contract,
    capability_attestation: SUBAGENTS_ATTESTATION,
    capability_attestation_verifier: ATTESTATION_VERIFIER,
  });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;
  const handoff = result.handoff;
  assert.equal(handoff.target, 'subagents');
  assert.equal(handoff.role, 'implement');
  // The resolved model identity is handed over — not the tier preference, and never a substitute.
  assert.equal(handoff.model, contract.model.resolved);
  assert.equal(handoff.model, contract.model.preferred);
  assert.equal(handoff.fresh_session_required, true);
  // Attested tool ceiling, but this contract declares no tool policy, so nothing is enforced yet (T3).
  assert.equal(handoff.enforcement.allowed_tools, 'NOT_APPLICABLE');
  assert.equal(handoff.enforcement.allowed_files, 'INSTRUCTED');
  assert.deepEqual(handoff.allowed_tools, []);
  assert.deepEqual(handoff.execution_contract, contract);
  // No Phase 4 envelope, and no invented tool list: the contract declares no tools.
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
});

test('subagents adapter — a host-independent contract still reports its own truth', () => {
  const contract = contractFor('release action with release explicitly admitted');
  const result = bindSubagentsTarget({ execution_contract: contract, capability_claim: SUBAGENTS_SNAPSHOT });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;
  assert.equal(result.handoff.role, 'implement');
  // No review is required here, so no fresh session is demanded — nothing is invented.
  assert.equal(result.handoff.fresh_session_required, false);
  // Release stays instruction-only: the target defines no hard release primitive.
  assert.equal(result.handoff.enforcement.release_forbidden, 'INSTRUCTED');
  assert.equal(result.handoff.enforcement.allowed_files, 'INSTRUCTED');
  // A claim is recorded as a claim: this run is not attributed to an attested environment (T2).
  assert.equal(result.handoff.capability_evidence.class, 'unattested_claim');
});

test('subagents adapter — refuses a parent contract instead of substituting the target', () => {
  const result = bindSubagentsTarget({
    execution_contract: contractFor('critical correction'),
    capability_claim: SUBAGENTS_SNAPSHOT,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual([...new Set(result.errors.map((e) => e.code))], ['CONTRACT_CONTRADICTION']);
});

test('subagents adapter — fails closed where the target cannot enforce what is required', () => {
  const requirementsCases: TaskContract['requirements'][] = [
    { enforcement: { allowed_files: 'required' } },
    { enforcement: { release_forbidden: 'required' } },
    // A tool ceiling with no declared tool policy has nothing to enforce, however capable the target
    // is: capability alone is never ENFORCED (T3).
    { enforcement: { allowed_tools: 'required' } },
  ];
  for (const requirements of requirementsCases) {
    // The requirement travels only inside the resolved contract — resolution carried it there.
    const contract = contractRequiring('subagents implement with independent review', requirements);
    assert.deepEqual(contract.requirements, requirements);
    const result = bindSubagentsTarget({
      execution_contract: contract,
      capability_attestation: SUBAGENTS_ATTESTATION,
      capability_attestation_verifier: ATTESTATION_VERIFIER,
    });
    assert.equal(result.ok, false, JSON.stringify(requirements));
    if (result.ok) return;
    assert.deepEqual([...new Set(result.errors.map((e) => e.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  }
  // No adapter-level requirement channel exists: a smuggled one fails closed instead of binding.
  const smuggled = bindSubagentsTarget({
    execution_contract: contractFor('subagents implement with independent review'),
    capability_attestation: SUBAGENTS_ATTESTATION,
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
