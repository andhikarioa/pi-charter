/**
 * U1 blessed compilation facade conformance (v0.1.1 Wave 2 — API1–API8).
 *
 * The probes run the real facade and assert the composition rules it exists to own: canonical
 * same-process TargetBinding → RoleEnvelope, a handoff that stays separate, and no caller-supplied
 * path to ENFORCED truth or to a handmade binding.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAttestationVerifier } from '../attestation/attestation.ts';
import { createAuthorityBinder } from '../authority/binder.ts';
import { createEvidenceBinder } from '../provenance/evidence.ts';
import { isCanonicalTargetBinding, type ExecutionTargetCapabilities } from '../enforcement/target-binding.ts';
import { compileBoundRoleEnvelope, compileRoleEnvelope } from '../envelopes/role-envelope.ts';
import type { ModelProfile } from '../routing/model-routing.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import { compileForTarget } from './compile-for-target.ts';

const ROOT = '/projects/blessed-compile';
const MODEL = 'gemini-3.8-flash';

const PROFILE: ModelProfile = { workhorse: { preferred: MODEL, fallback: [] }, reviewer: { preferred: MODEL, fallback: [] } };
const AVAILABLE = [MODEL];
const AUTHORITY_BINDER = createAuthorityBinder({ 'canonical-master': { doc: 'PI-CHARTER-MASTER.md', revision: 7 } });
const ASSERTION_BINDER = createEvidenceBinder({ 'work-units-bounded': 'check:work-units-bounded' });

const CAPABLE: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: false,
  independent_review: true,
};

function capabilityAttestation(target: 'parent' | 'subagents', capabilities: ExecutionTargetCapabilities) {
  return {
    source_kind: 'execution_adapter',
    source: `pi-${target}`,
    source_version: '0.1.0',
    payload: { target, capabilities },
  };
}

function parentContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'blessed-parent', class: 'T1', risk: 'medium' },
    role: 'implement',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V2' },
    execution_policy: { allowed_tools: ['read', 'bash'] },
    ...overrides,
  };
}

function subagentsContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return parentContract({
    task: { id: 'blessed-subagents', class: 'T1', risk: 'low' },
    execution_target: 'subagents',
    acceptance: {
      commands: ['npm test'],
      review: { required: true, independence: 'independent', executor: 'fresh_session' },
    },
    ...overrides,
  });
}

function input(contract: TaskContract, target: 'parent' | 'subagents', capabilities: ExecutionTargetCapabilities = CAPABLE) {
  const attestation = capabilityAttestation(target, capabilities);
  return {
    task_contract: contract,
    authority_binder: AUTHORITY_BINDER,
    assertion_binder: ASSERTION_BINDER,
    model_profile: PROFILE,
    available: AVAILABLE,
    capability_attestation: attestation,
    capability_attestation_verifier: createAttestationVerifier([attestation]),
  };
}

// ── API1/API2 — both targets compile ───────────────────────────────────────

test('API1 — a parent contract compiles through the facade', () => {
  const result = compileForTarget(input(parentContract(), 'parent'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled } = result;
  assert.equal(compiled.execution_contract.execution_target, 'parent');
  assert.equal(compiled.role_envelope.role, 'implement');
  assert.equal(compiled.target_handoff.target, 'parent');
  assert.equal(compiled.rendered_role_envelope.includes('ROLE'), true);
  // H1 through the blessed path: the identity is the real build identity, never the product version.
  assert.match(compiled.resolution_receipt.compiler_identity, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(compiled.resolution_receipt.compiler_identity, compiled.resolution_receipt.contract_version);
});

test('API2 — a subagents contract compiles through the facade, with the handoff as a separate artifact', () => {
  const result = compileForTarget(input(subagentsContract(), 'subagents'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled } = result;
  assert.equal(compiled.execution_contract.execution_target, 'subagents');
  assert.equal(compiled.target_handoff.target, 'subagents');
  assert.equal(compiled.role_envelope.execution_target, 'subagents');
  assert.equal(compiled.role_envelope.enforcement_truth.allowed_tools, 'ENFORCED');
});

// ── API3/API4 — canonical composition, and the handoff stays separate ──────

test('API3 — the facade composes the envelope from the canonical same-process TargetBinding', () => {
  const result = compileForTarget(input(subagentsContract(), 'subagents'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled } = result;

  // The binding it returns is the canonically bound artifact, and it alone compiles the envelope.
  assert.equal(isCanonicalTargetBinding(compiled.target_binding), true);
  const recompiled = compileBoundRoleEnvelope(compiled.target_binding);
  assert.equal(recompiled.ok, true);
  if (!recompiled.ok) return;
  assert.deepEqual(recompiled.envelope, compiled.role_envelope);
});

test('API4 — the SubagentsHandoff is never an envelope input', () => {
  const result = compileForTarget(input(subagentsContract(), 'subagents'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled } = result;

  // The handoff carries no instruction text and the envelope carries no handoff parameters: they are
  // different artifacts with different jobs.
  assert.equal('operating_rules' in compiled.target_handoff, false);
  assert.equal('objective' in compiled.target_handoff, false);
  assert.equal('stop_conditions' in compiled.target_handoff, false);
  assert.equal('allowed_tools' in compiled.role_envelope, false);
  const handoff = compiled.target_handoff;
  if (handoff.target !== 'subagents') throw new Error('unreachable');
  assert.deepEqual(handoff.allowed_tools, ['read', 'bash']);

  // Feeding the handoff into envelope compilation compiles nothing — it is binding-shaped, not bound.
  const misused = compileRoleEnvelope({ target_binding: compiled.target_handoff });
  assert.equal(misused.ok, false);
});

// ── API5/API6/API7 — no caller composition, provenance intact ──────────────

test('API5 — a caller never constructs a canonical TargetBinding, and cannot supply one', () => {
  const base = input(parentContract(), 'parent');
  const smuggled = compileForTarget({ ...base, target_binding: { whatever: true } });
  assert.equal(smuggled.ok, false);
  if (smuggled.ok) return;
  assert.deepEqual([...new Set(smuggled.errors.map((error) => error.code))], ['INVALID_TASK_CONTRACT']);
  assert.equal(smuggled.errors[0]?.message.includes('unknown field'), true);

  // No governance-bearing override channel exists either: a caller cannot hand over a resolved
  // contract, a role, a model, or an enforcement table.
  for (const forbidden of ['role', 'model', 'permissions', 'enforcement_truth', 'execution_contract', 'resolution_receipt']) {
    const attempt = compileForTarget({ ...base, [forbidden]: 'anything' });
    assert.equal(attempt.ok, false, `${forbidden} must not be accepted`);
  }
});

test('API6/API7 — process-local binding provenance survives the facade, and Smoke #1 is unreachable', () => {
  const result = compileForTarget(input(subagentsContract(), 'subagents'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled } = result;

  // Smoke #1: resolve → bind → hand off → compile the envelope from the handoff (or from a binding a
  // caller assembled). Every one of those shapes is refused, while the canonical binding compiles.
  const mistakes: [string, unknown][] = [
    ['the handoff', compiled.target_handoff],
    ['a spread copy of the binding', { ...compiled.target_binding }],
    ['a structured clone of the binding', structuredClone({ ...compiled.target_binding })],
    ['a JSON roundtrip of the binding', JSON.parse(JSON.stringify(compiled.target_binding)) as unknown],
    [
      'a hand-built binding with an all-ENFORCED table',
      {
        target: 'subagents',
        enforcement: {
          model_selection: 'ENFORCED',
          allowed_tools: 'ENFORCED',
          allowed_files: 'ENFORCED',
          archaeology_off: 'ENFORCED',
          release_forbidden: 'ENFORCED',
        },
        capability_evidence: { class: 'attested', source_kind: 'execution_adapter', source: 'pi-subagents', evidence_identity: 'x' },
        execution_contract: compiled.execution_contract,
      },
    ],
  ];
  for (const [label, candidate] of mistakes) {
    assert.equal(isCanonicalTargetBinding(candidate), false, `${label} must not be canonical`);
    const attempt = compileRoleEnvelope({ target_binding: candidate });
    assert.equal(attempt.ok, false, `${label} must not compile a role envelope`);
  }
  assert.equal(compileBoundRoleEnvelope(compiled.target_binding).ok, true);
});

// ── API8 — untrusted environment evidence cannot become ENFORCED ───────────

test('API8 — a raw capability claim never becomes ENFORCED through the facade', () => {
  const allTrue = {
    name: 'parent',
    capabilities: {
      model_selection: true,
      fresh_session: true,
      tool_ceiling: true,
      file_scope_enforcement: true,
      independent_review: true,
    },
  };
  const result = compileForTarget({
    task_contract: parentContract(),
    authority_binder: AUTHORITY_BINDER,
    model_profile: PROFILE,
    available: AVAILABLE,
    capability_claim: allTrue,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { compiled } = result;

  assert.equal(compiled.target_binding.capability_evidence.class, 'unattested_claim');
  assert.equal(compiled.resolution_receipt.capability_evidence.class, 'unattested_claim');
  assert.deepEqual(
    Object.values(compiled.role_envelope.enforcement_truth).filter((truth) => truth === 'ENFORCED'),
    [],
    'no constraint may be reported ENFORCED on an unattested claim',
  );
  assert.equal(compiled.role_envelope.enforcement_truth.allowed_tools, 'INSTRUCTED');
  assert.equal(compiled.role_envelope.enforcement_truth.model_selection, 'UNSUPPORTED');
  assert.equal(compiled.rendered_role_envelope.includes('attested by'), false);
});

test('API8 — a fake trust boundary supplied to the facade is refused, not read as trust', () => {
  const attestation = capabilityAttestation('parent', {
    model_selection: true,
    fresh_session: true,
    tool_ceiling: true,
    file_scope_enforcement: true,
    independent_review: true,
  });
  const fakeVerifiers: [string, unknown][] = [
    ['a callback', () => true],
    ['a boundary-shaped record', { vouches: () => true }],
    ['a copy of a real boundary', Object.assign({}, createAttestationVerifier([attestation]))],
  ];
  for (const [label, verifier] of fakeVerifiers) {
    const result = compileForTarget({
      task_contract: parentContract(),
      authority_binder: AUTHORITY_BINDER,
      model_profile: PROFILE,
      available: AVAILABLE,
      capability_attestation: attestation,
      capability_attestation_verifier: verifier,
    });
    assert.equal(result.ok, false, `${label} must not compile governance`);
    if (result.ok) return;
    assert.equal(result.errors[0]?.path, 'capability_attestation_verifier');
  }
  // A verifier without a candidate to verify is a contradiction, not a silent no-op.
  const unmatch = compileForTarget({
    task_contract: parentContract(),
    authority_binder: AUTHORITY_BINDER,
    model_profile: PROFILE,
    available: AVAILABLE,
    capability_claim: { name: 'parent', capabilities: CAPABLE },
    capability_attestation_verifier: createAttestationVerifier([attestation]),
  });
  assert.equal(unmatch.ok, false);
});

// ── Determinism ────────────────────────────────────────────────────────────

test('API1 — the facade is deterministic, and refuses inputs it cannot resolve', () => {
  const first = compileForTarget(input(parentContract(), 'parent'));
  const second = compileForTarget(input(parentContract(), 'parent'));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.compiled.role_envelope, second.compiled.role_envelope);
  assert.equal(first.compiled.resolution_receipt.receipt_identity, second.compiled.resolution_receipt.receipt_identity);
  assert.equal(first.compiled.rendered_role_envelope, second.compiled.rendered_role_envelope);

  // An unresolvable contract fails inside the step that owns the rule, and produces no artifacts.
  const broken = compileForTarget({
    ...input(parentContract({ authority: { sources: ['not-in-the-catalogue'] } }), 'parent'),
  });
  assert.equal(broken.ok, false);
  if (broken.ok) return;
  assert.deepEqual([...new Set(broken.errors.map((error) => error.code))], ['AUTHORITY_UNRESOLVED']);
});

test('API3 — capability evidence describing another target is refused, not retargeted', () => {
  // The facade passes bound truth to the adapter that owns the target; a candidate describing a
  // different target is a contradiction rather than a silent substitution.
  const attestation = capabilityAttestation('subagents', CAPABLE);
  const result = compileForTarget({
    task_contract: parentContract(),
    authority_binder: AUTHORITY_BINDER,
    model_profile: PROFILE,
    available: AVAILABLE,
    capability_attestation: attestation,
    capability_attestation_verifier: createAttestationVerifier([attestation]),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual([...new Set(result.errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
});
