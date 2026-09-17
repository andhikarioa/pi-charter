/**
 * CN1/CN2 — bounded delegation compilation (v0.1.2 Wave 1).
 *
 * The product claim under test is the one the dogfood found missing: a `subagents` contract compiles
 * into bounded, usable delegation authority WITHOUT this process claiming anything about a child
 * runtime it never observed. So the tests come in two halves:
 *
 *   the handoff is complete enough to dispatch from (role, root, scope, permissions, fresh, routing,
 *   acceptance commands, authority identity), and
 *   every stronger claim is absent or explicitly weaker — no execution handle, no attested
 *   capability, no child model, no runtime attestation, no `ENFORCED`.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { compileDelegation } from './compile-delegation.ts';
import type { TaskContract } from '../core/contracts/task-contract.ts';
import { createAuthorityBinder } from '../core/authority/binder.ts';
import { normalizeOperatorRequest } from '../operator/operator-request.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';

const ROOT = '/projects/tasklet';
const MODEL = 'test-workhorse';
const PROFILE: ModelProfile = { workhorse: { preferred: MODEL, fallback: [] } };

/** The Wave 1B delegation shape: bounded storage implementation, no review, declared gates. */
function delegationContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'wave-1b-store', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'subagents',
    root: ROOT,
    authority: { sources: ['tasklet-build-plan'] },
    scope: { directories: ['internal/store/**'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['go test ./internal/store/...', 'go vet ./internal/store/...'] },
    verification: { level: 'V1' },
    ...overrides,
  };
}

function compile(contract: TaskContract, fresh: 'REQUIRED' | 'NOT_REQUIRED' = 'REQUIRED') {
  return compileDelegation({
    task_contract: contract,
    authority_binder: createAuthorityBinder({ 'tasklet-build-plan': 'plan-text' }),
    model_profile: PROFILE,
    available: [MODEL],
    fresh_context: fresh,
  });
}

test('CN1 — a subagents contract compiles to a READY handoff without child-runtime attestation', () => {
  const result = compile(delegationContract());
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;

  assert.equal(result.status, 'HANDOFF_READY');
  assert.deepEqual(result.truth, {
    authority: 'BOUND',
    handoff: 'HANDOFF_READY',
    runtime_attested: false,
    execution_proof: 'UNAVAILABLE',
  });
  // No handle: a child this process cannot observe is never admitted for execution here.
  assert.equal('execution_handle' in result, false);
  assert.equal('execution_handle' in result.handoff, false);
  // The artifacts themselves are the canonical ones — the delegation path composes nothing new.
  assert.equal(result.compiled.execution_contract.execution_target, 'subagents');
  assert.equal(result.compiled.resolution_receipt.role, 'implement');
});

test('CN1 — the handoff preserves exactly the bounded authority that was compiled', () => {
  const result = compile(delegationContract());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const handoff = result.handoff;

  assert.equal(handoff.target, 'subagents');
  assert.equal(handoff.role, 'implement');
  assert.equal(handoff.root, ROOT);
  assert.deepEqual(handoff.scope, { directories: ['internal/store/**'] });
  assert.deepEqual(handoff.permissions, {
    code_write: true,
    research: false,
    external_write: false,
    release: false,
  });
  assert.deepEqual(handoff.acceptance_commands, ['go test ./internal/store/...', 'go vet ./internal/store/...']);
  // The operator required a fresh session and no review is declared, so the ONE dispatch freshness
  // truth is true: `fresh_context` and `fresh_session_required` are two spellings of it, never two
  // answers (F1).
  assert.equal(handoff.fresh_context, 'REQUIRED');
  assert.equal(handoff.fresh_session_required, true);
  assert.deepEqual(handoff.allowed_tools, []);
  // Authority identity: the reference and the provenance resolution bound to it.
  assert.deepEqual(handoff.authority.bound_sources, ['tasklet-build-plan']);
  assert.equal(handoff.authority.provenance.length, 1);
  assert.equal(handoff.authority.provenance[0]?.reference, 'tasklet-build-plan');
  assert.match(handoff.authority.provenance[0]?.content_digest ?? '', /^[0-9a-f]{64}$/);
  // The resolved contract travels as a value, so a dispatcher can hand it to the child verbatim.
  assert.deepEqual(handoff.execution_contract, result.compiled.execution_contract);
});

test('CN2 — routing is a REQUIREMENT, and the model in the handoff is not child-model truth', () => {
  const result = compile(delegationContract());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.handoff.routing, { tier: 'workhorse', truth: 'REQUIREMENT_ONLY' });
  // The identity the environment admitted is carried, and it is recorded as a CLAIM, not as an
  // attested inventory of a child runtime.
  assert.equal(result.handoff.model, MODEL);
  assert.equal(result.compiled.execution_contract.model_availability.class, 'unattested_claim');
  assert.equal(result.compiled.resolution_receipt.model_availability_evidence.class, 'unattested_claim');
});

test('CN1 — nothing about the child is attested, and no constraint reaches ENFORCED', () => {
  const result = compile(delegationContract({ execution_policy: { allowed_tools: ['read', 'edit'] } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.handoff.capability_evidence.class, 'unattested_claim');
  assert.equal(result.compiled.resolution_receipt.capability_evidence.class, 'unattested_claim');
  assert.deepEqual(Object.values(result.handoff.enforcement).filter((truth) => truth === 'ENFORCED'), []);
  // A declared tool policy with no observed capability is INSTRUCTED: the policy applies, the
  // enforcement is not proven.
  assert.equal(result.handoff.enforcement.allowed_tools, 'INSTRUCTED');
  assert.deepEqual(result.handoff.allowed_tools, ['read', 'edit']);
  assert.equal(result.compiled.target_binding.enforcement.allowed_tools, 'INSTRUCTED');
});

test('CN1 — a contract state this surface cannot establish is refused, never softened', () => {
  // Only the delegation target is compiled here: the parent target is compiled by the session that
  // executes it, which is the path that holds the observation and the admission.
  const parent = compileDelegation({
    task_contract: delegationContract({ execution_target: 'parent' }),
    authority_binder: createAuthorityBinder({ 'tasklet-build-plan': 'plan-text' }),
    model_profile: PROFILE,
    available: [MODEL],
  });
  assert.equal(parent.ok, false);
  if (!parent.ok) assert.deepEqual([...new Set(parent.errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);

  // A fresh-session review is a capability requirement. No child capability is attested here, so the
  // canonical Phase 3 gate refuses it with the canonical error rather than pretending it is planned.
  const review = compile(
    delegationContract({ acceptance: { commands: ['go test ./...'], review: { required: true, independence: 'none', executor: 'fresh_session' } } }),
  );
  assert.equal(review.ok, false);
  if (!review.ok) assert.deepEqual([...new Set(review.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);

  // Unknown and missing inputs fail closed before anything is compiled.
  const unknown = compileDelegation({
    task_contract: delegationContract(),
    authority_binder: createAuthorityBinder({ 'tasklet-build-plan': 'plan-text' }),
    model_profile: PROFILE,
    available: [MODEL],
    capability_claim: { name: 'subagents', capabilities: {} },
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.ok(unknown.errors[0]?.message.includes("unknown field 'capability_claim'") === true);

  const incomplete = compileDelegation({ task_contract: delegationContract() });
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) {
    assert.deepEqual(
      [...new Set(incomplete.errors.map((error) => error.path))].sort(),
      ['authority_binder', 'available', 'model_profile'],
    );
  }
});

test('F1 — the handoff carries ONE dispatch freshness truth, never two fields that contradict', () => {
  for (const fresh of ['REQUIRED', 'NOT_REQUIRED'] as const) {
    const result = compile(delegationContract(), fresh);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
    if (!result.ok) continue;
    // Both fields describe the same dispatch question, so they are mirrors of one value. A consumer
    // dispatching on either field must reach the same decision (the Wave 1B contradiction was
    // REQUIRED alongside false, which let a boolean-driven dispatcher ignore the requirement).
    assert.equal(
      result.handoff.fresh_context === 'REQUIRED',
      result.handoff.fresh_session_required,
      `fresh_context=${result.handoff.fresh_context} must agree with fresh_session_required=${result.handoff.fresh_session_required}`,
    );
    assert.equal(result.handoff.fresh_session_required, fresh === 'REQUIRED');
  }
});

/**
 * The canonical Wave 1B operator flow (CN6). This is the regression the dogfood demanded: ONE
 * normalization call and ONE delegation compile, from normal intent only.
 *
 * It fails if normal successful delegation ever requires the operator to state internals — a
 * hand-authored canonical contract, a binder object, a capability envelope, a model profile — or to
 * read Charter's own sources to find them out. The intent below is the whole input.
 */
test('CN6 — the canonical Tasklet Wave 1B delegation compiles from normal intent, with no Charter source archaeology', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-charter-tasklet-'));
  try {
    writeFileSync(join(root, 'CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md'), '# Build plan\n\nStorage only.\n', 'utf8');

    const intent = {
      task: 'Implement JSON persistence',
      role: 'implement',
      target: 'subagents',
      authority: 'CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md',
      scope: ['internal/store/**'],
      fresh: 'required',
      gates: ['go test ./internal/store/...', 'go vet ./internal/store/...'],
    };

    const normalized = normalizeOperatorRequest(intent, { cwd: root });
    assert.equal(normalized.ok, true, JSON.stringify(normalized.ok ? [] : normalized.errors));
    if (!normalized.ok) return;

    const result = compileDelegation({
      task_contract: normalized.request.task_contract,
      authority_binder: normalized.request.authority_binder,
      model_profile: PROFILE,
      available: [MODEL],
      fresh_context: normalized.request.fresh_context,
    });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
    if (!result.ok) return;

    assert.equal(result.status, 'HANDOFF_READY');
    assert.equal(result.handoff.role, 'implement');
    assert.equal(result.handoff.root, root);
    assert.deepEqual(result.handoff.scope, { directories: ['internal/store/**'] });
    assert.equal(result.handoff.fresh_context, 'REQUIRED');
    // The operator's stated requirement is the dispatch truth on both fields (F1).
    assert.equal(result.handoff.fresh_session_required, true);
    assert.deepEqual(result.handoff.routing, { tier: 'workhorse', truth: 'REQUIREMENT_ONLY' });
    assert.deepEqual(result.handoff.acceptance_commands, [
      'go test ./internal/store/...',
      'go vet ./internal/store/...',
    ]);
    assert.deepEqual(result.handoff.authority.bound_sources, ['CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md']);
    assert.equal(result.truth.runtime_attested, false);
    assert.equal(result.truth.execution_proof, 'UNAVAILABLE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
