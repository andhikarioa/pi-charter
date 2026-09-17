import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../../core/authority/binder.ts';
import type { TaskContract } from '../../core/contracts/task-contract.ts';
import { bindExecutionTarget, type TargetBinding } from '../../core/enforcement/target-binding.ts';
import { resolveExecutionContract } from '../../core/resolver/resolve.ts';
import { bindParentTarget } from './parent-adapter.ts';

const MODEL = 'adapter-model';

function task(target: 'parent' | 'subagents'): TaskContract {
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
  };
}

function binding(target: 'parent' | 'subagents'): TargetBinding {
  const resolved = resolveExecutionContract(task(target), {
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

test('parent adapter consumes one already-bound parent TargetBinding without rebinding', () => {
  const canonical = binding('parent');
  const result = bindParentTarget(canonical);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.handoff, canonical);
  assert.deepEqual(result.handoff.enforcement, canonical.enforcement);
  assert.deepEqual(result.handoff.capability_evidence, canonical.capability_evidence);
});

test('parent adapter refuses a subagents binding instead of substituting targets', () => {
  const result = bindParentTarget(binding('subagents'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.code === 'CONTRACT_CONTRADICTION'), true);
});
