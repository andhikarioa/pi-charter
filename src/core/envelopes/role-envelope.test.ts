import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../authority/binder.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import { bindExecutionTarget, type TargetBinding } from '../enforcement/target-binding.ts';
import { resolveExecutionContract } from '../resolver/resolve.ts';
import { compileRoleEnvelope, renderRoleEnvelope } from './role-envelope.ts';

const ROOT = '/projects/role-envelope';
const MODEL = 'fixture-model';
const AUTHORITY = createAuthorityBinder({ spec: { doc: 'SPEC.md', revision: 1 } });

function task(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'role-envelope', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['spec'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V1' },
    ...overrides,
  };
}

function binding(contract: TaskContract = task()): TargetBinding {
  const resolved = resolveExecutionContract(contract, {
    authorityBinder: AUTHORITY,
    profile: {
      workhorse: { preferred: MODEL, fallback: [] },
      reviewer: { preferred: MODEL, fallback: [] },
      reasoning: { preferred: MODEL, fallback: [] },
    },
    available: [MODEL],
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) throw new Error('fixture failed to resolve');
  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_claim: {
      name: contract.execution_target,
      capabilities: {
        model_selection: false,
        fresh_session: false,
        tool_ceiling: false,
        file_scope_enforcement: false,
        independent_review: false,
      },
    },
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) throw new Error('fixture failed to bind');
  return bound.binding;
}

test('instruction artifact is thin and does not clone canonical governance state', () => {
  const envelope = compileRoleEnvelope(binding());
  assert.deepEqual(Object.keys(envelope).sort(), [
    'execution_contract_identity',
    'execution_target',
    'instruction_identity',
    'objective',
    'operating_rules',
    'prohibitions',
    'rendered_instruction',
    'role',
    'stop_conditions',
    'target_binding_identity',
    'task_id',
    'version',
  ]);
  for (const removed of ['scope', 'permissions', 'authority', 'jurisdiction', 'enforcement_truth', 'capability_evidence', 'acceptance', 'correction_targets']) {
    assert.equal(removed in envelope, false, `${removed} belongs to canonical resolved truth, not the instruction artifact`);
  }
});

test('rendered instruction derives boundaries from canonical contract and truth from target binding', () => {
  const envelope = compileRoleEnvelope(binding());
  const rendered = renderRoleEnvelope(envelope);
  assert.match(rendered, /implementation: bounded/);
  assert.match(rendered, /mutation\.repository: write/);
  assert.match(rendered, /release is not authorized/);
  assert.match(rendered, /model_selection: UNSUPPORTED/);
  assert.match(rendered, /allowed_tools: NOT_APPLICABLE/);
});

test('review instruction remains read-only without a Jurisdiction object', () => {
  const review = task({
    task: { id: 'review', class: 'T2', risk: 'medium' },
    role: 'review',
    permissions: { code_write: false, research: false, external_write: false, release: false },
    acceptance: { review: { required: true, independence: 'none', executor: 'same_session' } },
  });
  const envelope = compileRoleEnvelope(binding(review));
  const rendered = renderRoleEnvelope(envelope);
  assert.match(rendered, /implementation: none/);
  assert.match(rendered, /mutation\.repository: none/);
  assert.match(rendered, /review is same-session; this is NOT independent review/);
  assert.equal(envelope.prohibitions.some((line) => line.includes('modify repository content')), true);
});

test('instruction compilation is deterministic', () => {
  const bound = binding();
  const first = compileRoleEnvelope(bound);
  const second = compileRoleEnvelope(bound);
  assert.deepEqual(first, second);
  assert.equal(first.instruction_identity, second.instruction_identity);
  assert.equal(Object.isFrozen(first), true);
});
