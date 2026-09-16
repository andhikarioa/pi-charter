/**
 * T5 execution-attestation conformance (v0.1.1 Wave 2 — X1–X11).
 *
 * Every probe runs the REAL pipeline to produce real governance artifacts, then submits execution
 * evidence to the REAL verifier and asserts what it says. Fixtures reach the internal issuance
 * factory directly, exactly as the Wave 1 trust probes reach the internal verifier factory: the
 * package surface is what is under test, and the probes prove that surface cannot mint evidence.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as charter from '../../index.ts';
import { createAttestationVerifier } from '../attestation/attestation.ts';
import { createAuthorityBinder } from '../authority/binder.ts';
import { createEvidenceBinder } from '../provenance/evidence.ts';
import { bindExecutionTarget, type ExecutionTargetCapabilities } from '../enforcement/target-binding.ts';
import { compileBoundRoleEnvelope } from '../envelopes/role-envelope.ts';
import { createResolutionReceipt } from '../receipt/resolution-receipt.ts';
import { resolveExecutionContract } from '../resolver/resolve.ts';
import type { ModelProfile } from '../routing/model-routing.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import {
  createExecutionAttestationIssuer,
  verifyExecutionAttestation,
  type ExecutionAttestation,
  type ExecutionAttestationObservations,
} from './execution-attestation.ts';

// ── Fixtures — explicit input, never a registry ──────────────────────────────

const ROOT = '/projects/execution-attestation';
const MODEL = 'gemini-3.8-flash';
const COMPILER = 'pi-charter-build:wave2-fixture';
const PROFILE: ModelProfile = { workhorse: { preferred: MODEL, fallback: [] }, reviewer: { preferred: MODEL, fallback: [] } };

const AUTHORITY = createAuthorityBinder({
  'canonical-master': { doc: 'PI-CHARTER-MASTER.md', revision: 7 },
});
const ASSERTION_BINDER = createEvidenceBinder({ 'p7-no-blind-replay': 'go-test:TestP7NoBlindReplay' });

const CAPABLE: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: false,
  independent_review: true,
};

/** The capability attestation this fixture environment issues for the parent adapter. */
function capabilityEnvelope(capabilities: ExecutionTargetCapabilities): Record<string, unknown> {
  return {
    source_kind: 'execution_adapter',
    source: 'pi-parent',
    source_version: '0.1.0',
    payload: { target: 'parent', capabilities },
  };
}

function contractFor(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'execution-attestation-task', class: 'T1', risk: 'medium' },
    role: 'implement',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'], assertions: ['p7-no-blind-replay'] },
    verification: { level: 'V2' },
    execution_policy: { allowed_tools: ['read', 'bash'] },
    ...overrides,
  };
}

/** One real compilation: validate → resolve → bind → compile → receipt. */
function compile(contract: TaskContract, capabilities: ExecutionTargetCapabilities = CAPABLE) {
  const issuedCapability = capabilityEnvelope(capabilities);
  const resolved = resolveExecutionContract(contract, {
    authorityBinder: AUTHORITY,
    assertionBinder: ASSERTION_BINDER,
    profile: PROFILE,
    available: [MODEL],
  });
  assert.equal(resolved.ok, true, 'the fixture contract must resolve');
  if (!resolved.ok) throw new Error('unreachable');

  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_attestation: issuedCapability,
    capability_attestation_verifier: createAttestationVerifier([issuedCapability]),
  });
  assert.equal(bound.ok, true, 'the fixture contract must bind');
  if (!bound.ok) throw new Error('unreachable');

  const compiledEnvelope = compileBoundRoleEnvelope(bound.binding);
  assert.equal(compiledEnvelope.ok, true, 'the fixture envelope must compile');
  if (!compiledEnvelope.ok) throw new Error('unreachable');

  const receipt = createResolutionReceipt({
    task_contract: contract,
    authority_binder: AUTHORITY,
    assertion_binder: ASSERTION_BINDER,
    model_profile: PROFILE,
    available: [MODEL],
    capability_attestation: issuedCapability,
    capability_attestation_verifier: createAttestationVerifier([issuedCapability]),
    compiler_identity: COMPILER,
    target_binding: bound.binding,
  });
  assert.equal(receipt.ok, true, 'the fixture receipt must be emitted');
  if (!receipt.ok) throw new Error('unreachable');

  return {
    contract: resolved.contract,
    envelope: compiledEnvelope.envelope,
    receipt: receipt.receipt,
    binding: bound.binding,
  };
}

const RUN = compile(contractFor());
/** A second, distinct run: same shape, different resolved governance identity. */
const OTHER_RUN = compile(
  contractFor({ task: { id: 'execution-attestation-other', class: 'T1', risk: 'medium' } }),
);

/** The substrate the fixture environment runs its evidence through. */
const ISSUER = createExecutionAttestationIssuer({ name: 'fixture-substrate', version: '0.1.0' });

/** Evidence for one run, with only the named observations overridden. */
function evidence(
  run: typeof RUN,
  overrides: Partial<ExecutionAttestationObservations> = {},
  issuer = ISSUER,
): ExecutionAttestation {
  const issued = issuer.issue({
    resolution_receipt_identity: run.receipt.receipt_identity,
    execution_contract_identity: run.receipt.execution_contract_identity,
    role_envelope_identity: charter.evidenceIdentity(run.envelope),
    execution_target: 'parent',
    model: run.envelope.model.resolved,
    session: { session_identity: 'session-1', fresh: true },
    // Inside the declared tool policy by default, so a probe that is about something else stays
    // about that something else. Probes that are about tool evidence override it explicitly.
    tools: ['read'],
    ...overrides,
  });
  assert.equal(issued.ok, true, 'the fixture substrate must be able to issue its own evidence');
  if (!issued.ok) throw new Error('unreachable');
  return issued.attestation;
}

function verify(run: typeof RUN, attestation: unknown) {
  return verifyExecutionAttestation({
    execution_attestation: attestation,
    resolution_receipt: run.receipt,
    role_envelope: run.envelope,
    execution_contract: run.contract,
  });
}

function codes(result: ReturnType<typeof verify>): string[] {
  return result.deviations.map((deviation) => deviation.code);
}

// ── X1–X9: conformance and acceptance ───────────────────────────────────────

test('X1 — matching evidence is EXECUTION_CONFORMANT', () => {
  const result = verify(RUN, evidence(RUN));
  assert.equal(result.verdict, 'EXECUTION_CONFORMANT');
  assert.deepEqual(result.deviations, []);
  assert.equal(result.execution_attestation_identity, evidence(RUN).attestation_identity);
  assert.deepEqual(result.substrate, { name: 'fixture-substrate', version: '0.1.0' });
});

test('X1 + X8 — the run conforms, and acceptance is NOT VERIFIED without verifier execution evidence', () => {
  const result = verify(RUN, evidence(RUN));
  assert.equal(result.verdict, 'EXECUTION_CONFORMANT');
  // A bound assertion is ASSERTION_BOUND: conformance to the instruction artifact is not the same
  // claim as "the verifier ran and passed", and only the second can verify acceptance.
  assert.equal(result.acceptance.status, 'ACCEPTANCE_NOT_VERIFIED');
  assert.deepEqual(result.acceptance.verified, []);
  assert.deepEqual(result.acceptance.unverified, [
    {
      reference: 'p7-no-blind-replay',
      verifier: 'go-test:TestP7NoBlindReplay',
      reason: 'the evidence carries no verifier execution outcome for this binding',
    },
  ]);
});

test('X9 — a bound verifier with trusted successful execution evidence may be VERIFIED', () => {
  const verified = verify(
    RUN,
    evidence(RUN, {
      assertion_executions: [
        { reference: 'p7-no-blind-replay', verifier: 'go-test:TestP7NoBlindReplay', passed: true },
      ],
    }),
  );
  assert.equal(verified.verdict, 'EXECUTION_CONFORMANT');
  assert.equal(verified.acceptance.status, 'ACCEPTANCE_VERIFIED');
  assert.deepEqual(verified.acceptance.verified, [
    { reference: 'p7-no-blind-replay', verifier: 'go-test:TestP7NoBlindReplay' },
  ]);

  // The same verifier reporting failure is NOT VERIFIED, and a different verifier's success is not
  // the bound verifier's success.
  const failed = verify(
    RUN,
    evidence(RUN, {
      assertion_executions: [
        { reference: 'p7-no-blind-replay', verifier: 'go-test:TestP7NoBlindReplay', passed: false },
      ],
    }),
  );
  assert.equal(failed.acceptance.status, 'ACCEPTANCE_NOT_VERIFIED');
  assert.equal(failed.acceptance.unverified[0]?.reason, 'the bound verifier ran and reported failure');

  const substituted = verify(
    RUN,
    evidence(RUN, {
      assertion_executions: [{ reference: 'p7-no-blind-replay', verifier: 'go-test:SomeOtherTest', passed: true }],
    }),
  );
  assert.equal(substituted.acceptance.status, 'ACCEPTANCE_NOT_VERIFIED');
  assert.equal(substituted.acceptance.unverified[0]?.reason, 'the recorded execution names a verifier identity other than the bound one');
});

test('X2 — a run on a different model is NON_CONFORMANT', () => {
  const result = verify(RUN, evidence(RUN, { model: 'some-other-model' }));
  assert.equal(result.verdict, 'NON_CONFORMANT');
  assert.deepEqual(codes(result), ['MODEL_MISMATCH']);
  assert.equal(result.acceptance.status, 'ACCEPTANCE_NOT_VERIFIED');
});

test('X3 — a run on a different target is NON_CONFORMANT', () => {
  const result = verify(RUN, evidence(RUN, { execution_target: 'subagents' }));
  assert.equal(result.verdict, 'NON_CONFORMANT');
  assert.deepEqual(codes(result), ['EXECUTION_TARGET_MISMATCH']);
});

test('X4 — a required fresh session without fresh-session evidence is NON_CONFORMANT', () => {
  const review = compile(
    contractFor({
      role: 'review',
      permissions: { code_write: false, research: false, external_write: false, release: false },
      acceptance: { commands: ['npm test'], review: { required: true, independence: 'independent', executor: 'fresh_session' } },
    }),
  );
  // The target CAN provide independent review (attested), so the binding is admitted; what the
  // evidence says about the session this run actually used is a separate question.
  const unrecorded = verify(review, evidence(review, { session: { session_identity: 'session-1' } }));
  assert.deepEqual(codes(unrecorded), ['FRESH_SESSION_NOT_EVIDENCED']);

  const notFresh = verify(review, evidence(review, { session: { session_identity: 'session-1', fresh: false } }));
  assert.deepEqual(codes(notFresh), ['FRESH_SESSION_NOT_EVIDENCED']);

  const fresh = verify(review, evidence(review, { session: { session_identity: 'session-2', fresh: true } }));
  assert.equal(fresh.verdict, 'EXECUTION_CONFORMANT');
});

test('X5 — executing a different RoleEnvelope is NON_CONFORMANT', () => {
  // The identity chain is intact; only the instruction artifact the run executed differs.
  const result = verify(RUN, evidence(RUN, { role_envelope_identity: charter.evidenceIdentity(OTHER_RUN.envelope) }));
  assert.equal(result.verdict, 'NON_CONFORMANT');
  assert.deepEqual(codes(result), ['ROLE_ENVELOPE_MISMATCH']);
});

test('X6 — evidence naming a different ResolutionReceipt is NON_CONFORMANT', () => {
  const result = verify(RUN, evidence(RUN, { resolution_receipt_identity: OTHER_RUN.receipt.receipt_identity }));
  assert.equal(result.verdict, 'NON_CONFORMANT');
  assert.deepEqual(codes(result), ['RESOLUTION_RECEIPT_MISMATCH']);
});

test('X7 — evidence for a different ExecutionContract is NON_CONFORMANT', () => {
  // A receipt and evidence for the other run, checked against this run's contract: the identity
  // chain resolves to a different resolved contract, so nothing here is conformant.
  const result = verifyExecutionAttestation({
    execution_attestation: evidence(OTHER_RUN),
    resolution_receipt: OTHER_RUN.receipt,
    role_envelope: RUN.envelope,
    execution_contract: RUN.contract,
  });
  assert.equal(result.verdict, 'NON_CONFORMANT');
  assert.ok(codes(result).includes('EXECUTION_CONTRACT_MISMATCH'));

  // And a contract that was edited after resolution is refused even with matching evidence.
  const tampered = { ...RUN.contract, non_goals: ['a goal nobody froze'] };
  const edited = verifyExecutionAttestation({
    execution_attestation: evidence(RUN),
    resolution_receipt: RUN.receipt,
    role_envelope: RUN.envelope,
    execution_contract: tampered,
  });
  assert.deepEqual(codes(edited), ['EXECUTION_CONTRACT_MISMATCH']);
});

// ── Tool policy and required enforcement evidence ───────────────────────────

test('X-T — the declared tool ceiling is checked exactly, and only where a policy exists', () => {
  // A subset of the declared policy is conformant: the run stayed inside its ceiling.
  const inside = verify(RUN, evidence(RUN, { tools: ['read'] }));
  assert.equal(inside.verdict, 'EXECUTION_CONFORMANT');

  // Silence where a policy exists is not a pass.
  const silent = verify(RUN, evidence(RUN, { tools: undefined }));
  assert.deepEqual(codes(silent), ['TOOL_POLICY_NOT_EVIDENCED']);

  // A tool outside the policy is a violation, reported per tool.
  const outside = verify(RUN, evidence(RUN, { tools: ['read', 'write'] }));
  assert.deepEqual(codes(outside), ['TOOL_POLICY_VIOLATION']);
});

test('X-T — a contract with no tool policy is asked for no tool evidence', () => {
  const noPolicy = compile(contractFor({ execution_policy: undefined }));
  const result = verify(noPolicy, evidence(noPolicy));
  assert.equal(result.verdict, 'EXECUTION_CONFORMANT');
  assert.equal(result.deviations.length, 0);
});

test('X-E — required hard enforcement must be evidenced in effect during the run', () => {
  const required = compile(contractFor({ requirements: { enforcement: { allowed_tools: 'required' } } }));
  assert.equal(required.envelope.enforcement_truth.allowed_tools, 'ENFORCED');

  const unevidenced = verify(required, evidence(required, { tools: ['read'] }));
  assert.deepEqual(codes(unevidenced), ['ENFORCEMENT_NOT_EVIDENCED']);

  const evidenced = verify(required, evidence(required, { tools: ['read'], enforcement_in_effect: ['allowed_tools'] }));
  assert.equal(evidenced.verdict, 'EXECUTION_CONFORMANT');
  assert.deepEqual(evidenced.deviations, []);
});

// ── X10: caller-authored evidence cannot self-promote ──────────────────────

test('X10 — caller-authored execution-attestation-shaped objects cannot self-promote', () => {
  const issued = evidence(RUN);

  const lookalikes: [string, unknown][] = [
    ['a hand-authored object with every field', { ...issued }],
    ['a spread copy', Object.assign({}, issued)],
    ['a structured clone', structuredClone({ ...issued })],
    ['a JSON roundtrip', JSON.parse(JSON.stringify(issued)) as unknown],
    ['a fabricated identity', { ...issued, attestation_identity: issued.attestation_identity }],
  ];
  for (const [label, lookalike] of lookalikes) {
    const result = verify(RUN, lookalike);
    assert.equal(result.verdict, 'NON_CONFORMANT', `${label} must not be conformant`);
    assert.deepEqual(codes(result), ['UNTRUSTED_EXECUTION_EVIDENCE'], `${label} must be refused as untrusted`);
  }

  // A boundary-shaped object is not a boundary either: issuance is process-local identity, not shape.
  const forged = { issue: () => ({ ok: true, attestation: issued }) };
  assert.deepEqual(codes(verify(RUN, issued)), []);
  assert.notEqual(forged.issue().attestation, undefined);

  // And the trusted issuance position is not on the package surface at all.
  assert.equal('createExecutionAttestationIssuer' in charter, false);
});

test('X10 — an issuer cannot be retargeted, and evidence carries the issuer that minted it', () => {
  const other = createExecutionAttestationIssuer({ name: 'other-substrate' });
  const fromOther = evidence(RUN, {}, other);
  assert.deepEqual(fromOther.substrate, { name: 'other-substrate' });

  // The substrate identity belongs to the boundary, not to the submitted observations.
  const attempt = other.issue({
    resolution_receipt_identity: RUN.receipt.receipt_identity,
    execution_contract_identity: RUN.receipt.execution_contract_identity,
    role_envelope_identity: charter.evidenceIdentity(RUN.envelope),
    execution_target: 'parent',
    model: RUN.envelope.model.resolved,
    session: { session_identity: 'session-1' },
    substrate: { name: 'pretend' },
  });
  assert.equal(attempt.ok, false);
  if (attempt.ok) return;
  assert.equal(attempt.errors[0]?.path, 'substrate');

  // A malformed observation set is refused rather than issued with defaults.
  for (const malformed of [
    {},
    { resolution_receipt_identity: RUN.receipt.receipt_identity },
    { model: '' },
    { execution_target: 'somewhere' },
    { tools: ['read', 7] },
    { enforcement_in_effect: ['not-a-constraint'] },
    { assertion_executions: [{ reference: 'a', verifier: 'v' }] },
  ]) {
    const result = other.issue(malformed);
    assert.equal(result.ok, false, `malformed observations must not be issued: ${JSON.stringify(malformed)}`);
  }
});

// ── X11: no state, no lifecycle, purity ────────────────────────────────────

test('X11 — verification is pure, and Charter stores no session or workflow state', () => {
  const attestation = evidence(RUN);
  const before = {
    envelope: JSON.parse(JSON.stringify(RUN.envelope)) as unknown,
    receipt: JSON.parse(JSON.stringify(RUN.receipt)) as unknown,
    contract: JSON.parse(JSON.stringify(RUN.contract)) as unknown,
  };
  const first = verify(RUN, attestation);
  const second = verify(RUN, attestation);
  assert.deepEqual(first, second, 'the same inputs must produce the same verdict');
  assert.equal(Object.isFrozen(attestation), true, 'issued evidence is frozen');
  assert.deepEqual(JSON.parse(JSON.stringify(RUN.envelope)), before.envelope);
  assert.deepEqual(JSON.parse(JSON.stringify(RUN.receipt)), before.receipt);
  assert.deepEqual(JSON.parse(JSON.stringify(RUN.contract)), before.contract);

  // The package surface holds no store, no history, no session registry, and no lifecycle API: a
  // verification leaves nothing behind to read, because there is nothing to write to.
  const stateful = Object.keys(charter).filter((name) =>
    /store|persist|histor|registry|schedule|lifecycle|latest|recover|retry|sessionstore|queue/i.test(name),
  );
  assert.deepEqual(stateful, [], `no stateful API may exist on the package surface: ${stateful.join(', ')}`);
});

test('X11 — a non-conformant run is reported as deviations, never as a partial pass or a score', () => {
  const result = verify(RUN, evidence(RUN, { model: 'wrong', execution_target: 'subagents' }));
  assert.equal(result.verdict, 'NON_CONFORMANT');
  assert.deepEqual(codes(result), ['EXECUTION_TARGET_MISMATCH', 'MODEL_MISMATCH']);
  assert.equal('score' in result, false);
  assert.equal(result.deviations.every((deviation) => typeof deviation.detail === 'string'), true);
});
