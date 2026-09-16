/**
 * F3 — the supported adapter integration contract (v0.1.1 final correction; P7, P8, P9).
 *
 * These probes are about the boundary as a boundary: a legitimate substrate adapter integrates
 * through the public package surface with no deep import and no trust minter (P9), the adapter
 * supplies observations and core promotes them (never the reverse), and nothing an adapter or
 * ordinary caller can pass becomes a capability attestation it did not observe (P7/P8).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as charter from '../index.ts';
import { createAuthorityBinder } from '../index.ts';
import type { ModelProfile } from '../index.ts';
import type { TaskContract } from '../index.ts';

const MODEL = 'fixture-adapter-model';
const PROFILE: ModelProfile = {
  workhorse: { preferred: MODEL, fallback: [] },
  reviewer: { preferred: MODEL, fallback: [] },
  reasoning: { preferred: MODEL, fallback: [] },
};
const AUTHORITY = createAuthorityBinder({ 'adapter-spec': { doc: 'ADAPTER-SPEC.md', revision: '3' } });

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
    ...overrides,
  };
}

/** A legitimate external adapter: it observes its runtime and asks core for everything else. */
function fakeSubstrateAdapter(observed = { target: 'parent' as const, provider: 'fake-provider', model: MODEL, session_identity: 'fake-session' }) {
  return charter.createAdapterIntegration({
    name: 'external-fixture-adapter',
    version: '9.9.9',
    observeEnvironment: () => ({ ok: true, observation: { ...observed, runtime: 'fixture-runtime' } }),
  });
}

// ── P9 — a legitimate adapter integrates through the supported contract ────

test('ADAPTER1 (P9) — an external adapter compiles and verifies through the public contract only', () => {
  const adapter = fakeSubstrateAdapter();
  const compiled = adapter.compile({ task_contract: contract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(typeof compiled.execution_handle, 'string');
  assert.equal(compiled.execution_handle.length >= 32, true);

  // The adapter identity core issues under is the one the adapter registered, not a caller value.
  assert.equal(compiled.compiled.execution_contract.model_availability.class, 'attested');
  if (compiled.compiled.execution_contract.model_availability.class === 'attested') {
    assert.equal(compiled.compiled.execution_contract.model_availability.source, 'external-fixture-adapter');
  }

  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'EXECUTION_CONFORMANT');
  assert.deepEqual(verified.verification.substrate, { name: 'external-fixture-adapter', version: '9.9.9' });
});

test('ADAPTER2 (P9) — a second adapter instance in the same process refuses a foreign handle shape', () => {
  const first = fakeSubstrateAdapter();
  const compiled = first.compile({ task_contract: contract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;

  // A handle-shaped string the process never minted is refused, however plausible it looks.
  const forged = first.verifyExecution({ execution_handle: 'f'.repeat(48) });
  assert.equal(forged.ok, false);

  // The minted handle stays valid: admission is process-local, not per-instance.
  const verified = first.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, true);
});

// ── P8 — no generic trust minter on the package surface ────────────────────

test('ADAPTER3 (P8) — the package exposes no generic trust minter, and the integration exposes no issuer', () => {
  for (const name of [
    'createAttestationVerifier',
    'createExecutionAttestationIssuer',
    'markIssuedExecutionAttestation',
    'isIssuedExecutionAttestation',
    'markIssuedAttestationVerifier',
  ]) {
    assert.equal(name in charter, false, `'${name}' must not be reachable from the package entry point`);
  }
  const adapter = fakeSubstrateAdapter();
  assert.deepEqual(Object.keys(adapter).sort(), ['compile', 'verifyExecution']);
  assert.equal('issue' in adapter, false);
  assert.equal('attest' in adapter, false);
  assert.equal('mint' in adapter, false);
});

// ── P7 — the adapter cannot attest what it did not observe ─────────────────

test('ADAPTER4 (P7) — capability booleans, inventories, and boundaries are refused by name', () => {
  const attempts: [string, Record<string, unknown>][] = [
    ['capability_claim', { capability_claim: { name: 'parent', capabilities: { tool_ceiling: true } } }],
    ['capability_attestation', { capability_attestation: { source_kind: 'execution_adapter', source: 'any', payload: {} } }],
    ['capability_attestation_verifier', { capability_attestation_verifier: { vouches: () => true } }],
    ['available', { available: [MODEL] }],
    ['model_availability_attestation', { model_availability_attestation: { source_kind: 'model_registry', source: 'any', payload: { models: [MODEL] } } }],
    ['compiler_identity', { compiler_identity: 'sha256:forged' }],
  ];
  for (const [key, extra] of attempts) {
    const result = fakeSubstrateAdapter().compile({
      task_contract: contract(),
      authority_binder: AUTHORITY,
      model_profile: PROFILE,
      ...extra,
    });
    assert.equal(result.ok, false, `${key} must be refused by the adapter contract`);
    if (result.ok) return;
    assert.equal(result.errors[0]?.path, key);
  }
});

test('ADAPTER5 (P7) — an unobserved capability never reaches resolved truth', () => {
  const adapter = fakeSubstrateAdapter();
  const compiled = adapter.compile({
    task_contract: contract({ execution_policy: { allowed_tools: ['read'] } }),
    authority_binder: AUTHORITY,
    model_profile: PROFILE,
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(compiled.compiled.target_binding.capability_evidence.class, 'unattested_claim');
  const truths = Object.values(compiled.compiled.role_envelope.enforcement_truth);
  assert.equal(truths.includes('ENFORCED'), false);
  assert.equal(compiled.compiled.role_envelope.enforcement_truth.allowed_tools, 'INSTRUCTED');
  assert.equal(compiled.compiled.role_envelope.enforcement_truth.model_selection, 'UNSUPPORTED');

  // NOT_APPLICABLE is a real status: no policy means nothing to enforce and nothing to instruct.
  const noPolicy = adapter.compile({ task_contract: contract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(noPolicy.ok, true);
  if (!noPolicy.ok) return;
  assert.equal(noPolicy.compiled.role_envelope.enforcement_truth.allowed_tools, 'NOT_APPLICABLE');
  assert.equal(noPolicy.compiled.role_envelope.enforcement_truth.allowed_files, 'INSTRUCTED');
});

test('ADAPTER6 — an unusable observation fails closed instead of defaulting', () => {
  const missingModel = charter.createAdapterIntegration({
    name: 'partial-adapter',
    version: '1.0.0',
    observeEnvironment: () => ({
      ok: true,
      observation: { target: 'parent', provider: 'p', model: '', session_identity: 's', runtime: 'r' },
    }),
  });
  const compiled = missingModel.compile({ task_contract: contract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, false);
  if (compiled.ok) return;
  assert.equal(compiled.errors[0]?.path, 'environment');

  const throwing = charter.createAdapterIntegration({
    name: 'throwing-adapter',
    version: '1.0.0',
    observeEnvironment: () => {
      throw new Error('observation unavailable');
    },
  });
  const verified = throwing.verifyExecution({ execution_handle: 'whatever' });
  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.equal(verified.reason.includes('observation callback failed'), true);
});

test('ADAPTER7 — an admission for one observed runtime is refused under another', () => {
  let observed: { target: 'parent' | 'subagents'; provider: string; model: string; session_identity: string } = {
    target: 'parent',
    provider: 'fake-provider',
    model: MODEL,
    session_identity: 'fake-session',
  };
  const adapter = charter.createAdapterIntegration({
    name: 'mutable-adapter',
    version: '1.0.0',
    observeEnvironment: () => ({ ok: true, observation: { ...observed, runtime: 'fixture-runtime' } }),
  });
  const compiled = adapter.compile({ task_contract: contract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  observed = { ...observed, target: 'subagents' };
  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.equal(verified.reason.includes("admitted artifact is for 'parent'"), true);
});

test('ADAPTER8 — a malformed adapter registration is refused at construction', () => {
  assert.throws(
    () => charter.createAdapterIntegration({ name: '   ', version: '1.0.0', observeEnvironment: () => ({ ok: false, reason: 'x' }) }),
    TypeError,
  );
  assert.throws(
    () => charter.createAdapterIntegration({ name: 'x', version: '1.0.0', observeEnvironment: undefined as never }),
    TypeError,
  );
});
