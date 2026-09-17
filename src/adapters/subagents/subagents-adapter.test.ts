import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../../core/authority/binder.ts';
import type { TaskContract } from '../../core/contracts/task-contract.ts';
import { bindExecutionTarget, type TargetBinding } from '../../core/enforcement/target-binding.ts';
import { resolveExecutionContract } from '../../core/resolver/resolve.ts';
import { bindSubagentsTarget } from './subagents-adapter.ts';

const MODEL = 'adapter-model';

function task(target: 'parent' | 'subagents', withPolicy = false): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: `adapter-${target}`, class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: target,
    root: '/projects/adapter',
    authority: { sources: ['spec'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V1' },
    ...(withPolicy ? { execution_policy: { allowed_tools: ['read', 'edit'] } } : {}),
  };
}

function binding(target: 'parent' | 'subagents', withPolicy = false): TargetBinding {
  const resolved = resolveExecutionContract(task(target, withPolicy), {
    authorityBinder: createAuthorityBinder({ spec: { revision: 1 } }),
    profile: { workhorse: { preferred: MODEL, fallback: [] } },
    available: [MODEL],
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) throw new Error('fixture failed to resolve');
  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_claim: {
      name: target,
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

test('subagents adapter projects already-bound truth into bounded handoff parameters', () => {
  const canonical = binding('subagents');
  const result = bindSubagentsTarget(canonical);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const handoff = result.handoff;
  assert.equal(handoff.target, 'subagents');
  assert.equal(handoff.role, canonical.execution_contract.role);
  assert.deepEqual(handoff.scope, canonical.execution_contract.scope);
  assert.deepEqual(handoff.permissions, canonical.execution_contract.permissions);
  assert.equal(handoff.model, canonical.execution_contract.model.resolved);
  assert.deepEqual(handoff.enforcement, canonical.enforcement);
  assert.deepEqual(handoff.capability_evidence, canonical.capability_evidence);
});

test('subagents adapter carries declared tool policy and acceptance commands without inventing them', () => {
  const result = bindSubagentsTarget(binding('subagents', true));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.handoff.allowed_tools, ['read', 'edit']);
  assert.deepEqual(result.handoff.acceptance_commands, ['npm test']);
  assert.equal(result.handoff.routing.truth, 'REQUIREMENT_ONLY');
});

test('subagents adapter refuses a parent binding instead of substituting targets', () => {
  const result = bindSubagentsTarget(binding('parent'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.code === 'CONTRACT_CONTRADICTION'), true);
});
