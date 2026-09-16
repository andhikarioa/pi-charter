/**
 * U2 — the Pi bridge (v0.1.1 Wave 2 — bridge truth, ENV1, ENV2; final correction — F1 E1–E10).
 *
 * The bridge is the production issuance boundary, so these probes are about what it refuses as much
 * as what it emits: capability booleans and model lists supplied by a caller are not admitted at all,
 * a runtime it cannot see is not answered, and everything it cannot observe stays omitted rather than
 * filled in with a convenient default.
 *
 * The final correction has two links, and E1–E10 prove both are required. Supplying an artifact is not
 * proof that this process admitted it for execution (the admission handle), and an admission is not
 * proof that the artifact ran (the observed execution event). Neither one alone moves an artifact set
 * to EXECUTION_CONFORMANT, and a run observed in one session never verifies as a run of another.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAuthorityBinder } from '../core/authority/binder.ts';
import { compileForTarget } from '../core/compile/compile-for-target.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';
import type { TaskContract } from '../core/contracts/task-contract.ts';
import { createAttestationVerifier } from '../core/attestation/attestation.ts';
import { compileViaPi, observeExecutionViaPi, observePiEnvironment, verifyExecutionViaPi } from './pi-bridge.ts';

const BRIDGE_DIR = dirname(fileURLToPath(import.meta.url));
const INTEGRATION_DIR = resolve(BRIDGE_DIR, '..', 'integration');
const ROOT = '/projects/pi-bridge';
const MODEL = 'fixture-observed-model';

const PROFILE: ModelProfile = { workhorse: { preferred: MODEL, fallback: [] }, reviewer: { preferred: MODEL, fallback: [] } };
const AUTHORITY_BINDER = createAuthorityBinder({ 'canonical-master': { doc: 'PI-CHARTER-MASTER.md', revision: 7 } });

/** A read-only parent contract: no tool policy, no assertions, nothing the bridge cannot evidence. */
function reviewContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'pi-bridge-review', class: 'T1', risk: 'medium' },
    role: 'review',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: false, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V1' },
    ...overrides,
  };
}

function implementContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return reviewContract({
    task: { id: 'pi-bridge-implement', class: 'T1', risk: 'medium' },
    role: 'implement',
    permissions: { code_write: true, research: false, external_write: false, release: false },
    ...overrides,
  });
}

/** Run a probe inside a controlled Pi environment, then restore whatever was there before. */
function withPiEnvironment<T>(vars: Record<string, string | undefined>, probe: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return probe();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const LIVE_PI = {
  PI_PROVIDER: 'fixture-provider',
  PI_MODEL: MODEL,
  PI_SESSION_ID: 'fixture-session',
};

function compileVia(contract: TaskContract, vars: Record<string, string | undefined> = LIVE_PI) {
  return withPiEnvironment(vars, () =>
    compileViaPi({
      task_contract: contract,
      authority_binder: AUTHORITY_BINDER,
      model_profile: PROFILE,
    }),
  );
}

/**
 * Compile a contract, record the runtime's execution observation, and return the artifacts plus the
 * admission handle they were admitted under. Admission alone is never execution: the observation is
 * what makes the admitted set eligible for execution evidence at all.
 */
function admitted(contract: TaskContract, vars: Record<string, string | undefined> = LIVE_PI) {
  const compiled = compileVia(contract, vars);
  assert.equal(compiled.ok, true, 'the fixture contract must compile before it can be verified');
  if (!compiled.ok) throw new Error('unreachable');
  const observed = withPiEnvironment(vars, () => observeExecutionViaPi({ execution_handle: compiled.execution_handle }));
  assert.equal(observed.ok, true, 'the fixture runtime must be able to report that it executed the admitted artifact set');
  return { ...compiled.compiled, execution_handle: compiled.execution_handle };
}

// ── ENV1/ENV2 — environment evidence is derived, never accepted ────────────

test('ENV1 — capability booleans and model lists supplied by a caller are refused outright', () => {
  const allTrue = {
    capabilities: {
      model_selection: true,
      fresh_session: true,
      tool_ceiling: true,
      file_scope_enforcement: true,
      independent_review: true,
    },
  };
  const attempts: [string, Record<string, unknown>][] = [
    ['a capability claim', { capability_claim: { name: 'parent', ...allTrue } }],
    ['an all-true capability claim', { capability_claim: { name: 'parent', ...allTrue } }],
    ['a capability attestation', { capability_attestation: { source_kind: 'execution_adapter', source: 'pi-parent', payload: { target: 'parent', ...allTrue } } }],
    ['a trust boundary', { capability_attestation_verifier: { vouches: () => true } }],
    ['a raw model list', { available: [MODEL] }],
    ['a model availability attestation', { model_availability_attestation: { source_kind: 'model_registry', source: 'pi', payload: { models: [MODEL] } } }],
    ['a caller-chosen compiler identity', { compiler_identity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }],
  ];
  for (const [label, extra] of attempts) {
    const result = withPiEnvironment(LIVE_PI, () =>
      compileViaPi({
        task_contract: reviewContract(),
        authority_binder: AUTHORITY_BINDER,
        model_profile: PROFILE,
        ...extra,
      }),
    );
    assert.equal(result.ok, false, `${label} must not be accepted by the bridge`);
    if (result.ok) return;
    const key = Object.keys(extra)[0] as string;
    assert.equal(result.errors[0]?.path, key);
    assert.equal(result.errors[0]?.message.includes('derived by the integration from the runtime'), true);
  }
});

test('ENV2 — only the observed environment evidence reaches resolved truth', () => {
  const result = compileVia(implementContract());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled, observation } = result;

  assert.deepEqual(observation.provider, 'fixture-provider');
  assert.deepEqual(observation.model, MODEL);
  // Issued, not claimed: the model inventory is the provider/model this session actually reports.
  assert.equal(compiled.execution_contract.model_availability.class, 'attested');
  if (compiled.execution_contract.model_availability.class !== 'attested') return;
  assert.equal(compiled.execution_contract.model_availability.source, 'pi-charter');
  assert.equal(compiled.execution_contract.model_availability.source_kind, 'model_registry');

  // And an inventory the session does not report cannot be conjured: the profile must match what was
  // observed, or resolution fails closed instead of selecting an unobserved model.
  const elsewhere = withPiEnvironment(LIVE_PI, () =>
    compileViaPi({
      task_contract: implementContract(),
      authority_binder: AUTHORITY_BINDER,
      model_profile: { workhorse: { preferred: 'some-other-model', fallback: [] } },
    }),
  );
  assert.equal(elsewhere.ok, false);
  if (elsewhere.ok) return;
  assert.deepEqual([...new Set(elsewhere.errors.map((error) => error.code))], ['MODEL_UNAVAILABLE']);
});

test('ENV1 — the bridge claims no capability it cannot observe, so nothing becomes ENFORCED', () => {
  const result = compileVia(implementContract({ execution_policy: { allowed_tools: ['read'] } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled } = result;
  assert.equal(compiled.target_binding.capability_evidence.class, 'unattested_claim');
  assert.deepEqual(
    Object.values(compiled.role_envelope.enforcement_truth).filter((truth) => truth === 'ENFORCED'),
    [],
  );
  assert.equal(compiled.role_envelope.enforcement_truth.allowed_tools, 'INSTRUCTED');

  // A hard requirement the bridge cannot attest refuses to compile: Charter does not invent the
  // missing capability to make a required constraint pass.
  const required = compileVia(implementContract({
    execution_policy: { allowed_tools: ['read'] },
    requirements: { enforcement: { allowed_tools: 'required' } },
  }));
  assert.equal(required.ok, false);
  if (required.ok) return;
  assert.deepEqual([...new Set(required.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

// ── Bridge scope: the active session only ─────────────────────────────────

test('bridge — a target the bridge cannot observe is refused rather than answered', () => {
  const subagents = compileVia(reviewContract({ execution_target: 'subagents' }));
  assert.equal(subagents.ok, false);
  if (subagents.ok) return;
  assert.deepEqual([...new Set(subagents.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
  assert.equal(subagents.errors[0]?.message.includes('observes only the active'), true);
});

test('bridge — no Pi environment means no evidence, and a clear refusal', () => {
  const observation = withPiEnvironment({ PI_PROVIDER: undefined, PI_MODEL: undefined, PI_SESSION_ID: undefined }, () =>
    observePiEnvironment(),
  );
  assert.equal(observation.ok, false);
  if (observation.ok) return;
  assert.equal(observation.reason.includes('PI_MODEL'), true);

  const compiled = compileVia(reviewContract(), { PI_PROVIDER: undefined, PI_MODEL: undefined, PI_SESSION_ID: undefined });
  assert.equal(compiled.ok, false);
  if (compiled.ok) return;
  assert.equal(compiled.errors[0]?.path, 'environment');
});

// ── F1 E1–E10 — the exact execution artifact link ──────────────────────────

test('E9 — compile then verify, with no observed execution: REFUSED', () => {
  const compiled = compileVia(implementContract());
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  // The handle is real and the artifacts are in hand, but nothing ever reported executing them.
  const verified = withPiEnvironment(LIVE_PI, () => verifyExecutionViaPi({ execution_handle: compiled.execution_handle }));
  assert.equal(verified.ok, false, 'an admitted artifact set nothing reported executing must not verify');
  if (verified.ok) return;
  assert.equal(verified.reason.includes('observed no execution'), true);
});

test('E10 — a run observed in one session does not verify as a run of another', () => {
  const a = admitted(implementContract());
  const verified = withPiEnvironment({ ...LIVE_PI, PI_SESSION_ID: 'a-different-session' }, () =>
    verifyExecutionViaPi({ execution_handle: a.execution_handle }),
  );
  assert.equal(verified.ok, false, 'execution evidence binds the session the run was observed in');
  if (verified.ok) return;
  assert.equal(verified.reason.includes('fixture-session'), true);
});

test('E1 — compile A and B, admit only A, verify B: NON_CONFORMANT, never a pass', () => {
  const a = admitted(implementContract());
  const b = admitted(reviewContract());
  const verified = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      execution_handle: a.execution_handle,
      resolution_receipt: b.resolution_receipt,
      role_envelope: b.role_envelope,
      execution_contract: b.execution_contract,
    }),
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'NON_CONFORMANT');
  const codes = verified.verification.deviations.map((deviation) => deviation.code);
  assert.equal(codes.includes('RESOLUTION_RECEIPT_MISMATCH'), true);
  assert.equal(codes.includes('ROLE_ENVELOPE_MISMATCH'), true);
});

test('E2 — compile A, no admission, verify A: REFUSED', () => {
  const compiled = compileVia(implementContract());
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const verified = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      // No execution_handle at all: the artifacts are supplied, and supplying an artifact is not
      // evidence that this process admitted it for execution.
      resolution_receipt: compiled.compiled.resolution_receipt,
      role_envelope: compiled.compiled.role_envelope,
      execution_contract: compiled.compiled.execution_contract,
    }),
  );
  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.equal(verified.reason.includes('execution handle'), true);
});

test('E3 — the admitted artifact set verifies: PASS', () => {
  const a = admitted(implementContract());
  const verified = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      execution_handle: a.execution_handle,
      resolution_receipt: a.resolution_receipt,
      role_envelope: a.role_envelope,
      execution_contract: a.execution_contract,
    }),
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'EXECUTION_CONFORMANT');
  assert.deepEqual(verified.verification.deviations, []);
  assert.deepEqual(verified.verification.substrate, { name: 'pi-charter', version: '0.1.1' });
  // No assertions were declared, so acceptance is not declared either — that is not a PASS.
  assert.equal(verified.verification.acceptance.status, 'ACCEPTANCE_NOT_DECLARED');
});

test('E3b — an admitted handle alone verifies the admitted artifact set (Pi tool path)', () => {
  const a = admitted(implementContract());
  const verified = withPiEnvironment(LIVE_PI, () => verifyExecutionViaPi({ execution_handle: a.execution_handle }));
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'EXECUTION_CONFORMANT');
});

test('E4 — the admitted handle with a different RoleEnvelope: NON_CONFORMANT', () => {
  const a = admitted(implementContract());
  const b = admitted(reviewContract());
  const verified = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      execution_handle: a.execution_handle,
      resolution_receipt: a.resolution_receipt,
      role_envelope: b.role_envelope,
      execution_contract: a.execution_contract,
    }),
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'NON_CONFORMANT');
  assert.equal(
    verified.verification.deviations.some((deviation) => deviation.code === 'ROLE_ENVELOPE_MISMATCH'),
    true,
  );
});

test('E5 — the admitted handle with a different receipt: NON_CONFORMANT', () => {
  const a = admitted(implementContract());
  const b = admitted(reviewContract());
  const verified = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      execution_handle: a.execution_handle,
      resolution_receipt: b.resolution_receipt,
      role_envelope: a.role_envelope,
      execution_contract: a.execution_contract,
    }),
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'NON_CONFORMANT');
  assert.equal(
    verified.verification.deviations.some((deviation) => deviation.code === 'RESOLUTION_RECEIPT_MISMATCH'),
    true,
  );
});

test('E6 — same session and model, different governance contract: NON_CONFORMANT', () => {
  const a = admitted(implementContract());
  const b = admitted(reviewContract());
  const verified = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      execution_handle: a.execution_handle,
      resolution_receipt: a.resolution_receipt,
      role_envelope: a.role_envelope,
      execution_contract: b.execution_contract,
    }),
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'NON_CONFORMANT');
  assert.equal(
    verified.verification.deviations.some((deviation) => deviation.code === 'EXECUTION_CONTRACT_MISMATCH'),
    true,
  );
});

test('E7 — a caller-made handle cannot self-promote', () => {
  const a = admitted(implementContract());
  const forgeries: unknown[] = [
    '0000000000000000000000000000000000000000000000',
    a.resolution_receipt.receipt_identity,
    { execution_handle: a.execution_handle },
    42,
    undefined,
  ];
  for (const forged of forgeries) {
    const verified = withPiEnvironment(LIVE_PI, () =>
      verifyExecutionViaPi({
        execution_handle: forged,
        resolution_receipt: a.resolution_receipt,
        role_envelope: a.role_envelope,
        execution_contract: a.execution_contract,
      }),
    );
    assert.equal(verified.ok, false, `handle ${String(forged)} must not be accepted`);
  }
});

test('E8 — the admission boundary introduces no persistence or runtime lifecycle', () => {
  for (const moduleName of ['bridge', 'integration']) {
    const source = readFileSync(
      moduleName === 'bridge' ? resolve(BRIDGE_DIR, 'pi-bridge.js') : resolve(INTEGRATION_DIR, 'adapter-integration.js'),
      'utf8',
    );
    for (const forbidden of [
      'child_process',
      'spawn(',
      'spawnSync',
      'setTimeout',
      'setInterval',
      'writeFileSync',
      'createWriteStream',
      'Date.now',
      'Math.random',
      'process.exit',
      'localStorage',
      'indexedDB',
    ]) {
      assert.equal(source.includes(forbidden), false, `the ${moduleName} module must not contain '${forbidden}'`);
    }
  }
});

test('E8b — the admission store is process-local and bounded, never a run database', () => {
  const source = readFileSync(resolve(INTEGRATION_DIR, 'adapter-integration.js'), 'utf8');
  assert.equal(source.includes('MAX_EXECUTION_ADMISSIONS'), true);
  assert.equal(source.includes('new Map'), true);
  // No exported way to mint or read an admission without going through the two operations.
  assert.equal(source.includes('export function mintExecutionHandle'), false);
  assert.equal(source.includes('export function readExecutionAdmission'), false);
});

// ── The bridge is not a second trust path for the facade ───────────────────

test('bridge — a subagents contract still compiles through the core facade, with caller-owned evidence', () => {
  // The bridge mediates the active session only; an integration that owns a subagents runtime composes
  // the core facade with its own issued evidence. This probe proves the facade is usable that way
  // without the bridge, which is where that evidence has to come from.
  const attestation = {
    source_kind: 'execution_adapter',
    source: 'pi-subagents',
    payload: {
      target: 'subagents',
      capabilities: {
        model_selection: true,
        fresh_session: true,
        tool_ceiling: true,
        file_scope_enforcement: false,
        independent_review: true,
      },
    },
  };
  const result = compileForTarget({
    task_contract: reviewContract({ execution_target: 'subagents' }),
    authority_binder: AUTHORITY_BINDER,
    model_profile: PROFILE,
    available: [MODEL],
    capability_attestation: attestation,
    // The fixture environment mints the exact attestation it issued — the same capability mechanism
    // the bridge uses, and the same one a real subagents adapter would use for its own runtime.
    capability_attestation_verifier: createAttestationVerifier([attestation]),
  });
  assert.equal(result.ok, true);
});
