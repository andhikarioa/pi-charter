/**
 * U2 — the Pi-native bridge (v0.1.1 Wave 2 — bridge truth, ENV1, ENV2).
 *
 * The bridge is the production issuance boundary, so these probes are about what it refuses as much
 * as what it emits: capability booleans and model lists supplied by a caller are not admitted at all,
 * a runtime it cannot see is not answered, and everything it cannot observe stays omitted rather than
 * filled in with a convenient default.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAttestationVerifier } from '../core/attestation/attestation.ts';
import { createAuthorityBinder } from '../core/authority/binder.ts';
import { compileForTarget } from '../core/compile/compile-for-target.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';
import type { TaskContract } from '../core/contracts/task-contract.ts';
import { compileViaPi, observePiEnvironment, verifyExecutionViaPi } from './pi-bridge.ts';

const BRIDGE_DIR = dirname(fileURLToPath(import.meta.url));
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
    assert.equal(result.errors[0]?.message.includes('derived by the bridge'), true);
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
  assert.equal(compiled.execution_contract.model_availability.source, 'pi-session-environment');
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
  assert.equal(subagents.errors[0]?.message.includes('mediates only the active'), true);
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

// ── verify_execution ──────────────────────────────────────────────────────

test('bridge — verification of what this session actually ran, with everything unobservable omitted', () => {
  const compiled = compileVia(reviewContract());
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;

  const verified = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      resolution_receipt: compiled.compiled.resolution_receipt,
      role_envelope: compiled.compiled.role_envelope,
      execution_contract: compiled.compiled.execution_contract,
    }),
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.verification.verdict, 'EXECUTION_CONFORMANT');
  assert.deepEqual(verified.verification.deviations, []);
  // No assertions were declared, so acceptance is not declared either — that is not a PASS.
  assert.equal(verified.verification.acceptance.status, 'ACCEPTANCE_NOT_DECLARED');
  assert.deepEqual(verified.verification.substrate, { name: 'pi-charter', version: '0.1.0' });
});

test('bridge — a session that actually ran another model is NON_CONFORMANT', () => {
  const compiled = compileVia(reviewContract());
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;

  const swapped = withPiEnvironment({ ...LIVE_PI, PI_MODEL: 'a-different-model' }, () =>
    verifyExecutionViaPi({
      resolution_receipt: compiled.compiled.resolution_receipt,
      role_envelope: compiled.compiled.role_envelope,
      execution_contract: compiled.compiled.execution_contract,
    }),
  );
  assert.equal(swapped.ok, true);
  if (!swapped.ok) return;
  assert.equal(swapped.verification.verdict, 'NON_CONFORMANT');
  assert.deepEqual(swapped.verification.deviations.map((deviation) => deviation.code), ['MODEL_MISMATCH']);
});

test('bridge — the bridge attests no fresh session, so a contract requiring one fails closed', () => {
  const independent = reviewContract({
    acceptance: { commands: ['npm test'], review: { required: true, independence: 'independent', executor: 'fresh_session' } },
  });
  const compiled = compileVia(independent);
  // The bridge cannot observe independent review, so it claims none, and Phase 3 refuses the binding
  // instead of rendering review independence that no evidence supports.
  assert.equal(compiled.ok, false);
  if (compiled.ok) return;
  assert.deepEqual([...new Set(compiled.errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
});

test('bridge — a target the bridge does not mediate is refused by verification too', () => {
  const compiled = compileVia(reviewContract());
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  // The same artifacts, presented as a subagents execution: the bridge observes the parent session,
  // so it refuses instead of attesting an execution it never saw.
  const result = withPiEnvironment(LIVE_PI, () =>
    verifyExecutionViaPi({
      resolution_receipt: compiled.compiled.resolution_receipt,
      role_envelope: { ...compiled.compiled.role_envelope, execution_target: 'subagents' },
      execution_contract: compiled.compiled.execution_contract,
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason.includes('observes only the active'), true);
});

test('bridge — the bridge owns no lifecycle, spawns nothing, and persists nothing', () => {
  const source = readFileSync(resolve(BRIDGE_DIR, 'pi-bridge.js'), 'utf8');
  for (const forbidden of ['child_process', 'spawn(', 'spawnSync', 'setTimeout', 'setInterval', 'writeFileSync', 'Date.now', 'Math.random', 'process.exit']) {
    assert.equal(source.includes(forbidden), false, `the bridge must not contain '${forbidden}'`);
  }
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
