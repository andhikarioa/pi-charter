/**
 * CN4/CN5 — truthful operator-facing results (v0.1.2 Wave 1).
 *
 * The dogfood finding these tests pin: Charter reported `ACCEPTANCE_NOT_DECLARED` while the contract
 * declared command gates, and refusals named a code without saying whether retrying was meaningful.
 * Both were true statements in an unusable shape. The tests below hold the rendered output to the
 * separation the operator needs, and to the rule that rendering never establishes anything.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileForTarget } from '../core/compile/compile-for-target.ts';
import { createAuthorityBinder } from '../core/authority/binder.ts';
import type { TaskContract } from '../core/contracts/task-contract.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';
import { compileDelegation } from '../delegation/compile-delegation.ts';
import {
  describeAcceptance,
  renderAcceptanceLines,
  renderDelegationCompile,
  renderParentCompile,
  renderRefusal,
  renderVerification,
} from './operator-surface.ts';

const ROOT = '/projects/surface';
const MODEL = 'test-workhorse';
const PROFILE: ModelProfile = { workhorse: { preferred: MODEL, fallback: [] } };

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'surface', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'subagents',
    root: ROOT,
    authority: { sources: ['plan'] },
    scope: { directories: ['internal/store/**'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['go test ./internal/store/...'] },
    verification: { level: 'V1' },
    ...overrides,
  };
}

const BINDER = createAuthorityBinder({ plan: 'plan-text' });

test('CN4 — declared command gates are DECLARED, and verifier evidence is reported separately', () => {
  const declared = describeAcceptance({ commands: ['go test ./...'] }, []);
  assert.deepEqual(declared, {
    commands: { status: 'DECLARED', count: 1 },
    verifier_evidence: { status: 'UNAVAILABLE', assertions: 0 },
  });
  assert.deepEqual(renderAcceptanceLines(declared), [
    'Acceptance commands   DECLARED (1)',
    'Verifier evidence     UNAVAILABLE (no verifier-bound assertion is declared)',
  ]);

  const none = describeAcceptance({ review: { required: true, independence: 'none' } }, []);
  assert.equal(none.commands.status, 'NONE');
  assert.equal(none.verifier_evidence.status, 'UNAVAILABLE');
});

test('CN4 — ACCEPTANCE_NOT_DECLARED is explained as a statement about verifier evidence, not about gates', () => {
  const text = renderVerification({
    verdict: 'EXECUTION_CONFORMANT',
    acceptance: { status: 'ACCEPTANCE_NOT_DECLARED', verified: [], unverified: [] },
    deviations: [],
  });
  assert.equal(text.includes('acceptance: ACCEPTANCE_NOT_DECLARED'), true);
  assert.equal(text.includes('MACHINE-ATTESTED acceptance only'), true);
  assert.equal(text.includes('not verifier evidence and never a pass'), true);
  // A rendered status is not an upgrade: the verdict line still says what the verdict was.
  assert.equal(text.split('\n')[0], 'Charter execution verdict: EXECUTION_CONFORMANT');

  const verified = renderVerification({
    verdict: 'NON_CONFORMANT',
    acceptance: { status: 'ACCEPTANCE_NOT_VERIFIED', verified: [], unverified: [{ reference: 'bug-closed', verifier: 'verifier-x', reason: 'no trusted execution evidence was supplied' }] },
    deviations: [{ code: 'MODEL_MISMATCH', path: 'model', detail: 'the run reported another model' }],
  });
  assert.equal(verified.includes('not verified: bug-closed (verifier-x)'), true);
  assert.equal(verified.includes('MODEL_MISMATCH @ model'), true);
  assert.equal(verified.includes('MACHINE-ATTESTED'), false);
});

test('CN5 — a refusal says what failed, whether retrying is meaningful, and the minimal remedy', () => {
  const text = renderRefusal([
    { code: 'AUTHORITY_UNRESOLVED', path: 'authority', message: "no authority document 'PLAN.md' exists under root '/repo'" },
  ]);
  assert.equal(text.startsWith('REFUSED'), true);
  assert.equal(text.includes('Reason:'), true);
  assert.equal(text.includes("AUTHORITY_UNRESOLVED @ authority"), true);
  assert.equal(text.includes("no authority document 'PLAN.md' exists under root '/repo'"), true);
  assert.equal(text.includes('Retry:\nYES, after identifying exactly one authority source'), true);
  assert.equal(text.includes('Remedy:'), true);
  assert.equal(text.includes('Nothing was admitted, delegated, or executed by this refusal.'), true);
});

test('CN5 — a refusal that is not retryable says so, and no remedy widens authority', () => {
  const target = renderRefusal([{ code: 'UNSUPPORTED_BY_EXECUTION_TARGET', path: 'fresh', message: 'parent cannot require a fresh child session' }]);
  assert.equal(target.includes('Retry:\nNO, not for this contract and target'), true);
  const human = renderRefusal([{ code: 'HUMAN_DECISION_REQUIRED', path: '', message: 'ambiguity requires a human decision' }]);
  assert.equal(human.includes('Retry:\nNO, this requires a human decision'), true);
  // Codes are reported once, however many errors carry them.
  const twice = renderRefusal([
    { code: 'INVALID_TASK_CONTRACT', path: 'a', message: 'one' },
    { code: 'INVALID_TASK_CONTRACT', path: 'b', message: 'two' },
  ]);
  assert.equal(twice.split('Retry:').length, 2);
});

test('CN3 — a delegation result states the four truths separately and claims no execution handle', () => {
  const result = compileDelegation({
    task_contract: contract(),
    authority_binder: BINDER,
    model_profile: PROFILE,
    available: [MODEL],
    fresh_context: 'REQUIRED',
  });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;
  const text = renderDelegationCompile(result);
  assert.equal(text.includes('Authority     BOUND'), true);
  assert.equal(text.includes('Handoff       READY'), true);
  assert.equal(text.includes('Runtime proof UNAVAILABLE'), true);
  assert.equal(text.includes('Execution proof UNAVAILABLE'), true);
  assert.equal(text.includes('Fresh         required'), true);
  assert.equal(text.includes('Routing tier  workhorse (REQUIREMENT_ONLY)'), true);
  // The routing requirement is a requirement, never an observation: the resolved identity must not be
  // rendered as if this process had observed the child run it (the CN2 model-upgrade regression).
  assert.equal(text.includes(MODEL), false, 'the delegation panel never presents the resolved model as an observed child model');
  assert.equal(text.includes('Acceptance    commands DECLARED (1)'), true);
  assert.equal(text.includes('verifier evidence UNAVAILABLE'), true);
  assert.equal(text.includes('it holds no execution handle'), true, 'the panel says why there is no handle');
  assert.equal(text.includes('charter_verify_execution applies to the parent session only'), true);
  assert.equal(/execution_handle: [0-9a-f]{16,}/.test(text), false, 'no handle is printed, because none exists');
});

test('CN3 — a parent compile renders the admission and the acceptance truth, not a pass', () => {
  const compiled = compileForTarget({
    task_contract: contract({ execution_target: 'parent' }),
    authority_binder: BINDER,
    model_profile: PROFILE,
    available: [MODEL],
    capability_claim: {
      name: 'parent',
      capabilities: {
        model_selection: false,
        fresh_session: false,
        tool_ceiling: false,
        file_scope_enforcement: false,
        independent_review: false,
      },
    },
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.ok ? [] : compiled.errors));
  if (!compiled.ok) return;
  const text = renderParentCompile({
    compiled: compiled.compiled,
    execution_handle: 'a'.repeat(48),
  });
  assert.equal(text.includes('Admission     ADMITTED_FOR_EXECUTION'), true);
  assert.equal(text.includes(`Model         ${MODEL} (observed in this session)`), true);
  assert.equal(text.includes('Acceptance    commands DECLARED (1); verifier evidence UNAVAILABLE'), true);
  assert.equal(text.includes('admission is not execution'), true);
  assert.equal(text.includes('EXECUTION_CONFORMANT'), false);
});
