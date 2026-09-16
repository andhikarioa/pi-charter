/**
 * F3 — the supported adapter integration contract (v0.1.1 final correction; P7, P8, P9).
 *
 * These probes are about the boundary as a boundary: a legitimate substrate adapter integrates
 * through the public package surface with no deep import and no trust minter (P9), the adapter
 * supplies observations and core promotes them (never the reverse), and nothing an adapter or
 * ordinary caller can pass becomes a capability attestation it did not observe (P7/P8).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as charter from '../index.ts';
import { createAuthorityBinder } from '../index.ts';
import type { ModelProfile } from '../index.ts';
import type { TaskContract } from '../index.ts';
// The host seam. These live in the integration module and are deliberately not re-exported by
// `index.ts`: an in-package test wiring the runtime integration's position is not an ordinary package
// consumer, and reaching them from outside the package means reaching inside it.
import {
  createHostAuthorizedAdapterIntegration,
  HOST_ADAPTER_AUTHORITY,
} from './adapter-integration.ts';

const MODEL = 'fixture-adapter-model';

function profileFor(model: string): ModelProfile {
  return {
    workhorse: { preferred: model, fallback: [] },
    reviewer: { preferred: model, fallback: [] },
    reasoning: { preferred: model, fallback: [] },
  };
}

const PROFILE: ModelProfile = profileFor(MODEL);
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

/** The plain runtime observation every fixture adapter reports unless it changes it. */
const FIXTURE_OBSERVATION = {
  target: 'parent' as const,
  provider: 'fake-provider',
  model: MODEL,
  session_identity: 'fake-session',
};

/** The adapter identity and callbacks, independent of which trust position constructs the adapter. */
function adapterOptions(
  name: string,
  observed = FIXTURE_OBSERVATION,
  capabilities?: () => charter.AdapterCapabilityObservationResult,
): charter.AdapterIntegrationOptions {
  return {
    name,
    version: '9.9.9',
    observeEnvironment: () => ({ ok: true, observation: { ...observed, runtime: 'fixture-runtime' } }),
    ...(capabilities !== undefined ? { observeCapabilities: capabilities } : {}),
  };
}

/**
 * An external adapter: a legitimate caller of the public contract, which holds no host
 * authorization. Its observations are candidates, and this is the position A1/A2/A8 are about.
 */
function fakeSubstrateAdapter(
  observed = FIXTURE_OBSERVATION,
  capabilities?: () => charter.AdapterCapabilityObservationResult,
) {
  return charter.createAdapterIntegration(adapterOptions('external-fixture-adapter', observed, capabilities));
}

/**
 * The host-authorized position: how the runtime integration the package itself wires constructs an
 * adapter, with the authority this process minted. Only this position may have observations promoted.
 */
function hostAdapter(
  observed = FIXTURE_OBSERVATION,
  capabilities?: () => charter.AdapterCapabilityObservationResult,
) {
  return createHostAuthorizedAdapterIntegration(
    adapterOptions('host-authorized-fixture-adapter', observed, capabilities),
    HOST_ADAPTER_AUTHORITY,
  );
}

/**
 * An adapter whose observed session can be switched, so a run observed in one session can be checked
 * against verification happening in another.
 */
function sessionSwitchingAdapter(initial = 'session-a') {
  let session = initial;
  const adapter = createHostAuthorizedAdapterIntegration(
    {
      name: 'execution-observer-adapter',
      version: '1.0.0',
      observeEnvironment: () => ({
        ok: true,
        observation: {
          target: 'parent',
          provider: 'fake-provider',
          model: MODEL,
          session_identity: session,
          runtime: 'fixture-runtime',
        },
      }),
    },
    HOST_ADAPTER_AUTHORITY,
  );
  return { adapter, switchTo: (next: string): void => void (session = next) };
}

// ── P9 — a legitimate adapter integrates through the supported contract ────

test('ADAPTER1 (P9) — an external adapter compiles and verifies through the supported contract only', () => {
  const adapter = hostAdapter();
  const compiled = adapter.compile({ task_contract: contract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(typeof compiled.execution_handle, 'string');
  assert.equal(compiled.execution_handle.length >= 32, true);

  // The adapter identity core issues under is the one the adapter registered, not a caller value.
  assert.equal(compiled.compiled.execution_contract.model_availability.class, 'attested');
  if (compiled.compiled.execution_contract.model_availability.class === 'attested') {
    assert.equal(compiled.compiled.execution_contract.model_availability.source, 'host-authorized-fixture-adapter');
  }

  // Admission is not execution: the runtime owner reports that it actually executed the admitted
  // artifact set, and only then is that run eligible for evidence.
  const observedExecution = adapter.observeExecution({ execution_handle: compiled.execution_handle });
  assert.equal(observedExecution.ok, true);

  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'EXECUTION_CONFORMANT');
  assert.deepEqual(verified.verification.substrate, { name: 'host-authorized-fixture-adapter', version: '9.9.9' });
});

test('ADAPTER2 (P9) — a second adapter instance in the same process refuses a foreign handle shape', () => {
  const first = fakeSubstrateAdapter();
  const compiled = first.compile({ task_contract: contract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;

  // A handle-shaped string the process never minted is refused, however plausible it looks.
  const forged = first.verifyExecution({ execution_handle: 'f'.repeat(48) });
  assert.equal(forged.ok, false);
  const forgedObservation = first.observeExecution({ execution_handle: 'f'.repeat(48) });
  assert.equal(forgedObservation.ok, false);

  // The minted handle stays valid: admission is process-local, not per-instance.
  assert.equal(first.observeExecution({ execution_handle: compiled.execution_handle }).ok, true);
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
  assert.deepEqual(Object.keys(adapter).sort(), ['compile', 'observeExecution', 'verifyExecution']);
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
  assert.equal(adapter.observeExecution({ execution_handle: compiled.execution_handle }).ok, true);
  observed = { ...observed, target: 'subagents' };
  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.equal(verified.reason.includes("admitted artifact is for 'parent'"), true);

  // The same rule governs the execution observation: a runtime this integration is not observing
  // cannot be reported as the one that executed the admitted artifact.
  const misattributed = adapter.observeExecution({ execution_handle: compiled.execution_handle });
  assert.equal(misattributed.ok, false);
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
  assert.throws(
    () =>
      charter.createAdapterIntegration({
        name: 'x',
        version: '1.0.0',
        observeEnvironment: () => ({ ok: false, reason: 'x' }),
        observeCapabilities: 'yes' as never,
      }),
    TypeError,
  );
});

// ── F1 X1–X8 — admission is not execution ─────────────────────────────────

/** A contract the fixture adapter can compile: nothing it cannot observe is required of it. */
function executableContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return contract(overrides);
}

test('X1 — compile then verify, with no observed execution: REFUSED', () => {
  const { adapter } = sessionSwitchingAdapter();
  const compiled = adapter.compile({ task_contract: executableContract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;

  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, false, 'an admitted artifact set nothing reported executing must not verify');
  if (verified.ok) return;
  assert.equal(verified.reason.includes('observed no execution'), true);
});

test('X2 — execution observed for A only, verify B: REFUSED', () => {
  const { adapter } = sessionSwitchingAdapter();
  const a = adapter.compile({ task_contract: executableContract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  const b = adapter.compile({ task_contract: executableContract({ task: { id: 'other', class: 'T1', risk: 'medium' } }), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(adapter.observeExecution({ execution_handle: a.execution_handle }).ok, true);

  const verified = adapter.verifyExecution({ execution_handle: b.execution_handle });
  assert.equal(verified.ok, false, 'B was never observed executing, so it has no execution evidence');
});

test('X3 — the admitted artifact set observed executing verifies: PASS', () => {
  const { adapter } = sessionSwitchingAdapter();
  const compiled = adapter.compile({ task_contract: executableContract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(adapter.observeExecution({ execution_handle: compiled.execution_handle }).ok, true);

  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'EXECUTION_CONFORMANT');
  assert.deepEqual(verified.verification.deviations, []);
});

test('X4 — a run observed in session A does not verify as a run of session B', () => {
  const { adapter, switchTo } = sessionSwitchingAdapter('session-a');
  const compiled = adapter.compile({ task_contract: executableContract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(adapter.observeExecution({ execution_handle: compiled.execution_handle }).ok, true);

  // Same process, same model, same target, same artifacts — a different session.
  switchTo('session-b');
  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.equal(verified.reason.includes('session-a'), true);
});

test('X5 — identical model, target, and session metadata without an execution event is not evidence', () => {
  const { adapter } = sessionSwitchingAdapter();
  const compiled = adapter.compile({ task_contract: executableContract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const noObservation = adapter.verifyExecution({
    execution_handle: compiled.execution_handle,
    resolution_receipt: compiled.compiled.resolution_receipt,
    role_envelope: compiled.compiled.role_envelope,
    execution_contract: compiled.compiled.execution_contract,
  });
  assert.equal(noObservation.ok, false, 'supplying the artifacts and matching metadata proves nothing about a run');
  // And the same artifacts with no handle at all remain a claim, not a record of admission.
  const noHandle = adapter.verifyExecution({ resolution_receipt: compiled.compiled.resolution_receipt });
  assert.equal(noHandle.ok, false);
});

test('X6 — a caller cannot forge an execution observation', () => {
  const { adapter } = sessionSwitchingAdapter();
  const compiled = adapter.compile({ task_contract: executableContract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const handle = compiled.execution_handle;

  // No boolean, no session string, no foreign event object is accepted as the execution event.
  for (const attempt of [
    { execution_handle: handle, executed: true },
    { execution_handle: handle, session_identity: 'session-a' },
    { execution_handle: handle, execution_observation: { session_identity: 'session-a' } },
  ]) {
    const verified = adapter.verifyExecution(attempt);
    assert.equal(verified.ok, false, `${Object.keys(attempt).join(',')} must not be accepted at verification`);
  }
  for (const attempt of [
    { execution_handle: handle, executed: true },
    { execution_handle: handle, session_identity: 'session-b' },
  ]) {
    assert.equal(adapter.observeExecution(attempt).ok, false, 'an execution observation names a handle and nothing else');
  }
  // And the package surface offers no free way to mark anything executed.
  for (const name of ['observeExecution', 'markExecutionObserved', 'markExecuted', 'createExecutionObservation']) {
    assert.equal(name in charter, false, `'${name}' must not be reachable from the package entry point`);
  }
});

test('X7 — a run observed for A still refuses B artifacts: NON_CONFORMANT', () => {
  const { adapter } = sessionSwitchingAdapter();
  const a = adapter.compile({ task_contract: executableContract(), authority_binder: AUTHORITY, model_profile: PROFILE });
  const b = adapter.compile({ task_contract: executableContract({ task: { id: 'other', class: 'T1', risk: 'medium' } }), authority_binder: AUTHORITY, model_profile: PROFILE });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(adapter.observeExecution({ execution_handle: a.execution_handle }).ok, true);

  const verified = adapter.verifyExecution({
    execution_handle: a.execution_handle,
    resolution_receipt: b.compiled.resolution_receipt,
    role_envelope: b.compiled.role_envelope,
    execution_contract: b.compiled.execution_contract,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'NON_CONFORMANT');
  assert.equal(verified.verification.deviations.some((deviation) => deviation.code === 'RESOLUTION_RECEIPT_MISMATCH'), true);
  assert.equal(verified.verification.deviations.some((deviation) => deviation.code === 'ROLE_ENVELOPE_MISMATCH'), true);
});

test('X8 — the execution observation adds no persistence, no clock, and no run history', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'adapter-integration.js'), 'utf8');
  for (const forbidden of [
    'child_process',
    'spawn(',
    'setTimeout',
    'setInterval',
    'writeFileSync',
    'createWriteStream',
    'Date.now',
    'Math.random',
    'localStorage',
    'indexedDB',
  ]) {
    assert.equal(source.includes(forbidden), false, `the integration must not contain '${forbidden}'`);
  }
  assert.equal(source.includes('MAX_EXECUTION_ADMISSIONS'), true);
  // The observation lives on the bounded process-local admission record, not in a second store.
  assert.equal(source.includes('execution_observation'), true);
  assert.equal(source.includes('EXECUTION_HISTORY'), false);
});

// ── F3 C1–C9 — observed capabilities, never submitted trust ────────────────

/** A contract whose review must run outside the working session (spec §26.1). */
function freshSessionReviewContract(independence: 'none' | 'independent' = 'none'): TaskContract {
  return contract({
    acceptance: { commands: ['npm test'], review: { required: true, independence, executor: 'fresh_session' } },
  });
}

/** A contract that REQUIRES the runtime to hard-enforce a dimension. */
function enforcingContract(): TaskContract {
  return contract({
    execution_policy: { allowed_tools: ['read'] },
    requirements: { enforcement: { allowed_tools: 'required' } },
  });
}

function compileWith(adapter: charter.AdapterIntegration, taskContract: TaskContract) {
  return adapter.compile({ task_contract: taskContract, authority_binder: AUTHORITY, model_profile: PROFILE });
}

test('C1/C5 — no capability observer attests no capability, whatever the adapter is called', () => {
  for (const name of ['external-fixture-adapter', 'pi-subagents', 'independent-reviewer']) {
    const adapter = charter.createAdapterIntegration({
      name,
      version: '1.0.0',
      observeEnvironment: () => ({
        ok: true,
        observation: { target: 'parent', provider: 'fake-provider', model: MODEL, session_identity: 'fake-session', runtime: 'fixture-runtime' },
      }),
    });
    const compiled = compileWith(adapter, enforcingContract());
    assert.equal(compiled.ok, false, `${name} cannot infer a capability from its own name`);
    if (compiled.ok) return;
    assert.deepEqual([...new Set(compiled.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);

    const plain = compileWith(adapter, executableContract());
    assert.equal(plain.ok, true);
    if (!plain.ok) return;
    assert.equal(plain.compiled.target_binding.capability_evidence.class, 'unattested_claim');
  }
});

test('C2 — only an observed axis becomes trusted capability evidence', () => {
  const adapter = hostAdapter(undefined, () => ({ ok: true, observed: { fresh_session: true } }));
  // The observed axis is attested, so a contract requiring a fresh review session can compile...
  const reviewed = compileWith(adapter, freshSessionReviewContract());
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) return;
  assert.equal(reviewed.compiled.target_binding.capability_evidence.class, 'attested');
  // ...and nothing else is: model selection was never observed, so it is not attested at all.
  assert.equal(reviewed.compiled.target_binding.enforcement.model_selection, 'UNSUPPORTED');
  assert.equal(
    Object.values(reviewed.compiled.role_envelope.enforcement_truth).filter((truth) => truth === 'ENFORCED').length,
    0,
  );
});

test('C3 — an observed false stays false: it is never promoted, never softened', () => {
  const adapter = fakeSubstrateAdapter(undefined, () => ({
    ok: true,
    observed: { fresh_session: false, model_selection: false, tool_ceiling: false },
  }));
  const reviewed = compileWith(adapter, freshSessionReviewContract());
  assert.equal(reviewed.ok, false, 'an observed false must fail closed exactly where the contract requires it');
  if (reviewed.ok) return;
  assert.deepEqual([...new Set(reviewed.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);

  // A false observation is recorded as not-capable rather than as an attested primitive: a tool
  // policy stays INSTRUCTED, and a required tool ceiling refuses.
  const policy = compileWith(adapter, contract({ execution_policy: { allowed_tools: ['read'] } }));
  assert.equal(policy.ok, true);
  if (!policy.ok) return;
  assert.equal(policy.compiled.role_envelope.enforcement_truth.allowed_tools, 'INSTRUCTED');
  assert.equal(policy.compiled.target_binding.enforcement.model_selection, 'UNSUPPORTED');
});

test('C4 — a partial observation attests its observed axes and leaves the rest unattested', () => {
  const adapter = hostAdapter(undefined, () => ({
    ok: true,
    observed: { model_selection: true, fresh_session: true, independent_review: true },
  }));
  // Observed axes carry: independent review is possible because both axes it needs were observed.
  const reviewed = compileWith(adapter, freshSessionReviewContract('independent'));
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) return;
  assert.equal(reviewed.compiled.target_binding.enforcement.model_selection, 'ENFORCED');
  assert.equal(reviewed.compiled.target_binding.capability_evidence.class, 'attested');

  // Omitted axes do not: tool_ceiling and file_scope_enforcement were never observed, so a contract
  // that requires them refuses instead of inheriting capability from a neighbouring dimension.
  const required = compileWith(adapter, enforcingContract());
  assert.equal(required.ok, false);
  if (required.ok) return;
  assert.deepEqual([...new Set(required.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  const filePolicy = compileWith(
    adapter,
    contract({ requirements: { enforcement: { allowed_files: 'required' } } }),
  );
  assert.equal(filePolicy.ok, false);
});

test('C6/C7 — an adapter cannot submit trust, and neither can a caller', () => {
  const attempts: [string, () => charter.AdapterCapabilityObservationResult][] = [
    ['an attested flag', () => ({ ok: true, observed: { attested: true } as never })],
    ['a trusted flag', () => ({ ok: true, observed: { trusted: true } as never })],
    ['a non-boolean axis', () => ({ ok: true, observed: { fresh_session: 'yes' } as never })],
    ['a capability attestation', () => ({ ok: true, observed: { capability_attestation: {} } as never })],
    ['a trust boundary', () => ({ ok: true, observed: { capability_attestation_verifier: {} } as never })],
    ['a failed observation', () => ({ ok: false, reason: 'the runtime did not answer' })],
  ];
  for (const [label, observeCapabilities] of attempts) {
    const adapter = fakeSubstrateAdapter(undefined, observeCapabilities);
    const compiled = compileWith(adapter, executableContract());
    assert.equal(compiled.ok, false, `${label} must be refused by the adapter contract`);
    if (compiled.ok) return;
    assert.equal(compiled.errors[0]?.path, 'capabilities');
  }
  const throwing = fakeSubstrateAdapter(undefined, () => {
    throw new Error('capability observation unavailable');
  });
  const failed = compileWith(throwing, executableContract());
  assert.equal(failed.ok, false);
});

test('C8/C9 — the capability observation is usable through the public surface and stays optional', () => {
  // Everything an external adapter needs is on the package entry point, and the axis vocabulary is
  // the canonical one core already evaluates — no second capability language.
  assert.equal(typeof charter.createAdapterIntegration, 'function');
  assert.deepEqual(
    [...charter.TARGET_CAPABILITY_KEYS],
    ['model_selection', 'fresh_session', 'tool_ceiling', 'file_scope_enforcement', 'independent_review'],
  );
  // The Pi bridge observes no capability of its own (it does not own execution), so it still attests
  // exactly the facts it observes: model and session, and no capability axis. An ordinary adapter with
  // the same callbacks attests neither: its observations are candidates (A1).
  const adapter = fakeSubstrateAdapter();
  const compiled = compileWith(adapter, executableContract());
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(compiled.compiled.target_binding.capability_evidence.class, 'unattested_claim');
  assert.equal(compiled.compiled.execution_contract.model_availability.class, 'unattested_claim');
});

// ── F3 A1–A10 — the host boundary, on the public surface ───────────────────

/** An observation callback that reports the fixture runtime and nothing else. */
const environment = (): charter.AdapterObservationResult => ({
  ok: true,
  observation: { ...FIXTURE_OBSERVATION, runtime: 'fixture-runtime' },
});

/** The capability axes a self-authorizing adapter would like to be trusted for. */
const ALL_CAPABLE = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: true,
  independent_review: true,
} as const;

test('A1 — an ordinary caller cannot self-authorize as a runtime adapter', () => {
  const adapter = fakeSubstrateAdapter(undefined, () => ({ ok: true, observed: ALL_CAPABLE }));
  const compiled = compileWith(adapter, contract({ execution_policy: { allowed_tools: ['read'] } }));
  assert.equal(compiled.ok, true, 'the untrusted contract still compiles; it just proves nothing');
  if (!compiled.ok) return;
  // Observations stay candidates on both channels: no attested capability, no attested model.
  assert.equal(compiled.compiled.target_binding.capability_evidence.class, 'unattested_claim');
  assert.equal(compiled.compiled.execution_contract.model_availability.class, 'unattested_claim');
  assert.equal(compiled.compiled.resolution_receipt.capability_evidence.class, 'unattested_claim');
  // And no axis observed true reaches ENFORCED: the truth table has no ENFORCED entry at all.
  const truths = Object.values(compiled.compiled.role_envelope.enforcement_truth);
  assert.equal(truths.includes('ENFORCED'), false);
  assert.equal(compiled.compiled.role_envelope.enforcement_truth.allowed_tools, 'INSTRUCTED');
  // Anything the contract REQUIRES refuses, because nothing is attested.
  const required = compileWith(adapter, enforcingContract());
  assert.equal(required.ok, false);
  if (required.ok) return;
  assert.deepEqual([...new Set(required.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

test('A2 — names establish no authority', () => {
  for (const name of ['pi-subagents', 'pi-charter', 'parent', 'host-authorized-fixture-adapter']) {
    const adapter = charter.createAdapterIntegration({
      name,
      version: '1.0.0',
      observeEnvironment: environment,
      observeCapabilities: () => ({ ok: true, observed: { fresh_session: true, independent_review: true } }),
    });
    const plain = compileWith(adapter, executableContract());
    assert.equal(plain.ok, true);
    if (!plain.ok) return;
    assert.equal(plain.compiled.target_binding.capability_evidence.class, 'unattested_claim', `${name} is a name, not a boundary`);
    // The review contract needs trusted fresh_session + independent_review; a name supplies neither.
    assert.equal(compileWith(adapter, freshSessionReviewContract('independent')).ok, false);
  }
});

test('A3 — a host-authorized adapter reaches trusted capability evidence', () => {
  const adapter = hostAdapter(undefined, () => ({ ok: true, observed: { fresh_session: true } }));
  const reviewed = compileWith(adapter, freshSessionReviewContract());
  assert.equal(reviewed.ok, true, 'a host-authorized observed fresh_session must support the required review');
  if (!reviewed.ok) return;
  assert.equal(reviewed.compiled.target_binding.capability_evidence.class, 'attested');
});

test('A4/A5 — observed false and omitted are different evidence, and neither is promoted', () => {
  const falseAdapter = hostAdapter(undefined, () => ({ ok: true, observed: { model_selection: true, fresh_session: false } }));
  const omittedAdapter = hostAdapter(undefined, () => ({ ok: true, observed: { model_selection: true } }));

  const observedFalse = compileWith(falseAdapter, executableContract());
  const omitted = compileWith(omittedAdapter, executableContract());
  assert.equal(observedFalse.ok && omitted.ok, true);
  if (!observedFalse.ok || !omitted.ok) return;

  // Both are trusted observations, and they are not the same observation: `false` is present, omitted
  // is absent, so the two carry different evidence identities.
  assert.equal(observedFalse.compiled.target_binding.capability_evidence.class, 'attested');
  assert.equal(omitted.compiled.target_binding.capability_evidence.class, 'attested');
  assert.notEqual(
    observedFalse.compiled.target_binding.capability_evidence.evidence_identity,
    omitted.compiled.target_binding.capability_evidence.evidence_identity,
    'an observed false must not carry the identity of an unobserved axis',
  );

  // The observed false is a trusted NEGATIVE observation: it fails closed where the contract needs it,
  // and so does the omission — but the two are distinguishable above, which is the point.
  const falseReview = compileWith(falseAdapter, freshSessionReviewContract());
  const omittedReview = compileWith(omittedAdapter, freshSessionReviewContract());
  assert.equal(falseReview.ok, false);
  assert.equal(omittedReview.ok, false);
  // The axis that WAS observed true is trusted in both cases.
  assert.equal(observedFalse.compiled.target_binding.enforcement.model_selection, 'ENFORCED');
  assert.equal(omitted.compiled.target_binding.enforcement.model_selection, 'ENFORCED');
});

test('A6 — partial observation: observed axes trusted, omitted axes unobserved', () => {
  const partial = hostAdapter(undefined, () => ({
    ok: true,
    observed: { fresh_session: true, independent_review: true },
  }));
  const reviewed = compileWith(partial, freshSessionReviewContract('independent'));
  assert.equal(reviewed.ok, true, 'both observed axes must support an independent fresh-session review');
  if (!reviewed.ok) return;
  assert.equal(reviewed.compiled.target_binding.capability_evidence.class, 'attested');
  assert.equal(reviewed.compiled.target_binding.enforcement.model_selection, 'UNSUPPORTED', 'model_selection was never observed');
  assert.equal(reviewed.compiled.target_binding.enforcement.allowed_files, 'INSTRUCTED', 'file policy without an observation stays weaker');

  // Omitted axes are not inherited from their neighbours.
  assert.equal(compileWith(partial, enforcingContract()).ok, false);
  assert.equal(compileWith(partial, contract({ requirements: { enforcement: { allowed_files: 'required' } } })).ok, false);
  const toolPolicy = compileWith(partial, contract({ execution_policy: { allowed_tools: ['read'] } }));
  assert.equal(toolPolicy.ok, true);
  if (!toolPolicy.ok) return;
  assert.equal(toolPolicy.compiled.role_envelope.enforcement_truth.allowed_tools, 'INSTRUCTED');

  // Observed true plus an applicable policy DOES reach ENFORCED, on the host-authorized path only.
  const observed = hostAdapter(undefined, () => ({ ok: true, observed: { tool_ceiling: true, model_selection: true } }));
  const enforced = compileWith(observed, contract({ execution_policy: { allowed_tools: ['read'] } }));
  assert.equal(enforced.ok, true);
  if (!enforced.ok) return;
  assert.equal(enforced.compiled.role_envelope.enforcement_truth.allowed_tools, 'ENFORCED');
  const model = compileWith(observed, executableContract());
  assert.equal(model.ok, true);
  if (!model.ok) return;
  assert.equal(model.compiled.target_binding.enforcement.model_selection, 'ENFORCED');
});

test('A7 — trust flags, forged authority, unknown axes, and non-booleans are refused', () => {
  // Trust cannot ride along as an integration option.
  for (const flag of ['attested', 'trusted', 'verified']) {
    assert.throws(
      () =>
        charter.createAdapterIntegration({
          name: 'flag-adapter',
          version: '1.0.0',
          observeEnvironment: environment,
          [flag]: true,
        } as never),
      TypeError,
      `'${flag}' must not be an integration option`,
    );
  }
  // Nor as an observation axis — on either path.
  for (const flag of ['attested', 'trusted', 'verified']) {
    for (const adapter of [
      fakeSubstrateAdapter(undefined, () => ({ ok: true, observed: { [flag]: true } as never })),
      hostAdapter(undefined, () => ({ ok: true, observed: { [flag]: true } as never })),
    ]) {
      const compiled = compileWith(adapter, executableContract());
      assert.equal(compiled.ok, false, `'${flag}' must be refused as a capability axis`);
      if (compiled.ok) return;
      assert.equal(compiled.errors[0]?.path, 'capabilities');
    }
  }
  // A non-boolean observation is refused rather than coerced.
  const nonBoolean = hostAdapter(undefined, () => ({ ok: true, observed: { fresh_session: 'yes' } as never }));
  assert.equal(compileWith(nonBoolean, executableContract()).ok, false);

  // A host authorization that is not the capability this process minted is refused at construction: a
  // record, a string, a copy, and an empty object are all just values.
  for (const forged of [{ trusted: true }, 'host', 'pi-charter', 42, { ...HOST_ADAPTER_AUTHORITY }]) {
    assert.throws(
      () => createHostAuthorizedAdapterIntegration(adapterOptions('forged-authority-adapter'), forged),
      TypeError,
      `a submitted ${typeof forged} must not occupy the host position`,
    );
  }
});

test('A8 — an untrusted adapter cannot attest the model, provider, or session it declares', () => {
  const adapter = fakeSubstrateAdapter({ ...FIXTURE_OBSERVATION, provider: 'fake', model: 'fake-model', session_identity: 'fake-session' });
  const compiled = adapter.compile({
    task_contract: executableContract(),
    authority_binder: AUTHORITY,
    model_profile: profileFor('fake-model'),
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(compiled.compiled.execution_contract.model_availability.class, 'unattested_claim');
  assert.equal(compiled.compiled.resolution_receipt.model_availability_evidence.class, 'unattested_claim');

  // The run is reported as it observed it, and verified as evidence that was never issued: the
  // declared session and model are not promoted into execution truth.
  assert.equal(adapter.observeExecution({ execution_handle: compiled.execution_handle }).ok, true);
  const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'NON_CONFORMANT');
  assert.deepEqual(verified.verification.deviations.map((deviation) => deviation.code), ['UNTRUSTED_EXECUTION_EVIDENCE']);

  // The same observation on the host-authorized path IS issued evidence — the position decides.
  const authorized = hostAdapter({ ...FIXTURE_OBSERVATION, provider: 'fake', model: 'fake-model', session_identity: 'fake-session' });
  const authorizedCompiled = authorized.compile({
    task_contract: executableContract(),
    authority_binder: AUTHORITY,
    model_profile: profileFor('fake-model'),
  });
  assert.equal(authorizedCompiled.ok, true);
  if (!authorizedCompiled.ok) return;
  assert.equal(authorizedCompiled.compiled.execution_contract.model_availability.class, 'attested');
  assert.equal(authorized.observeExecution({ execution_handle: authorizedCompiled.execution_handle }).ok, true);
  const authorizedVerified = authorized.verifyExecution({ execution_handle: authorizedCompiled.execution_handle });
  assert.equal(authorizedVerified.ok, true);
  if (!authorizedVerified.ok) return;
  assert.equal(authorizedVerified.verification.verdict, 'EXECUTION_CONFORMANT');
});

test('A9 — the package-wired runtime integration produces trusted truth and no unobserved capability', () => {
  const previous = {
    PI_PROVIDER: process.env.PI_PROVIDER,
    PI_MODEL: process.env.PI_MODEL,
    PI_SESSION_ID: process.env.PI_SESSION_ID,
  };
  process.env.PI_PROVIDER = 'pi-provider-fixture';
  process.env.PI_MODEL = MODEL;
  process.env.PI_SESSION_ID = 'pi-session-fixture';
  try {
    const compiled = charter.compileViaPi({
      task_contract: executableContract(),
      authority_binder: AUTHORITY,
      model_profile: PROFILE,
    });
    assert.equal(compiled.ok, true, 'the bridge is the host-authorized runtime integration');
    if (!compiled.ok) return;
    assert.equal(compiled.compiled.execution_contract.model_availability.class, 'attested');
    assert.equal(compiled.compiled.resolution_receipt.model_availability_evidence.class, 'attested');
    // It observes no capability axis of its own, so none becomes trusted capability evidence.
    assert.equal(compiled.compiled.target_binding.capability_evidence.class, 'unattested_claim');
    assert.equal(
      Object.values(compiled.compiled.role_envelope.enforcement_truth).includes('ENFORCED'),
      false,
      'no unobserved capability may become trusted',
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('A10 — the host authority and the raw trust minters are not on the package surface', () => {
  for (const name of [
    'createHostAuthorizedAdapterIntegration',
    'isHostAdapterAuthority',
    'HOST_ADAPTER_AUTHORITY',
    'createAttestationVerifier',
    'markIssuedAttestationVerifier',
    'createExecutionAttestationIssuer',
  ]) {
    assert.equal(name in charter, false, `'${name}' must not be reachable from the package entry point`);
  }
  // The one adapter operation that IS public is the ordinary, untrusted one.
  assert.equal(typeof charter.createAdapterIntegration, 'function');
});
