import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../authority/binder.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import { bindExecutionTarget, type TargetBinding } from '../enforcement/target-binding.ts';
import { resolveExecutionContract } from '../resolver/resolve.ts';
import { createResolutionReceipt, RECEIPT_CONTRACT_VERSION } from './resolution-receipt.ts';

const MODEL = 'fixture-model';
const COMPILER = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function task(): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'receipt', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'parent',
    root: '/projects/receipt',
    authority: { sources: ['spec'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V1' },
  };
}

function binding(authorityRevision = 1): TargetBinding {
  const resolved = resolveExecutionContract(task(), {
    authorityBinder: createAuthorityBinder({ spec: { doc: 'SPEC.md', revision: authorityRevision } }),
    profile: { workhorse: { preferred: MODEL, fallback: [] } },
    available: [MODEL],
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) throw new Error('fixture failed to resolve');
  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
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
  assert.equal(bound.ok, true);
  if (!bound.ok) throw new Error('fixture failed to bind');
  return bound.binding;
}

test('receipt is a compact projection of already-established compile truth', () => {
  const receipt = createResolutionReceipt({ compiler_identity: COMPILER, target_binding: binding() });
  assert.equal(receipt.contract_version, RECEIPT_CONTRACT_VERSION);
  assert.deepEqual(Object.keys(receipt).sort(), [
    'authority_provenance',
    'capability_evidence',
    'compiler_identity',
    'contract_version',
    'enforcement_truth',
    'execution_contract_identity',
    'model',
    'model_availability_evidence',
    'receipt_identity',
    'role',
    'target',
    'task_id',
  ]);
  for (const removed of ['validation_result', 'resolution_result', 'resolved_jurisdiction', 'resolved_permissions', 'model_profile_identity', 'task_contract_identity']) {
    assert.equal(removed in receipt, false);
  }
});

test('receipt is deterministic and authority content changes its identity', () => {
  const first = createResolutionReceipt({ compiler_identity: COMPILER, target_binding: binding(1) });
  const repeat = createResolutionReceipt({ compiler_identity: COMPILER, target_binding: binding(1) });
  const changed = createResolutionReceipt({ compiler_identity: COMPILER, target_binding: binding(2) });
  assert.equal(first.receipt_identity, repeat.receipt_identity);
  assert.notEqual(first.execution_contract_identity, changed.execution_contract_identity);
  assert.notEqual(first.receipt_identity, changed.receipt_identity);
});

test('receipt clones evidence and is immutable', () => {
  const bound = binding();
  const receipt = createResolutionReceipt({ compiler_identity: COMPILER, target_binding: bound });
  assert.equal(Object.isFrozen(receipt), true);
  assert.notEqual(receipt.authority_provenance, bound.execution_contract.authority.provenance);
  assert.notEqual(receipt.capability_evidence, bound.capability_evidence);
});
