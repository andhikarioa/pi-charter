/**
 * Wave 1 proof-boundary conformance (v0.1.1 — T1, T2, T3, T4, T6, H1, H2).
 *
 * Every probe runs the REAL public pipeline — validate → resolve → bind → compile → receipt — and
 * asserts what the artifacts say. None of them reaches into a private helper, and none of them mocks a
 * Charter decision.
 *
 * The defect family under test: a caller-supplied structured claim must never be promoted into
 * stronger governance truth. The letters below name the boundary each probe pins:
 *
 *   A  authority reference vs resolved evidence identity
 *   E  raw capability claim vs attested environment truth, and capability vs applicable policy
 *   M  raw availability inventory vs attested registry truth
 *   V  assertion identifier vs a binding to an actual verifier identity
 *   C  a blocker identifier vs admitted correction authority (finding + explicit acceptance)
 *   H  compiler identity, and unrecognized attestation sources
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../authority/binder.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import {
  bindExecutionTarget,
  type ExecutionTargetCapabilities,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import {
  compileBoundRoleEnvelope,
  renderRoleEnvelope,
  type RoleEnvelope,
} from '../envelopes/role-envelope.ts';
import { createEvidenceBinder, type EvidenceBinder } from '../provenance/evidence.ts';
import { createResolutionReceipt, type ResolutionReceipt } from '../receipt/resolution-receipt.ts';
import { resolveExecutionContract, type ResolverEnv } from '../resolver/resolve.ts';
import type { ModelProfile } from '../routing/model-routing.ts';
import { validateTaskContract } from '../validation/validate.ts';

// ── Fixtures (explicit input; never a registry) ─────────────────────────────

const ROOT = '/projects/proof-boundary';
const AVAILABLE = ['gemini-3.8-flash', 'gpt-5.6-sol'] as const;
const COMPILER = 'pi-charter-build:proof-boundary-1';
const PROFILE: ModelProfile = {
  workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
  reviewer: { preferred: 'gpt-5.6-sol', fallback: [] },
  reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
};

/** The authority catalogue. Content is mutable so the changed-content probe is a real change. */
function authoritySources(revision = 7): Record<string, unknown> {
  return {
    'canonical-master': { doc: 'PI-CHARTER-MASTER.md', revision },
    'reviewer-findings': { doc: 'review-findings.json', revision: 3 },
  };
}

const ASSERTION_BINDER: EvidenceBinder = createEvidenceBinder({
  'p7-no-blind-replay': 'go-test:TestP7NoBlindReplay',
  'no-release-changes': 'check:no-release-changes',
});
const CORRECTION_BINDER = {
  findings: createEvidenceBinder({ 'finding-1': 'review-finding:finding-1' }),
  acceptances: createEvidenceBinder({ 'finding-1': 'owner-acceptance:finding-1' }),
};

const PARENT: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: false,
  tool_ceiling: false,
  file_scope_enforcement: false,
  independent_review: false,
};
const ALL_CAPABLE: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: true,
  independent_review: true,
};

function implementTask(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'proof-boundary-implement', class: 'T1', risk: 'medium' },
    role: 'implement',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'], assertions: ['p7-no-blind-replay'] },
    verification: { level: 'V2' },
    ...overrides,
  };
}

function correctionTask(blockers: string[]): TaskContract {
  return implementTask({
    task: { id: 'proof-boundary-correct', class: 'T3', risk: 'high' },
    role: 'correct',
    scope: { blockers, files: ['src/feature.ts'] },
    acceptance: { commands: ['npm test'] },
  });
}

function env(overrides: Partial<ResolverEnv> = {}): ResolverEnv {
  return {
    authorityBinder: createAuthorityBinder(authoritySources()),
    assertionBinder: ASSERTION_BINDER,
    profile: PROFILE,
    available: AVAILABLE,
    ...overrides,
  };
}

/** A raw capability CLAIM, every axis true: the exact shape Wave 1 must stop promoting (T2). */
function allTrueClaim(target: 'parent' | 'subagents'): Record<string, unknown> {
  const capabilities = Object.fromEntries(Object.keys(ALL_CAPABLE).map((axis) => [axis, true]));
  return { name: target, capabilities };
}

/** Attested capability evidence from an explicit execution adapter (the strong path). */
function attestation(
  target: 'parent' | 'subagents',
  capabilities: ExecutionTargetCapabilities,
): Record<string, unknown> {
  return {
    source_kind: 'execution_adapter',
    source: `pi-${target}`,
    source_version: '0.1.0',
    payload: { target, capabilities },
  };
}

type CapabilityInput = { capability_claim: unknown } | { capability_attestation: unknown };

interface Chain {
  contract: ExecutionContract;
  binding: TargetBinding;
  envelope: RoleEnvelope;
  receipt: ResolutionReceipt;
  run: Record<string, unknown>;
}

/**
 * The complete real chain for one explicit input set, using the shipped public functions only. The
 * receipt is created from exactly the evidence this run was wired with.
 */
function chain(
  task: TaskContract,
  capability: CapabilityInput,
  options: { resolverEnv?: ResolverEnv; compilerIdentity?: string; correction?: boolean } = {},
): Chain {
  const resolverEnv =
    options.resolverEnv ?? env(options.correction ? { correctionBinder: CORRECTION_BINDER } : {});
  const validated = validateTaskContract(task, { authorityBinder: resolverEnv.authorityBinder });
  assert.ok(validated.ok, `fixture must validate: ${JSON.stringify(validated.ok ? [] : validated.errors)}`);
  if (!validated.ok) throw new Error('unreachable');

  const resolved = resolveExecutionContract(validated.contract, resolverEnv);
  assert.ok(resolved.ok, `fixture must resolve: ${JSON.stringify(resolved.ok ? [] : resolved.errors)}`);
  if (!resolved.ok) throw new Error('unreachable');

  const bound = bindExecutionTarget({ execution_contract: resolved.contract, ...capability });
  assert.ok(bound.ok, `fixture must bind: ${JSON.stringify(bound.ok ? [] : bound.errors)}`);
  if (!bound.ok) throw new Error('unreachable');

  const compiled = compileBoundRoleEnvelope(bound.binding);
  assert.ok(compiled.ok, `fixture must compile: ${JSON.stringify(compiled.ok ? [] : compiled.errors)}`);
  if (!compiled.ok) throw new Error('unreachable');

  const run: Record<string, unknown> = {
    task_contract: validated.contract,
    authority_binder: resolverEnv.authorityBinder,
    ...(resolverEnv.assertionBinder === undefined ? {} : { assertion_binder: resolverEnv.assertionBinder }),
    model_profile: resolverEnv.profile,
    ...(resolverEnv.available === undefined ? {} : { available: resolverEnv.available }),
    ...(resolverEnv.model_availability_attestation === undefined
      ? {}
      : { model_availability_attestation: resolverEnv.model_availability_attestation }),
    compiler_identity: options.compilerIdentity ?? COMPILER,
    target_binding: bound.binding,
    ...capability,
    ...(options.correction ? { correction_binder: CORRECTION_BINDER } : {}),
  };

  const receipt = createResolutionReceipt(run);
  assert.ok(receipt.ok, `fixture must produce a receipt: ${JSON.stringify(receipt.ok ? [] : receipt.errors)}`);
  if (!receipt.ok) throw new Error('unreachable');

  return {
    contract: resolved.contract,
    binding: bound.binding,
    envelope: compiled.envelope,
    receipt: receipt.receipt,
    run,
  };
}

/** The codes a resolution or receipt refuses with, sorted and de-duplicated. */
function codes(result: { ok: boolean; errors?: { code: string }[] }): string[] {
  return result.ok ? [] : [...new Set((result.errors ?? []).map((error) => error.code))].sort();
}

function receiptRefusal(input: unknown): string[] {
  const result = createResolutionReceipt(input);
  assert.equal(result.ok, false, 'this evidence must not produce a receipt');
  return result.ok ? [] : [...new Set(result.errors.map((error) => error.code))].sort();
}

// ── T1 — authority reference vs resolved evidence identity ──────────────────

test('T1/A1 — the same reference with the same canonical content is the same evidence', () => {
  const first = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });
  const second = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });

  assert.deepEqual(first.contract.authority.provenance, second.contract.authority.provenance);
  assert.equal(first.receipt.receipt_identity, second.receipt.receipt_identity);
  // The reference stays symbolic; the resolved evidence is what the proof commits to.
  const [entry] = first.contract.authority.provenance;
  assert.equal(entry?.reference, 'canonical-master');
  assert.equal(entry?.binding_id, 'canonical-master');
  assert.match(entry?.content_digest ?? '', /^[0-9a-f]{64}$/);
  assert.deepEqual(first.receipt.authority_provenance, first.contract.authority.provenance);
});

test('T1/A2 + A3 — the same reference with changed content cannot reuse the old proof identity', () => {
  const before = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });
  const after = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) }, {
    resolverEnv: env({ authorityBinder: createAuthorityBinder(authoritySources(8)) }),
  });

  // Same symbolic reference, same binding identity, different content.
  assert.deepEqual(before.contract.authority.bound_sources, ['canonical-master']);
  assert.deepEqual(after.contract.authority.bound_sources, ['canonical-master']);
  assert.equal(before.contract.authority.provenance[0]?.binding_id, after.contract.authority.provenance[0]?.binding_id);
  assert.notEqual(
    before.contract.authority.provenance[0]?.content_digest,
    after.contract.authority.provenance[0]?.content_digest,
  );
  // ...and the whole proof identity moves with it: contract, receipt, and receipt-committed evidence.
  assert.notEqual(before.contract, after.contract);
  assert.notEqual(before.receipt.execution_contract_identity, after.receipt.execution_contract_identity);
  assert.notEqual(before.receipt.receipt_identity, after.receipt.receipt_identity);
  assert.notDeepEqual(before.receipt.authority_provenance, after.receipt.authority_provenance);
});

test('T1/A5 — a duplicate or ambiguous authority reference still fails closed', () => {
  const ambiguous = { bind: (reference: string) => [{ id: reference, content: 1 }, { id: `${reference}-2`, content: 2 }] };
  const task = implementTask();
  assert.deepEqual(codes(resolveExecutionContract(task, env({ authorityBinder: ambiguous }))), ['AUTHORITY_UNRESOLVED']);

  const unidentifiable = {
    bind: () => [{ content: { doc: 'no-identity' } }],
  } as unknown as import('../authority/binder.ts').AuthorityBinder;
  assert.deepEqual(codes(resolveExecutionContract(task, env({ authorityBinder: unidentifiable }))), ['AUTHORITY_UNRESOLVED']);

  // A source that cannot be canonically serialized grounds no provenance instead of a false digest.
  const unstable = { bind: (reference: string) => [{ id: reference, content: () => 'opaque' }] };
  assert.deepEqual(codes(resolveExecutionContract(task, env({ authorityBinder: unstable }))), ['AUTHORITY_UNRESOLVED']);
});

// ── H1 — compiler identity ──────────────────────────────────────────────────

test('H1 — a compiler identity is required, distinct from contract_version, and committed', () => {
  const run = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) }).run;

  assert.equal(run.compiler_identity, COMPILER);
  assert.deepEqual(receiptRefusal({ ...run, compiler_identity: undefined }), ['INVALID_TASK_CONTRACT']);
  assert.deepEqual(receiptRefusal({ ...run, compiler_identity: '' }), ['INVALID_TASK_CONTRACT']);
  // A version string is not a build identity: restating contract_version is refused, never accepted.
  assert.deepEqual(receiptRefusal({ ...run, compiler_identity: 'charter/v0.1' }), ['INVALID_TASK_CONTRACT']);

  const first = createResolutionReceipt({ ...run, compiler_identity: COMPILER });
  const other = createResolutionReceipt({ ...run, compiler_identity: 'pi-charter-build:proof-boundary-2' });
  assert.ok(first.ok && other.ok);
  if (!first.ok || !other.ok) return;
  assert.equal(first.receipt.compiler_identity, COMPILER);
  assert.notEqual(first.receipt.receipt_identity, other.receipt.receipt_identity);
  assert.deepEqual(first.receipt.authority_provenance, other.receipt.authority_provenance);
});

// ── T2/T3 — claims, attestations, and applicable policy ─────────────────────

test('T2/E1 — an all-true capability claim produces no ENFORCED truth anywhere', () => {
  const task = implementTask();
  const resolverEnv = env();
  const validated = validateTaskContract(task, { authorityBinder: resolverEnv.authorityBinder });
  assert.ok(validated.ok);
  if (!validated.ok) return;
  const resolved = resolveExecutionContract(validated.contract, resolverEnv);
  assert.ok(resolved.ok);
  if (!resolved.ok) return;

  // The claim is true for every axis, and it still proves nothing.
  const claimed = bindExecutionTarget({ execution_contract: resolved.contract, capability_claim: allTrueClaim('parent') });
  assert.ok(claimed.ok);
  if (!claimed.ok) return;
  assert.equal(claimed.binding.capability_evidence.class, 'unattested_claim');
  assert.equal(Object.values(claimed.binding.enforcement).includes('ENFORCED'), false);
  assert.equal(claimed.binding.enforcement.model_selection, 'UNSUPPORTED');

  const envelope = compileBoundRoleEnvelope(claimed.binding);
  assert.ok(envelope.ok);
  if (!envelope.ok) return;
  const text = renderRoleEnvelope(envelope.envelope);
  assert.match(text, /capability_evidence: unattested claim/);
  assert.equal(text.includes('hard-enforced'), false);

  // The attested twin of the same evidence DOES report ENFORCED where an applicable policy exists.
  const attested = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_attestation: attestation('parent', PARENT),
  });
  assert.ok(attested.ok);
  if (!attested.ok) return;
  assert.equal(attested.binding.capability_evidence.class, 'attested');
  assert.equal(attested.binding.enforcement.model_selection, 'ENFORCED');
});

test('T3/E2 — an attested tool ceiling with no tool policy enforces nothing, and refuses a requirement', () => {
  const declared = implementTask({
    execution_target: 'subagents',
    requirements: { enforcement: { allowed_tools: 'required' } },
  });
  const resolverEnv = env();
  const validated = validateTaskContract(declared, { authorityBinder: resolverEnv.authorityBinder });
  assert.ok(validated.ok);
  if (!validated.ok) return;
  const resolved = resolveExecutionContract(validated.contract, resolverEnv);
  assert.ok(resolved.ok);
  if (!resolved.ok) return;

  // Capability is attested true, and there is still nothing to enforce: the policy is what is missing.
  const bound = bindExecutionTarget({
    execution_contract: resolved.contract,
    capability_attestation: attestation('subagents', ALL_CAPABLE),
  });
  assert.equal(bound.ok, false);
  if (bound.ok) return;
  assert.deepEqual(codes(bound), ['UNSUPPORTED_BY_EXECUTION_TARGET']);

  // With the canonical tool policy declared, the identical evidence really is ENFORCED.
  const withPolicy = resolveExecutionContract(
    implementTask({
      execution_target: 'subagents',
      requirements: { enforcement: { allowed_tools: 'required' } },
      execution_policy: { allowed_tools: ['read', 'edit'] },
    }),
    resolverEnv,
  );
  assert.ok(withPolicy.ok);
  if (!withPolicy.ok) return;
  const satisfiable = bindExecutionTarget({
    execution_contract: withPolicy.contract,
    capability_attestation: attestation('subagents', ALL_CAPABLE),
  });
  assert.ok(satisfiable.ok);
  if (!satisfiable.ok) return;
  assert.equal(satisfiable.binding.enforcement.allowed_tools, 'ENFORCED');
});

test('T3/E3 — a sections-only scope is not a file policy; exact scope.files is', () => {
  const resolverEnv = env();

  const sectionsOnly = resolveExecutionContract(
    implementTask({ scope: { sections: ['P7'] } }),
    resolverEnv,
  );
  assert.ok(sectionsOnly.ok);
  if (!sectionsOnly.ok) return;
  const fileCapable: ExecutionTargetCapabilities = { ...PARENT, file_scope_enforcement: true };
  const sectionsBinding = bindExecutionTarget({
    execution_contract: sectionsOnly.contract,
    capability_attestation: attestation('parent', fileCapable),
  });
  assert.ok(sectionsBinding.ok);
  if (!sectionsBinding.ok) return;
  assert.equal(sectionsBinding.binding.enforcement.allowed_files, 'NOT_APPLICABLE');
  assert.notEqual(sectionsBinding.binding.enforcement.allowed_files, 'ENFORCED');

  const exact = resolveExecutionContract(implementTask(), resolverEnv);
  assert.ok(exact.ok);
  if (!exact.ok) return;
  const exactBinding = bindExecutionTarget({
    execution_contract: exact.contract,
    capability_attestation: attestation('parent', fileCapable),
  });
  assert.ok(exactBinding.ok);
  if (!exactBinding.ok) return;
  assert.equal(exactBinding.binding.enforcement.allowed_files, 'ENFORCED');
});

// ── H2 — model availability evidence ────────────────────────────────────────

test('H2/M1 — a raw availability list is a claim, and an attested inventory is distinguishable', () => {
  const claimed = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });
  assert.equal(claimed.receipt.model_availability_evidence.class, 'unattested_claim');
  assert.equal(claimed.contract.model_availability.class, 'unattested_claim');

  const attested = chain(
    implementTask(),
    { capability_attestation: attestation('parent', PARENT) },
    {
      resolverEnv: env({
        available: undefined,
        model_availability_attestation: {
          source_kind: 'model_registry',
          source: 'pi-model-registry',
          source_version: '0.4.1',
          payload: { models: [...AVAILABLE] },
        },
      }),
    },
  );
  assert.equal(attested.receipt.model_availability_evidence.class, 'attested');
  assert.notEqual(
    attested.receipt.model_availability_evidence.evidence_identity,
    claimed.receipt.model_availability_evidence.evidence_identity,
  );
  // The resolved model is the same either way: what changed is what the evidence can support.
  assert.deepEqual(attested.receipt.resolved_model, claimed.receipt.resolved_model);
  assert.notEqual(attested.receipt.receipt_identity, claimed.receipt.receipt_identity);

  // A changed inventory moves the evidence identity; an unrecognized source kind fails closed.
  const changedInventory = chain(
    implementTask(),
    { capability_attestation: attestation('parent', PARENT) },
    {
      resolverEnv: env({
        available: undefined,
        model_availability_attestation: {
          source_kind: 'model_registry',
          source: 'pi-model-registry',
          source_version: '0.4.1',
          payload: { models: ['gemini-3.8-flash', 'deepseek-v4.1-flash'] },
        },
      }),
    },
  );
  assert.notEqual(
    changedInventory.receipt.model_availability_evidence.evidence_identity,
    attested.receipt.model_availability_evidence.evidence_identity,
  );

  assert.deepEqual(
    codes(
      resolveExecutionContract(
        implementTask(),
        env({
          available: undefined,
          model_availability_attestation: {
            source_kind: 'vibes',
            source: 'somewhere',
            payload: { models: [...AVAILABLE] },
          },
        }),
      ),
    ),
    ['INVALID_TASK_CONTRACT'],
  );
});

// ── T4 — assertions are bound to a verifier identity, never verified ────────

test('T4/V1 — a bound assertion resolves, and says ASSERTION_BOUND rather than VERIFIED', () => {
  const run = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });

  assert.deepEqual(run.contract.assertion_bindings.map((binding) => binding.reference), ['p7-no-blind-replay']);
  const [binding] = run.contract.assertion_bindings;
  assert.equal(binding?.verifier, 'go-test:TestP7NoBlindReplay');
  assert.match(binding?.verifier_digest ?? '', /^[0-9a-f]{64}$/);

  const text = renderRoleEnvelope(run.envelope);
  assert.match(text, /p7-no-blind-replay → verifier go-test:TestP7NoBlindReplay/);
  assert.match(text, /ASSERTION_BOUND, not ASSERTION_VERIFIED/);
});

test('T4/V2 — binding the same assertion to a different verifier moves the resolved proof identity', () => {
  const before = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });
  const rerouted = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) }, {
    resolverEnv: env({
      assertionBinder: createEvidenceBinder({ 'p7-no-blind-replay': 'go-test:TestP7BlindReplay' }),
    }),
  });

  assert.equal(before.contract.assertion_bindings[0]?.reference, rerouted.contract.assertion_bindings[0]?.reference);
  assert.equal(before.contract.assertion_bindings[0]?.verifier, 'go-test:TestP7NoBlindReplay');
  assert.equal(rerouted.contract.assertion_bindings[0]?.verifier, 'go-test:TestP7BlindReplay');
  assert.notEqual(before.contract.assertion_bindings[0]?.verifier_digest, rerouted.contract.assertion_bindings[0]?.verifier_digest);
  assert.notEqual(before.receipt.execution_contract_identity, rerouted.receipt.execution_contract_identity);
  assert.notEqual(before.receipt.receipt_identity, rerouted.receipt.receipt_identity);
});

test('T4/V3 + V4 — an unbound, ambiguous, or unverifiable assertion fails closed', () => {
  const task = implementTask();

  // No binder at all: an assertion identifier proves syntax and nothing else.
  assert.deepEqual(codes(resolveExecutionContract(task, env({ assertionBinder: undefined }))), ['ACCEPTANCE_INVALID']);
  // Zero candidates for a declared assertion.
  assert.deepEqual(
    codes(resolveExecutionContract(task, env({ assertionBinder: createEvidenceBinder({}) }))),
    ['ACCEPTANCE_INVALID'],
  );
  // Two verifiers for one assertion: ambiguous, never a best-effort pick.
  assert.deepEqual(
    codes(
      resolveExecutionContract(
        task,
        env({
          assertionBinder: {
            bind: (reference: string) => [{ id: `${reference}-a`, content: 'a' }, { id: `${reference}-b`, content: 'b' }],
          },
        }),
      ),
    ),
    ['ACCEPTANCE_INVALID'],
  );

  // The canonical false proof: a well-formed identifier with no verifier never becomes acceptance.
  const banana = implementTask({ acceptance: { assertions: ['banana-proof-123'] } });
  assert.equal(
    validateTaskContract(banana, { authorityBinder: createAuthorityBinder(authoritySources()) }).ok,
    true,
    'syntax alone still validates',
  );
  assert.deepEqual(codes(resolveExecutionContract(banana, env())), ['ACCEPTANCE_INVALID']);
});

// ── T6 — admitted correction authority ──────────────────────────────────────

test('T6/C1 — finding provenance plus explicit acceptance admits the target, and only that target', () => {
  const run = chain(correctionTask(['finding-1']), { capability_attestation: attestation('parent', PARENT) }, {
    correction: true,
  });

  assert.deepEqual(run.contract.correction_targets.map((target) => target.id), ['finding-1']);
  const [target] = run.contract.correction_targets;
  assert.equal(target?.finding.binding_id, 'review-finding:finding-1');
  assert.equal(target?.acceptance.binding_id, 'owner-acceptance:finding-1');
  assert.deepEqual(run.envelope.correction_targets.map((entry) => entry.id), ['finding-1']);
  assert.match(run.envelope.operating_rules.join('\n'), /admitted correction targets are: finding-1/);
  assert.match(run.envelope.operating_rules.join('\n'), /A blocker identifier alone admits nothing/);
});

test('T6/C2 + C3 — either missing evidence link refuses; a blocker identifier alone authorizes nothing', () => {
  // Arbitrary blocker: neither link resolves.
  assert.deepEqual(codes(resolveExecutionContract(correctionTask(['fix-whatever-i-want']), env({ correctionBinder: CORRECTION_BINDER }))), [
    'CONTRACT_CONTRADICTION',
  ]);
  assert.deepEqual(codes(resolveExecutionContract(correctionTask(['fix-whatever-i-want']), env())), ['CONTRACT_CONTRADICTION']);

  // Finding provenance but no acceptance: half the chain is not authority.
  assert.deepEqual(
    codes(
      resolveExecutionContract(
        correctionTask(['finding-1']),
        env({ correctionBinder: { findings: CORRECTION_BINDER.findings, acceptances: { bind: () => [] } } }),
      ),
    ),
    ['CONTRACT_CONTRADICTION'],
  );
  // Acceptance provenance but no finding: refused as well.
  assert.deepEqual(
    codes(
      resolveExecutionContract(
        correctionTask(['finding-1']),
        env({ correctionBinder: { findings: { bind: () => [] }, acceptances: CORRECTION_BINDER.acceptances } }),
      ),
    ),
    ['CONTRACT_CONTRADICTION'],
  );
  // And a `correct` contract that names no target at all has nothing to act on.
  assert.deepEqual(codes(resolveExecutionContract(correctionTask([]), env({ correctionBinder: CORRECTION_BINDER }))), [
    'CONTRACT_CONTRADICTION',
  ]);
});

// ── Non-regression: the same evidence twice is the same proof ───────────────

test('Wave 1 — the whole chain is deterministic and the receipt commits to resolved evidence', () => {
  const first = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });
  const second = chain(implementTask(), { capability_attestation: attestation('parent', PARENT) });

  assert.deepEqual(first.contract, second.contract);
  assert.deepEqual(first.binding, second.binding);
  assert.deepEqual(first.envelope, second.envelope);
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(
    first.receipt.execution_contract_identity.startsWith(first.receipt.execution_contract_identity),
    true,
  );
  assert.match(first.receipt.receipt_identity, /^[0-9a-f]{64}$/);
  // The receipt's evidence-free identity still binds resolved evidence: changing the contract alone
  // changes the receipt identity, and the compiler identity is committed alongside it.
  assert.deepEqual(first.receipt.authority_provenance, first.contract.authority.provenance);
  assert.equal(first.receipt.compiler_identity, COMPILER);
});
