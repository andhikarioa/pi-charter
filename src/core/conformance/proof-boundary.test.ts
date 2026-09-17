import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAttestationVerifier } from '../attestation/attestation.ts';
import { createAuthorityBinder } from '../authority/binder.ts';
import { compileForTarget } from '../compile/compile-for-target.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import { createEvidenceBinder } from '../provenance/evidence.ts';

const ROOT = '/projects/proof-boundary';
const MODEL = 'proof-model';
const PROFILE = {
  workhorse: { preferred: MODEL, fallback: [] },
  reviewer: { preferred: MODEL, fallback: [] },
  reasoning: { preferred: MODEL, fallback: [] },
};

function task(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'proof-boundary', class: 'T1', risk: 'medium' },
    role: 'implement',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['spec'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V2' },
    ...overrides,
  };
}

const CAPABILITIES = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: true,
  independent_review: true,
};

function compile(
  contract: TaskContract,
  options: {
    authorityRevision?: number;
    assertionBinder?: ReturnType<typeof createEvidenceBinder>;
    correctionBinder?: {
      findings: ReturnType<typeof createEvidenceBinder>;
      acceptances: ReturnType<typeof createEvidenceBinder>;
    };
    available?: readonly string[];
    modelAvailabilityAttestation?: unknown;
    modelAvailabilityVerifier?: unknown;
    capabilityClaim?: unknown;
    capabilityAttestation?: unknown;
    capabilityVerifier?: unknown;
  } = {},
) {
  return compileForTarget({
    task_contract: contract,
    authority_binder: createAuthorityBinder({ spec: { doc: 'SPEC.md', revision: options.authorityRevision ?? 1 } }),
    ...(options.assertionBinder ? { assertion_binder: options.assertionBinder } : {}),
    ...(options.correctionBinder ? { correction_binder: options.correctionBinder } : {}),
    model_profile: PROFILE,
    ...(options.modelAvailabilityAttestation !== undefined
      ? {
          model_availability_attestation: options.modelAvailabilityAttestation,
          ...(options.modelAvailabilityVerifier !== undefined
            ? { model_availability_attestation_verifier: options.modelAvailabilityVerifier }
            : {}),
        }
      : { available: options.available ?? [MODEL] }),
    ...(options.capabilityAttestation !== undefined
      ? {
          capability_attestation: options.capabilityAttestation,
          ...(options.capabilityVerifier !== undefined
            ? { capability_attestation_verifier: options.capabilityVerifier }
            : {}),
        }
      : {
          capability_claim:
            options.capabilityClaim ?? { name: contract.execution_target, capabilities: CAPABILITIES },
        }),
  });
}

test('authority reference alone is not identity: changed bound content changes canonical contract and receipt identity', () => {
  const first = compile(task(), { authorityRevision: 1 });
  const changed = compile(task(), { authorityRevision: 2 });
  assert.equal(first.ok, true);
  assert.equal(changed.ok, true);
  if (!first.ok || !changed.ok) return;
  assert.deepEqual(first.compiled.execution_contract.authority.bound_sources, changed.compiled.execution_contract.authority.bound_sources);
  assert.notEqual(
    first.compiled.execution_contract.authority.provenance[0]?.content_digest,
    changed.compiled.execution_contract.authority.provenance[0]?.content_digest,
  );
  assert.notEqual(first.compiled.resolution_receipt.execution_contract_identity, changed.compiled.resolution_receipt.execution_contract_identity);
  assert.notEqual(first.compiled.resolution_receipt.receipt_identity, changed.compiled.resolution_receipt.receipt_identity);
});

test('declared assertion without a verifier binding fails closed', () => {
  const contract = task({ acceptance: { assertions: ['must-pass'] } });
  const missing = compile(contract);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors.some((error) => error.code === 'ACCEPTANCE_INVALID'), true);

  const admitted = compile(contract, { assertionBinder: createEvidenceBinder({ 'must-pass': 'check:must-pass' }) });
  assert.equal(admitted.ok, true);
  if (!admitted.ok) return;
  assert.equal(admitted.compiled.execution_contract.assertion_bindings[0]?.reference, 'must-pass');
  assert.equal(admitted.compiled.execution_contract.assertion_bindings[0]?.verifier, 'check:must-pass');
});

test('a correction blocker identifier alone is not correction authority', () => {
  const correction = task({
    task: { id: 'correct', class: 'T3', risk: 'high' },
    role: 'correct',
    scope: { files: ['src/feature.ts'], blockers: ['finding-1'] },
  });
  const missing = compile(correction);
  assert.equal(missing.ok, false);

  const accepted = compile(correction, {
    correctionBinder: {
      findings: createEvidenceBinder({ 'finding-1': 'review:finding-1' }),
      acceptances: createEvidenceBinder({ 'finding-1': 'user:accepted-finding-1' }),
    },
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.compiled.execution_contract.correction_targets.length, 1);
  assert.match(accepted.compiled.rendered_role_envelope, /finding-1/);
  assert.match(accepted.compiled.rendered_role_envelope, /accepted by/);
});

test('raw model availability is explicitly recorded as an unattested claim', () => {
  const result = compile(task());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.execution_contract.model_availability.class, 'unattested_claim');
  assert.equal(result.compiled.resolution_receipt.model_availability_evidence.class, 'unattested_claim');
});

test('trusted model-registry evidence is distinct from a submitted attestation-shaped object', () => {
  const candidate = {
    source_kind: 'model_registry',
    source: 'fixture-registry',
    source_version: '1',
    payload: { models: [MODEL] },
  };
  const untrusted = compile(task(), { modelAvailabilityAttestation: candidate });
  assert.equal(untrusted.ok, true);
  if (!untrusted.ok) return;
  assert.equal(untrusted.compiled.execution_contract.model_availability.class, 'unattested_claim');

  const trusted = compile(task(), {
    modelAvailabilityAttestation: candidate,
    modelAvailabilityVerifier: createAttestationVerifier([candidate]),
  });
  assert.equal(trusted.ok, true);
  if (!trusted.ok) return;
  assert.equal(trusted.compiled.execution_contract.model_availability.class, 'attested');
});

test('fake trust-boundary shapes are refused rather than promoted', () => {
  const candidate = {
    source_kind: 'execution_adapter',
    source: 'pi-parent',
    source_version: '1',
    payload: { target: 'parent', capabilities: CAPABILITIES },
  };
  for (const fake of [() => true, { vouches: () => true }]) {
    const result = compile(task(), { capabilityAttestation: candidate, capabilityVerifier: fake });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors.some((error) => error.path === 'capability_attestation_verifier'), true);
  }
});

test('trusted runtime capability evidence may ground ENFORCED only for applicable policy', () => {
  const contract = task({ execution_policy: { allowed_tools: ['read'] } });
  const candidate = {
    source_kind: 'execution_adapter',
    source: 'pi-parent',
    source_version: '1',
    payload: { target: 'parent', capabilities: CAPABILITIES },
  };
  const result = compile(contract, {
    capabilityAttestation: candidate,
    capabilityVerifier: createAttestationVerifier([candidate]),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.target_binding.capability_evidence.class, 'attested');
  assert.equal(result.compiled.target_binding.enforcement.model_selection, 'ENFORCED');
  assert.equal(result.compiled.target_binding.enforcement.allowed_tools, 'ENFORCED');
  assert.equal(result.compiled.target_binding.enforcement.allowed_files, 'ENFORCED');
});

test('changing only a caller claim cannot manufacture hard enforcement', () => {
  const result = compile(task({ execution_policy: { allowed_tools: ['read'] } }), {
    capabilityClaim: { name: 'parent', capabilities: CAPABILITIES },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.target_binding.capability_evidence.class, 'unattested_claim');
  assert.equal(Object.values(result.compiled.target_binding.enforcement).includes('ENFORCED'), false);
});
