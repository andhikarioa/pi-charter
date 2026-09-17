import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAttestationVerifier } from '../attestation/attestation.ts';
import { createAuthorityBinder, type AuthorityBinder } from '../authority/binder.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import type { ExecutionTargetCapabilities } from '../enforcement/target-binding.ts';
import type { ModelProfile } from '../routing/model-routing.ts';
import { compileForTarget } from './compile-for-target.ts';

const ROOT = '/projects/blessed-compile';
const MODEL = 'gemini-3.8-flash';
const PROFILE: ModelProfile = {
  workhorse: { preferred: MODEL, fallback: [] },
  reviewer: { preferred: MODEL, fallback: [] },
  reasoning: { preferred: MODEL, fallback: [] },
};
const AVAILABLE = [MODEL];
const CAPABLE: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: false,
  independent_review: true,
};

function contract(target: 'parent' | 'subagents' = 'parent', overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: `compile-${target}`, class: 'T1', risk: 'medium' },
    role: 'implement',
    execution_target: target,
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V2' },
    execution_policy: { allowed_tools: ['read', 'bash'] },
    ...overrides,
  };
}

function attestation(target: 'parent' | 'subagents', capabilities: ExecutionTargetCapabilities = CAPABLE) {
  return {
    source_kind: 'execution_adapter',
    source: `pi-${target}`,
    source_version: '0.1.0',
    payload: { target, capabilities },
  };
}

function input(task: TaskContract, authorityBinder: AuthorityBinder = createAuthorityBinder({ 'canonical-master': { revision: 1 } })) {
  const candidate = attestation(task.execution_target);
  return {
    task_contract: task,
    authority_binder: authorityBinder,
    model_profile: PROFILE,
    available: AVAILABLE,
    capability_attestation: candidate,
    capability_attestation_verifier: createAttestationVerifier([candidate]),
  };
}

test('parent compiles through one canonical facade into resolved truth, instruction, handoff, and receipt', () => {
  const result = compileForTarget(input(contract('parent')));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.execution_contract.execution_target, 'parent');
  assert.equal(result.compiled.target_binding.target, 'parent');
  assert.equal(result.compiled.target_handoff.target, 'parent');
  assert.equal(result.compiled.role_envelope.role, 'implement');
  assert.match(result.compiled.rendered_role_envelope, /ROLE/);
  assert.match(result.compiled.resolution_receipt.compiler_identity, /^sha256:[0-9a-f]{64}$/);
});

test('subagents handoff projects already-bound truth without changing it', () => {
  const task = contract('subagents', {
    acceptance: { commands: ['npm test'], review: { required: true, independence: 'independent', executor: 'fresh_session' } },
  });
  const result = compileForTarget(input(task));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.target_binding.enforcement.allowed_tools, 'ENFORCED');
  assert.equal(result.compiled.target_handoff.target, 'subagents');
  if (result.compiled.target_handoff.target !== 'subagents') return;
  assert.deepEqual(result.compiled.target_handoff.enforcement, result.compiled.target_binding.enforcement);
  assert.deepEqual(result.compiled.target_handoff.execution_contract, result.compiled.execution_contract);
});

test('each declared authority reference binds exactly once in a successful high-level compile', () => {
  const base = createAuthorityBinder({ a: { revision: 1 }, b: { revision: 2 } });
  const calls: string[] = [];
  const counting: AuthorityBinder = {
    bind(reference) {
      calls.push(reference);
      return base.bind(reference);
    },
  };
  const result = compileForTarget(input(contract('parent', { authority: { sources: ['a', 'b'] } }), counting));
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['a', 'b']);
});

test('receipt and instruction are projections, not duplicate canonical governance objects', () => {
  const result = compileForTarget(input(contract('parent')));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const field of ['scope', 'permissions', 'authority', 'jurisdiction', 'enforcement_truth', 'capability_evidence']) {
    assert.equal(field in result.compiled.role_envelope, false, field);
  }
  for (const field of ['validation_result', 'resolution_result', 'resolved_jurisdiction', 'resolved_permissions']) {
    assert.equal(field in result.compiled.resolution_receipt, false, field);
  }
});

test('raw capability claims never produce ENFORCED', () => {
  const result = compileForTarget({
    task_contract: contract('parent'),
    authority_binder: createAuthorityBinder({ 'canonical-master': { revision: 1 } }),
    model_profile: PROFILE,
    available: AVAILABLE,
    capability_claim: { name: 'parent', capabilities: CAPABLE },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.target_binding.capability_evidence.class, 'unattested_claim');
  assert.equal(Object.values(result.compiled.target_binding.enforcement).includes('ENFORCED'), false);
  assert.equal(result.compiled.target_binding.enforcement.allowed_tools, 'INSTRUCTED');
  assert.equal(result.compiled.target_binding.enforcement.model_selection, 'UNSUPPORTED');
});

test('caller cannot supply resolved or bound governance intermediates', () => {
  const base = input(contract('parent'));
  for (const forbidden of ['execution_contract', 'target_binding', 'role', 'model', 'permissions', 'enforcement_truth', 'resolution_receipt']) {
    const result = compileForTarget({ ...base, [forbidden]: 'forged' });
    assert.equal(result.ok, false, forbidden);
    if (!result.ok) assert.equal(result.errors.some((error) => error.path === forbidden), true);
  }
});

test('capability evidence for another target is refused, not retargeted', () => {
  const task = contract('parent');
  const candidate = attestation('subagents');
  const result = compileForTarget({
    task_contract: task,
    authority_binder: createAuthorityBinder({ 'canonical-master': { revision: 1 } }),
    model_profile: PROFILE,
    available: AVAILABLE,
    capability_attestation: candidate,
    capability_attestation_verifier: createAttestationVerifier([candidate]),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.code === 'CONTRACT_CONTRADICTION'), true);
});

test('facade is deterministic', () => {
  const first = compileForTarget(input(contract('parent')));
  const second = compileForTarget(input(contract('parent')));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.compiled.rendered_role_envelope, second.compiled.rendered_role_envelope);
  assert.equal(first.compiled.resolution_receipt.receipt_identity, second.compiled.resolution_receipt.receipt_identity);
});
