/**
 * RCP-1 … RCP-8 — resolution receipt conformance (spec §36, §37, §41 Phase 5).
 *
 * The receipt is evidence of an already-established resolution: deterministic identity, immutable,
 * provenance derived from the existing artifacts, evidence-only, optional to emit, not persisted,
 * and carrying zero workflow authority.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../authority/binder.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import {
  bindExecutionTarget,
  type ExecutionTargetCapabilitySnapshot,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import { compileBoundRoleEnvelope, type RoleEnvelope } from '../envelopes/role-envelope.ts';
import { decideNextAction } from '../escalation/escalation-policy.ts';
import { resolveExecutionContract } from '../resolver/resolve.ts';
import type { ModelProfile } from '../routing/model-routing.ts';
import { validateTaskContract } from '../validation/validate.ts';
import {
  createResolutionReceipt,
  type ResolutionReceipt,
  type ResolutionReceiptInput,
} from './resolution-receipt.ts';

// ── Fixture (explicit input; never a registry) ──────────────────────────────

const BINDER = createAuthorityBinder({
  'canonical-master': { doc: 'PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md' },
  'reviewer-findings': { doc: 'review-findings.json' },
});

const PROFILE: ModelProfile = {
  workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
  reviewer: { preferred: 'gpt-5.6-sol', fallback: [] },
  reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
};

const AVAILABLE: readonly string[] = ['gemini-3.8-flash', 'gpt-5.6-sol'];

const CONTRACT: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'rcp-implement', class: 'T1', risk: 'medium' },
  role: 'implement',
  execution_target: 'parent',
  root: '/projects/rcp-fixture',
  authority: { sources: ['canonical-master'] },
  scope: { files: ['src/feature.ts'] },
  permissions: { code_write: true, research: false, external_write: false, release: false },
  acceptance: { commands: ['npm test'], review: { required: false, independence: 'none' } },
  verification: { level: 'V2' },
  limits: { correction_rounds: 2, semantic_escalations: 1 },
  non_goals: ['architecture redesign'],
};

const SNAPSHOT: ExecutionTargetCapabilitySnapshot = {
  name: 'parent',
  capabilities: {
    model_selection: true,
    fresh_session: false,
    tool_ceiling: false,
    file_scope_enforcement: false,
    independent_review: false,
  },
};

interface Run {
  input: ResolutionReceiptInput;
  binding: TargetBinding;
  envelope: RoleEnvelope;
}

/** The real Phase 1–4 chain, each stage reached only by a stage that passed. */
function runPipeline(task: TaskContract = CONTRACT, profile: ModelProfile = PROFILE, snapshot = SNAPSHOT): Run {
  const validated = validateTaskContract(task, { authorityBinder: BINDER });
  assert.ok(validated.ok, 'fixture must validate');
  const resolved = resolveExecutionContract(validated.contract, { authorityBinder: BINDER, profile, available: AVAILABLE });
  assert.ok(resolved.ok, 'fixture must resolve');
  const bound = bindExecutionTarget({ execution_contract: resolved.contract, capability_snapshot: snapshot });
  assert.ok(bound.ok, 'fixture must bind to its execution target');
  const envelope = compileBoundRoleEnvelope(bound.binding);
  assert.ok(envelope.ok, 'fixture must compile a role envelope');
  return {
    input: {
      task_contract: validated.contract,
      authority_binder: BINDER,
      model_profile: profile,
      model_availability: AVAILABLE,
      capability_snapshot: snapshot,
      target_binding: bound.binding,
    },
    binding: bound.binding,
    envelope: envelope.envelope,
  };
}

function receiptOfInput(input: unknown): ResolutionReceipt {
  const result = createResolutionReceipt(input);
  assert.ok(result.ok, `expected a receipt, got ${JSON.stringify(result.ok ? [] : result.errors)}`);
  return result.receipt;
}

function receiptOf(run: Run): ResolutionReceipt {
  return receiptOfInput(run.input);
}

/**
 * Deep-clone the evidence inputs. The authority binder is a caller-owned interface, so it is shared
 * rather than cloned — a binder has no value identity to preserve.
 */
function cloneInput(input: ResolutionReceiptInput): ResolutionReceiptInput {
  const { authority_binder, ...rest } = input;
  return { ...structuredClone(rest), authority_binder };
}

function codes(errors: readonly { code: string }[]): string[] {
  return [...new Set(errors.map((e) => e.code))];
}

/** Rebuild the same evidence with every object's keys inserted in reverse order. */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return (value as unknown[]).map((item) => reversedKeys(item)) as unknown as T;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([key, nested]) => [key, reversedKeys(nested)])) as T;
  }
  return value;
}

// ── RCP-1 — deterministic identity ──────────────────────────────────────────

test('RCP-1 same explicit evidence twice: deep-equivalent receipt, identical identity', () => {
  const first = receiptOf(runPipeline());
  const second = receiptOf(runPipeline());
  assert.deepEqual(first, second);
  assert.equal(first.receipt_identity, second.receipt_identity);
  assert.match(first.receipt_identity, /^[0-9a-f]{64}$/, 'the identity is a SHA-256 hex digest');
});

test('RCP-1 identity is canonical: object key insertion order does not move it', () => {
  const run = runPipeline();
  const base = receiptOf(run);
  const flipped = receiptOfInput(reversedKeys(run.input));
  assert.deepEqual(flipped, base);
  assert.equal(flipped.receipt_identity, base.receipt_identity);
});

// ── RCP-2 — task evidence sensitivity ───────────────────────────────────────

test('RCP-2 changed TaskContract evidence moves the task identity and the receipt identity', () => {
  const base = receiptOf(runPipeline());

  // A full re-run on a different task identity: both identities move.
  const rerun = receiptOf(
    runPipeline({ ...structuredClone(CONTRACT), task: { ...CONTRACT.task, id: 'rcp-implement-2' } }),
  );
  assert.notEqual(rerun.task_contract_identity, base.task_contract_identity);
  assert.notEqual(rerun.execution_contract_identity, base.execution_contract_identity);
  assert.notEqual(rerun.receipt_identity, base.receipt_identity);

  // `task.risk` is routing evidence v0.1 does not carry into the resolved contract, so the resolved
  // artifact is untouched and only the task identity can move the receipt identity.
  const changed = cloneInput(runPipeline().input);
  changed.task_contract.task.risk = 'high';
  const shifted = receiptOfInput(changed);
  assert.notEqual(shifted.task_contract_identity, base.task_contract_identity);
  assert.equal(shifted.execution_contract_identity, base.execution_contract_identity);
  assert.notEqual(shifted.receipt_identity, base.receipt_identity);
});

// ── RCP-3 — model-profile sensitivity ───────────────────────────────────────

test('RCP-3 a changed admitted model profile moves the profile identity and the receipt identity', () => {
  const run = runPipeline();
  const base = receiptOf(run);

  const changed = cloneInput(run.input);
  // Still an admitted profile, and one that cannot change this resolution: only the profile
  // evidence moves, so the resolved artifact — and every truth derived from it — stays identical.
  changed.model_profile = { ...changed.model_profile, workhorse: { preferred: 'gemini-3.8-flash', fallback: ['rcp-fallback'] } };
  const shifted = receiptOfInput(changed);

  assert.notEqual(shifted.model_profile_identity, base.model_profile_identity);
  assert.equal(shifted.execution_contract_identity, base.execution_contract_identity);
  assert.deepEqual(shifted.resolved_model, base.resolved_model);
  assert.notEqual(shifted.receipt_identity, base.receipt_identity);
});

// ── RCP-4 — capability-snapshot sensitivity ─────────────────────────────────

test('RCP-4 a changed capability snapshot moves the snapshot identity and the receipt identity', () => {
  const base = receiptOf(runPipeline());

  // `fresh_session` cannot change Phase 3 truth for this contract (no review is required), so the
  // snapshot identity is isolated: nothing but the capability evidence moves.
  const shifted = receiptOf(
    runPipeline(CONTRACT, PROFILE, {
      name: 'parent',
      capabilities: { ...SNAPSHOT.capabilities, fresh_session: true },
    }),
  );

  assert.notEqual(shifted.execution_target_capability_snapshot_identity, base.execution_target_capability_snapshot_identity);
  assert.equal(shifted.execution_contract_identity, base.execution_contract_identity);
  assert.deepEqual(shifted.enforcement_truth, base.enforcement_truth);
  assert.notEqual(shifted.receipt_identity, base.receipt_identity);
});

// ── RCP-5 — resolved truth is derived, never overridden ─────────────────────

test('RCP-5 resolved governance has no override channel: unknown inputs fail closed', () => {
  const input = runPipeline().input;
  const attacks: Record<string, unknown>[] = [
    { ...input, resolved_role: 'adjudicate' },
    { ...input, resolved_model: { tier: 'reasoning', preferred: 'x', resolved: 'x', fallback_used: false } },
    { ...input, permissions: { code_write: false, research: true, external_write: true, release: true } },
    {
      ...input,
      enforcement_truth: {
        model_selection: 'ENFORCED',
        allowed_tools: 'ENFORCED',
        allowed_files: 'ENFORCED',
        archaeology_off: 'ENFORCED',
        release_forbidden: 'ENFORCED',
      },
    },
    { ...input, validation_result: 'INVALID' },
    { ...input, resolution_result: 'UNRESOLVED' },
    { ...input, receipt_identity: 'f'.repeat(64) },
    { ...input, worker_id: 'w-1' },
  ];
  for (const attack of attacks) {
    const result = createResolutionReceipt(attack);
    assert.equal(result.ok, false, `attack with keys [${Object.keys(attack).join(',')}] must fail closed`);
    assert.deepEqual(result.ok === false ? codes(result.errors) : [], ['INVALID_TASK_CONTRACT']);
  }

  // The admitted surface derives everything: the receipt restates the binding, never a caller claim.
  const contract = input.target_binding.execution_contract;
  const receipt = receiptOfInput(input);
  assert.equal(receipt.resolved_role, contract.role);
  assert.deepEqual(receipt.resolved_model, contract.model);
  assert.deepEqual(receipt.resolved_jurisdiction, contract.jurisdiction);
  assert.deepEqual(receipt.resolved_permissions, contract.permissions);
  assert.deepEqual(receipt.enforcement_truth, input.target_binding.enforcement);
  assert.equal(receipt.validation_result, 'VALID');
  assert.equal(receipt.resolution_result, 'RESOLVED');
});

test('RCP-5 evidence that describes a different run is refused, never blended', () => {
  const run = runPipeline();

  const otherTask = cloneInput(run.input);
  otherTask.task_contract.task.id = 'some-other-task';
  const otherTarget = cloneInput(run.input);
  otherTarget.target_binding.target = 'subagents';
  const otherSnapshot = cloneInput(run.input);
  otherSnapshot.capability_snapshot.name = 'subagents';

  for (const bad of [otherTask, otherTarget, otherSnapshot]) {
    const result = createResolutionReceipt(bad);
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok === false ? codes(result.errors) : [], ['CONTRACT_CONTRADICTION']);
  }

  // A malformed or incomplete artifact is refused too: the receipt records truth, not a gap.
  assert.equal(createResolutionReceipt({ ...run.input, target_binding: { target: 'parent', execution_contract: {} } }).ok, false);
  assert.equal(createResolutionReceipt({ ...run.input, model_availability: [42] }).ok, false);
});

// ── RCP-6 — immutability ────────────────────────────────────────────────────

test('RCP-6 the receipt is immutable and shares no structure with its sources', () => {
  const run = runPipeline(CONTRACT, structuredClone(PROFILE), structuredClone(SNAPSHOT));
  const receipt = receiptOf(run);
  const snapshot = structuredClone(receipt);

  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.resolved_model), true);
  assert.equal(Object.isFrozen(receipt.resolved_jurisdiction), true);
  assert.equal(Object.isFrozen(receipt.resolved_jurisdiction.mutation), true);
  assert.equal(Object.isFrozen(receipt.resolved_permissions), true);
  assert.equal(Object.isFrozen(receipt.enforcement_truth), true);

  const contract = run.input.target_binding.execution_contract;
  assert.notEqual(receipt.resolved_model, contract.model, 'resolved model is not an alias');
  assert.notEqual(receipt.resolved_jurisdiction, contract.jurisdiction, 'jurisdiction is not an alias');
  assert.notEqual(receipt.resolved_permissions, contract.permissions, 'permissions are not an alias');
  assert.notEqual(receipt.enforcement_truth, run.input.target_binding.enforcement, 'truth is not an alias');

  // Mutating the caller's artifacts after creation does not move receipt truth.
  run.input.task_contract.task.id = 'mutated-after-receipt';
  run.input.task_contract.scope.files?.push('src/mutated.ts');
  run.input.model_profile.workhorse!.preferred = 'mutated-model';
  run.input.capability_snapshot.capabilities.tool_ceiling = true;
  contract.role = 'adjudicate';
  contract.permissions.release = true;
  run.input.target_binding.enforcement.allowed_tools = 'ENFORCED';
  assert.deepEqual(receipt, snapshot, 'source mutation changed receipt truth');

  // Direct mutation attempts on the receipt do not change it either.
  assert.throws(() => {
    (receipt as unknown as { resolved_role: string }).resolved_role = 'adjudicate';
  }, TypeError);
  assert.throws(() => {
    (receipt.resolved_permissions as unknown as { release: boolean }).release = true;
  }, TypeError);
  assert.throws(() => {
    (receipt as unknown as { receipt_identity: string }).receipt_identity = '0'.repeat(64);
  }, TypeError);
  assert.deepEqual(receipt, snapshot, 'an in-place mutation changed receipt truth');
});

// ── RCP-7 — evidence-only surface ───────────────────────────────────────────

test('RCP-7 the receipt vocabulary is exactly evidence: no lifecycle field exists', () => {
  const receipt = receiptOf(runPipeline());

  assert.deepEqual(Object.keys(receipt).sort(), [
    'contract_version',
    'enforcement_truth',
    'execution_contract_identity',
    'execution_target_capability_snapshot_identity',
    'model_availability_identity',
    'model_profile_identity',
    'receipt_identity',
    'resolution_result',
    'resolved_jurisdiction',
    'resolved_model',
    'resolved_permissions',
    'resolved_role',
    'task_contract_identity',
    'validation_result',
  ]);

  for (const field of [
    'current_step',
    'previous_step',
    'next_step',
    'worker_id',
    'session_id',
    'run_status',
    'retry_pending',
    'resume_token',
    'lease',
    'lock',
    'queue_position',
    'recovery_state',
  ]) {
    assert.equal(field in receipt, false, `receipt must not carry lifecycle field '${field}'`);
  }

  assert.equal(receipt.contract_version, 'charter/v0.1');
  assert.equal(receipt.validation_result, 'VALID');
  assert.equal(receipt.resolution_result, 'RESOLVED');
});

// ── RCP-8 — no behavioral authority ─────────────────────────────────────────

test('RCP-8 creating a receipt alters no artifact and no decision', () => {
  const run = runPipeline();
  const counters = { clean_retries_used: 0, correction_rounds_used: 0, semantic_escalations_used: 0 };

  const contractBefore = structuredClone(run.binding.execution_contract);
  const bindingBefore = structuredClone(run.binding);
  const envelopeBefore = structuredClone(run.envelope);
  const decisionBefore = decideNextAction({ role_envelope: run.envelope, outcome: 'SUCCESS', counters });
  assert.ok(decisionBefore.ok);

  // The only thing this test changes is that a receipt now exists.
  const receipt = receiptOf(run);

  assert.deepEqual(run.binding.execution_contract, contractBefore, 'ExecutionContract changed');
  assert.deepEqual(run.binding, bindingBefore, 'TargetBinding changed');
  assert.deepEqual(run.envelope, envelopeBefore, 'RoleEnvelope changed');

  const decisionAfter = decideNextAction({ role_envelope: run.envelope, outcome: 'SUCCESS', counters });
  assert.deepEqual(decisionAfter, decisionBefore, 'NextActionDecision changed');
  assert.equal(receipt.resolved_role, run.envelope.role);

  // The escalation policy has no receipt channel: a receipt is not admitted state.
  const withReceipt = decideNextAction({ role_envelope: run.envelope, outcome: 'SUCCESS', counters, receipt });
  assert.equal(withReceipt.ok, false, 'a receipt must not be an admitted policy input');
});

// ── RCP-9 — provenance coherence: one coherent canonical run only ───────────

/** A second, independently honest run: same root, different task, role, and execution target. */
const REVIEW_CONTRACT: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'rcp-review', class: 'T2', risk: 'high' },
  role: 'review',
  execution_target: 'subagents',
  root: '/projects/rcp-fixture',
  authority: { sources: ['canonical-master'] },
  scope: { files: ['src/feature.ts'] },
  permissions: { code_write: false, research: false, external_write: false, release: false },
  acceptance: {
    assertions: ['findings-reported'],
    review: { required: true, independence: 'independent', executor: 'fresh_session' },
  },
  verification: { level: 'V3' },
  limits: { semantic_escalations: 1 },
};

const SUBAGENTS_SNAPSHOT: ExecutionTargetCapabilitySnapshot = {
  name: 'subagents',
  capabilities: {
    model_selection: true,
    fresh_session: true,
    tool_ceiling: true,
    file_scope_enforcement: false,
    independent_review: true,
  },
};

function refusal(input: unknown): string[] {
  const result = createResolutionReceipt(input);
  assert.equal(result.ok, false, 'this evidence must not produce a receipt');
  return result.ok ? [] : codes(result.errors);
}

test('RCP-9 evidence spliced from two different runs is refused, never blended', () => {
  const parentRun = runPipeline();
  const subagentsRun = runPipeline(REVIEW_CONTRACT, PROFILE, SUBAGENTS_SNAPSHOT);

  const spliced: unknown[] = [
    { ...parentRun.input, target_binding: subagentsRun.input.target_binding },
    { ...subagentsRun.input, target_binding: parentRun.input.target_binding },
    { ...parentRun.input, task_contract: subagentsRun.input.task_contract },
    { ...parentRun.input, capability_snapshot: subagentsRun.input.capability_snapshot },
    { ...subagentsRun.input, task_contract: parentRun.input.task_contract },
  ];
  for (const attack of spliced) refusal(attack);

  // Each honest run still emits its own receipt for its own evidence.
  assert.equal(receiptOf(parentRun).resolved_role, 'implement');
  assert.equal(receiptOf(subagentsRun).resolved_role, 'review');
  assert.notEqual(receiptOf(parentRun).receipt_identity, receiptOf(subagentsRun).receipt_identity);
});

test('RCP-9 a contract whose permissions, scope, or authority differ from the resolved contract is refused', () => {
  const run = runPipeline();

  // Claim-side: the binding claims governance truth the contract does not resolve to.
  const claim = (mutate: (contract: ExecutionContract) => void): unknown => {
    const attack = cloneInput(run.input);
    mutate(attack.target_binding.execution_contract);
    return attack;
  };
  const claimAttacks: unknown[] = [
    claim((c) => { c.permissions.research = true; }),
    claim((c) => { c.permissions.release = true; }),
    claim((c) => { c.permissions.code_write = false; }),
    claim((c) => { c.scope.files = ['src/feature.ts', 'src/other.ts']; }),
    claim((c) => { c.scope = {}; }),
    claim((c) => { c.authority.bound_sources.push('reviewer-findings'); }),
    claim((c) => { c.authority.bound_sources = []; }),
  ];
  for (const attack of claimAttacks) {
    assert.deepEqual(refusal(attack), ['CONTRACT_CONTRADICTION']);
  }

  // Contract-side: the TaskContract itself moves, so the claimed binding describes a different run.
  const contractAttacks: unknown[] = [
    { ...run.input, task_contract: { ...structuredClone(CONTRACT), permissions: { ...CONTRACT.permissions, research: true } } },
    { ...run.input, task_contract: { ...structuredClone(CONTRACT), scope: { files: ['src/feature.ts', 'src/extra.ts'] } } },
    { ...run.input, task_contract: { ...structuredClone(CONTRACT), non_goals: [] } },
    // A different authority source is a different run: the binding cannot vouch for it.
    { ...run.input, task_contract: { ...structuredClone(CONTRACT), authority: { sources: ['reviewer-findings'] } } },
  ];
  for (const attack of contractAttacks) {
    assert.deepEqual(refusal(attack), ['CONTRACT_CONTRADICTION']);
  }

  // A permission the contract cannot legally carry is refused by Phase 1, not by a receipt rule.
  assert.deepEqual(
    refusal({ ...run.input, task_contract: { ...structuredClone(CONTRACT), permissions: { ...CONTRACT.permissions, code_write: false } } }),
    ['CONTRACT_CONTRADICTION'],
  );
  // An authority reference that binds nothing is refused by Phase 1 too.
  assert.deepEqual(
    refusal({ ...run.input, task_contract: { ...structuredClone(CONTRACT), authority: { sources: ['unknown-authority'] } } }),
    ['AUTHORITY_UNRESOLVED'],
  );
});

test('RCP-9 a profile or availability set that cannot produce the resolved model is refused', () => {
  const run = runPipeline();

  // Truthful canonical failure: the tier cannot be staffed at all.
  assert.deepEqual(refusal({ ...run.input, model_availability: ['gpt-5.6-sol'] }), ['MODEL_UNAVAILABLE']);
  assert.deepEqual(refusal({ ...run.input, model_availability: [] }), ['MODEL_UNAVAILABLE']);
  assert.deepEqual(
    refusal({ ...run.input, model_profile: { ...PROFILE, workhorse: { preferred: 'ghost-model', fallback: [] } } }),
    ['MODEL_UNAVAILABLE'],
  );
  // Malformed profile/availability evidence is a routing failure, never a silently skipped input.
  assert.deepEqual(refusal({ ...run.input, model_profile: 'gemini-3.8-flash' }), ['ROUTING_UNRESOLVED']);
  assert.deepEqual(refusal({ ...run.input, model_availability: [42] }), ['ROUTING_UNRESOLVED']);
  assert.deepEqual(
    refusal({ ...run.input, model_profile: { ...PROFILE, speculative: { preferred: 'x', fallback: [] } } }),
    ['ROUTING_UNRESOLVED'],
  );

  // Resolvable, but not to the claimed model: the claimed model is not what this evidence produces.
  assert.deepEqual(
    refusal({ ...run.input, model_profile: { ...PROFILE, workhorse: { preferred: 'gpt-5.6-sol', fallback: [] } } }),
    ['CONTRACT_CONTRADICTION'],
  );
  assert.deepEqual(
    refusal({ ...run.input, model_profile: { ...PROFILE, workhorse: { preferred: 'ghost-model', fallback: ['gpt-5.6-sol'] } } }),
    ['CONTRACT_CONTRADICTION'],
  );
});

test('RCP-9 a capability snapshot that implies different enforcement truth, or misses an axis, is refused', () => {
  const run = runPipeline();

  // The snapshot flips an axis the claimed truth contradicts: no softer report is accepted.
  assert.deepEqual(
    refusal({ ...run.input, capability_snapshot: { name: 'parent', capabilities: { ...SNAPSHOT.capabilities, tool_ceiling: true } } }),
    ['CONTRACT_CONTRADICTION'],
  );
  assert.deepEqual(
    refusal({ ...run.input, capability_snapshot: { name: 'parent', capabilities: { ...SNAPSHOT.capabilities, model_selection: false } } }),
    ['CONTRACT_CONTRADICTION'],
  );
  assert.deepEqual(refusal({ ...run.input, capability_snapshot: { name: 'subagents', capabilities: SUBAGENTS_SNAPSHOT.capabilities } }), [
    'CONTRACT_CONTRADICTION',
  ]);
  // Missing, malformed, or invented axes are Phase 3 configuration failures, reported as such.
  for (const capabilities of [
    { model_selection: true, fresh_session: false, file_scope_enforcement: false, independent_review: false },
    { ...SNAPSHOT.capabilities, tool_ceiling: 'yes' },
    { ...SNAPSHOT.capabilities, sandbox: true },
  ]) {
    assert.deepEqual(refusal({ ...run.input, capability_snapshot: { name: 'parent', capabilities } }), ['INVALID_TASK_CONTRACT']);
  }
  assert.deepEqual(refusal({ ...run.input, capability_snapshot: undefined }), ['INVALID_TASK_CONTRACT']);
});

test('RCP-9 a claimed binding that is not the binding this evidence resolves to is refused', () => {
  const run = runPipeline();
  const binding = run.input.target_binding;
  const contract = binding.execution_contract;

  const claimAttacks: [unknown, string[]][] = [
    [{ ...run.input, target_binding: { ...binding, target: 'subagents' } }, ['CONTRACT_CONTRADICTION']],
    [{ ...run.input, target_binding: { ...binding, execution_contract: { ...contract, role: 'adjudicate' } } }, ['CONTRACT_CONTRADICTION']],
    [{ ...run.input, target_binding: { ...binding, execution_contract: { ...contract, task_id: 'other-task' } } }, ['CONTRACT_CONTRADICTION']],
    [{ ...run.input, target_binding: { ...binding, execution_contract: { ...contract, execution_target: 'subagents' } } }, ['CONTRACT_CONTRADICTION']],
    [
      { ...run.input, target_binding: { ...binding, execution_contract: { ...contract, model: { ...contract.model, resolved: 'ghost-model' } } } },
      ['CONTRACT_CONTRADICTION'],
    ],
    [
      { ...run.input, target_binding: { ...binding, execution_contract: { ...contract, jurisdiction: { ...contract.jurisdiction, release: 'authorized' } } } },
      ['CONTRACT_CONTRADICTION'],
    ],
    [{ ...run.input, target_binding: { ...binding, execution_contract: { ...contract, version: 'charter/v9' } } }, ['CONTRACT_CONTRADICTION']],
    [
      { ...run.input, target_binding: { ...binding, execution_contract: { ...contract, limits: { correction_rounds: 9, semantic_escalations: 9 } } } },
      ['CONTRACT_CONTRADICTION'],
    ],
    [{ ...run.input, target_binding: { ...binding, enforcement: { ...binding.enforcement, release_forbidden: 'ENFORCED' } } }, ['CONTRACT_CONTRADICTION']],
    [{ ...run.input, target_binding: { ...binding, enforcement: { model_selection: 'ENFORCED' } } }, ['CONTRACT_CONTRADICTION']],
    [{ ...run.input, target_binding: { ...binding, enforcement: { ...binding.enforcement, archaeology_off: 'UNSUPPORTED' } } }, ['CONTRACT_CONTRADICTION']],
    [{ ...run.input, target_binding: { ...binding, claimed_by: 'run-2' } }, ['INVALID_TASK_CONTRACT']],
    [{ ...run.input, target_binding: { target: binding.target } }, ['INVALID_TASK_CONTRACT']],
    [{ ...run.input, target_binding: { ...binding, execution_contract: {} } }, ['CONTRACT_CONTRADICTION']],
  ];
  for (const [attack, expected] of claimAttacks) {
    assert.deepEqual(refusal(attack), expected, JSON.stringify(attack).slice(0, 120));
  }
  assert.deepEqual(refusal({ ...run.input, target_binding: 'the-binding-i-meant' }), ['INVALID_TASK_CONTRACT']);
});

test('RCP-9 honest evidence still produces exactly one receipt, raw or normalized', () => {
  const run = runPipeline();
  const raw = structuredClone(CONTRACT);

  // The raw Phase 1 artifact, its canonical normalized form, and the binding resolution produced are
  // one run: the receipt is identical, and key order moves nothing.
  const honest = receiptOfInput({
    task_contract: raw,
    authority_binder: BINDER,
    model_profile: PROFILE,
    model_availability: AVAILABLE,
    capability_snapshot: SNAPSHOT,
    target_binding: run.input.target_binding,
  });
  assert.deepEqual(honest, receiptOf(run));
  assert.deepEqual(receiptOfInput(reversedKeys(honestOnlyInput(run, raw))), honest);

  // A second honest environment (a different admitted profile that resolves the same model) is still
  // coherent: the receipt moves, and it still exists.
  const otherEnv = receiptOfInput({
    ...run.input,
    model_profile: { ...PROFILE, workhorse: { preferred: 'gemini-3.8-flash', fallback: ['rcp-fallback'] } },
  });
  assert.notEqual(otherEnv.receipt_identity, honest.receipt_identity);
  assert.deepEqual(otherEnv.resolved_model, honest.resolved_model);
});

/** The honest evidence with the raw task artifact, for key-order and identity assertions. */
function honestOnlyInput(run: Run, raw: TaskContract): ResolutionReceiptInput {
  return { ...run.input, task_contract: raw };
}
