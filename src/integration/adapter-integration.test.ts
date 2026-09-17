import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as charter from '../index.ts';
import { createAuthorityBinder } from '../core/authority/binder.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';
import type { TaskContract } from '../core/contracts/task-contract.ts';
import {
  createAdapterIntegration,
  createHostAuthorizedAdapterIntegration,
  HOST_ADAPTER_AUTHORITY,
  type AdapterCapabilityObservationResult,
  type AdapterEnvironmentObservation,
  type AdapterIntegrationOptions,
} from './adapter-integration.ts';

const MODEL = 'fixture-adapter-model';
const PROFILE: ModelProfile = {
  workhorse: { preferred: MODEL, fallback: [] },
  reviewer: { preferred: MODEL, fallback: [] },
  reasoning: { preferred: MODEL, fallback: [] },
};
const AUTHORITY = createAuthorityBinder({ 'adapter-spec': { doc: 'ADAPTER-SPEC.md', revision: 3 } });

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'adapter-fixture', class: 'T1', risk: 'medium' },
    role: 'implement',
    execution_target: 'parent',
    root: '/projects/adapter-fixture',
    authority: { sources: ['adapter-spec'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V1' },
    execution_policy: { allowed_tools: ['read', 'bash'] },
    ...overrides,
  };
}

const OBSERVATION = {
  target: 'parent' as const,
  provider: 'fixture-provider',
  model: MODEL,
  session_identity: 'fixture-session',
  runtime: 'fixture-runtime',
};

function options(
  name = 'fixture-adapter',
  observation: AdapterEnvironmentObservation = OBSERVATION,
  capabilities?: () => AdapterCapabilityObservationResult,
): AdapterIntegrationOptions {
  return {
    name,
    version: '1.0.0',
    observeEnvironment: () => ({ ok: true, observation }),
    ...(capabilities ? { observeCapabilities: capabilities } : {}),
  };
}

function compileInput(task_contract: TaskContract = contract()) {
  return { task_contract, authority_binder: AUTHORITY, model_profile: PROFILE };
}

test('ordinary adapter surface is compile-only and owns no execution lifecycle', () => {
  const adapter = createAdapterIntegration(options());
  assert.deepEqual(Object.keys(adapter), ['compile']);
  for (const forbidden of ['verify', 'execute', 'spawn', 'retry', 'recover', 'attest', 'issue']) {
    assert.equal(forbidden in adapter, false, forbidden);
  }
});

test('ordinary adapter observations remain untrusted candidates and cannot produce ENFORCED', () => {
  const adapter = createAdapterIntegration(
    options('ordinary-all-true', OBSERVATION, () => ({
      ok: true,
      observed: {
        model_selection: true,
        fresh_session: true,
        tool_ceiling: true,
        file_scope_enforcement: true,
        independent_review: true,
      },
    })),
  );
  const result = adapter.compile(compileInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.target_binding.capability_evidence.class, 'unattested_claim');
  assert.equal(result.compiled.execution_contract.model_availability.class, 'unattested_claim');
  assert.equal(Object.values(result.compiled.target_binding.enforcement).includes('ENFORCED'), false);
});

test('host-authorized adapter may promote only capabilities it actually observed', () => {
  const adapter = createHostAuthorizedAdapterIntegration(
    options('host', OBSERVATION, () => ({
      ok: true,
      observed: { model_selection: true, tool_ceiling: true, file_scope_enforcement: false },
    })),
    HOST_ADAPTER_AUTHORITY,
  );
  const result = adapter.compile(compileInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.target_binding.capability_evidence.class, 'attested');
  assert.equal(result.compiled.execution_contract.model_availability.class, 'attested');
  assert.equal(result.compiled.target_binding.enforcement.model_selection, 'ENFORCED');
  assert.equal(result.compiled.target_binding.enforcement.allowed_tools, 'ENFORCED');
  assert.equal(result.compiled.target_binding.enforcement.allowed_files, 'INSTRUCTED');
  assert.equal(result.compiled.target_binding.enforcement.archaeology_off, 'INSTRUCTED');
  assert.equal(result.compiled.target_binding.enforcement.release_forbidden, 'INSTRUCTED');
});

test('observed false and omitted capability are distinct evidence but neither becomes ENFORCED', () => {
  const observedFalse = createHostAuthorizedAdapterIntegration(
    options('false', OBSERVATION, () => ({ ok: true, observed: { tool_ceiling: false } })),
    HOST_ADAPTER_AUTHORITY,
  ).compile(compileInput());
  const omitted = createHostAuthorizedAdapterIntegration(
    options('omitted', OBSERVATION, () => ({ ok: true, observed: {} })),
    HOST_ADAPTER_AUTHORITY,
  ).compile(compileInput());
  assert.equal(observedFalse.ok, true);
  assert.equal(omitted.ok, true);
  if (!observedFalse.ok || !omitted.ok) return;
  assert.equal(observedFalse.compiled.target_binding.enforcement.allowed_tools, 'INSTRUCTED');
  assert.equal(omitted.compiled.target_binding.enforcement.allowed_tools, 'INSTRUCTED');
  assert.notEqual(
    observedFalse.compiled.target_binding.capability_evidence.evidence_identity,
    omitted.compiled.target_binding.capability_evidence.evidence_identity,
  );
});

test('adapter with no capability observer attests no capability', () => {
  const result = createHostAuthorizedAdapterIntegration(options('no-capabilities'), HOST_ADAPTER_AUTHORITY).compile(compileInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.values(result.compiled.target_binding.enforcement).includes('ENFORCED'), false);
});

test('caller cannot supply environment evidence or trust inputs through adapter compile', () => {
  const adapter = createAdapterIntegration(options());
  for (const forbidden of [
    'available',
    'model_availability_attestation',
    'model_availability_attestation_verifier',
    'capability_claim',
    'capability_attestation',
    'capability_attestation_verifier',
    'compiler_identity',
  ]) {
    const result = adapter.compile({ ...compileInput(), [forbidden]: 'forged' });
    assert.equal(result.ok, false, forbidden);
    if (!result.ok) assert.ok(result.errors.some((error) => error.path === forbidden));
  }
});

test('runtime observation must match the contract target and active model truth', () => {
  const wrongTarget = createAdapterIntegration(options('wrong-target', { ...OBSERVATION, target: 'subagents' }));
  const targetResult = wrongTarget.compile(compileInput());
  assert.equal(targetResult.ok, false);

  const wrongModel = createAdapterIntegration(options('wrong-model', { ...OBSERVATION, model: 'other-model' }));
  const modelResult = wrongModel.compile(compileInput());
  assert.equal(modelResult.ok, false);
});

test('malformed or failed observations fail closed instead of receiving defaults', () => {
  const failed = createAdapterIntegration({
    name: 'failed-observer',
    version: '1',
    observeEnvironment: () => ({ ok: false, reason: 'runtime unavailable' }),
  });
  assert.equal(failed.compile(compileInput()).ok, false);

  const malformed = createAdapterIntegration({
    name: 'malformed-observer',
    version: '1',
    observeEnvironment: () => ({ ok: true, observation: { ...OBSERVATION, session_identity: '' } }),
  });
  assert.equal(malformed.compile(compileInput()).ok, false);
});

test('capability observer rejects unknown axes, non-booleans, and trust flags', () => {
  for (const observed of [
    { tool_ceiling: 'yes' },
    { magic_axis: true },
    { tool_ceiling: true, attested: true },
  ]) {
    const adapter = createHostAuthorizedAdapterIntegration(
      options('invalid-capability', OBSERVATION, () => ({ ok: true, observed } as unknown as AdapterCapabilityObservationResult)),
      HOST_ADAPTER_AUTHORITY,
    );
    assert.equal(adapter.compile(compileInput()).ok, false);
  }
});

test('host authorization cannot be forged by shape, copy, clone, or name', () => {
  const forgeries = [{}, { __host_adapter_authority: Symbol('fake') }, { ...HOST_ADAPTER_AUTHORITY }];
  for (const forged of forgeries) {
    assert.throws(() => createHostAuthorizedAdapterIntegration(options('pi'), forged), /host-authorized adapter/i);
  }
});

test('package surface exposes ordinary integration but not host authority or trust minters', () => {
  assert.equal(typeof charter.createAdapterIntegration, 'function');
  for (const hidden of [
    'HOST_ADAPTER_AUTHORITY',
    'createHostAuthorizedAdapterIntegration',
    'isHostAdapterAuthority',
    'createAttestationVerifier',
    'markIssuedAttestationVerifier',
  ]) {
    assert.equal(hidden in charter, false, hidden);
  }
});
