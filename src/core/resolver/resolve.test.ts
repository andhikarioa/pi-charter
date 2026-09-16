import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityBinder } from '../authority/binder.ts';
import { TERMINAL_POLICY, type ExecutionContract } from '../contracts/execution-contract.ts';
import {
  ROLES,
  RISKS,
  TASK_CLASSES,
  type Permissions,
  type Role,
  type Scope,
  type StructuredAction,
  type TaskContract,
  type TaskDescriptor,
} from '../contracts/task-contract.ts';
import { ROLE_JURISDICTION_DEFAULTS, resolveJurisdiction, type AuthorityLevel } from '../jurisdiction/jurisdiction.ts';
import { routeModelTier, type ModelProfile, type ModelTier } from '../routing/model-routing.ts';
import { ASSERTION_BINDER, CORRECTION_BINDER, POSITIVE_CONTRACTS, ROOT } from '../validation/fixtures.ts';
import { validateTaskContract } from '../validation/validate.ts';
import { resolveExecutionContract, type ResolutionResult, type ResolverEnv } from './resolve.ts';

// ── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Knows more sources than any contract names. Resolution must never widen to them: a binder
 * catalogue is not authority.
 */
const BINDER = createAuthorityBinder({
  'canonical-master': { doc: 'PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md' },
  'reviewer-findings': { doc: 'review-findings.json' },
  'extra-source-a': { doc: 'unrelated-a.md' },
  'extra-source-b': { doc: 'unrelated-b.md' },
});

const PROFILE: ModelProfile = {
  workhorse: { preferred: 'gemini-3.8-flash', fallback: [] },
  reviewer: { preferred: 'gpt-5.6-sol', fallback: ['deepseek-v4.1-flash'] },
  reasoning: { preferred: 'gpt-5.6-sol', fallback: [] },
};

const ALL_AVAILABLE = ['gemini-3.8-flash', 'gpt-5.6-sol', 'deepseek-v4.1-flash'];

const PROBE_SCOPE: Scope = { files: ['a.go', 'b.go'], blockers: ['blocker-a'] };

function env(overrides: Partial<ResolverEnv> = {}): ResolverEnv {
  return {
    authorityBinder: BINDER,
    assertionBinder: ASSERTION_BINDER,
    correctionBinder: CORRECTION_BINDER,
    profile: PROFILE,
    available: ALL_AVAILABLE,
    ...overrides,
  };
}

function resolve(contract: unknown, overrides: Partial<ResolverEnv> = {}): ResolutionResult {
  return resolveExecutionContract(contract, env(overrides));
}

function resolved(contract: unknown, overrides: Partial<ResolverEnv> = {}): ExecutionContract {
  const result = resolve(contract, overrides);
  if (!result.ok) assert.fail(`expected resolution to succeed, got ${JSON.stringify(result.errors)}`);
  return result.contract;
}

function errorCodes(result: ResolutionResult): string[] {
  return result.ok ? [] : [...new Set(result.errors.map((e) => e.code))];
}

function fixtureContract(name: string): TaskContract {
  const fixture = POSITIVE_CONTRACTS.find((p) => p.name === name);
  assert.ok(fixture, `missing positive fixture '${name}'`);
  return fixture.contract;
}

/** Phase 1 admits implementation authority only for these roles (spec §7.2, §7.4). */
function requiresImplementationAuthority(role: Role): boolean {
  return ROLE_JURISDICTION_DEFAULTS[role].implementation === 'bounded';
}

/**
 * A Phase-1-valid probe contract for one role at exactly the given permissions, or `undefined`
 * when that combination is already refused by Phase 1.
 */
function probeContract(
  role: Role,
  permissions: Permissions,
  actions: StructuredAction[] = [],
  task: TaskDescriptor = { id: `probe-${role}`, class: 'T1', risk: 'low' },
): TaskContract | undefined {
  const candidate: TaskContract = {
    version: 'charter/v0.1',
    task,
    role,
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['canonical-master'] },
    scope: structuredClone(PROBE_SCOPE),
    permissions,
    acceptance: { assertions: ['probe-observed'] },
    verification: { level: 'V1' },
  };
  if (actions.length > 0) candidate.actions = actions;
  return validateTaskContract(candidate, { authorityBinder: BINDER }).ok ? candidate : undefined;
}

function withProfile(profile: unknown): Partial<ResolverEnv> {
  return { profile: profile as ModelProfile };
}

// ── Inclusion checks (the E8 claims, stated once) ───────────────────────────

function permissionSubset(got: Permissions, declared: Permissions, label: string): void {
  for (const key of ['code_write', 'research', 'external_write', 'release'] as const) {
    assert.ok(!got[key] || declared[key], `${label}: permission '${key}' was broadened`);
  }
}

function scopeSubset(got: Scope, declared: Scope, label: string): void {
  for (const key of ['blockers', 'files', 'symbols', 'directories', 'sections'] as const) {
    const allowed = new Set(declared[key] ?? []);
    for (const entry of got[key] ?? []) {
      assert.ok(allowed.has(entry), `${label}: scope.${key} entry '${entry}' was added`);
    }
  }
  assert.ok(!got.allow_unrestricted || declared.allow_unrestricted === true, `${label}: allow_unrestricted was broadened`);
}

function authoritySubset(got: readonly string[], declared: readonly string[], label: string): void {
  for (const source of got) {
    assert.ok(declared.includes(source), `${label}: authority source '${source}' was not declared`);
  }
}

/**
 * Every narrowing invariant that must hold for any successful resolution (spec §16, I1, I4, I5).
 */
function assertNeverBroadens(out: ExecutionContract, declared: TaskContract, label: string): void {
  permissionSubset(out.permissions, declared.permissions, label);
  scopeSubset(out.scope, declared.scope, label);
  authoritySubset(out.authority.bound_sources, declared.authority.sources, label);

  // Jurisdiction may only narrow; nothing outside the contract and role defaults can widen it.
  assert.equal(out.jurisdiction.architecture, 'none', `${label}: architecture authority appeared`);
  assert.equal(out.jurisdiction.product_semantics, 'none', `${label}: product semantics authority appeared`);
  assert.equal(out.jurisdiction.archaeology, false, `${label}: archaeology was granted`);
  assert.equal(out.jurisdiction.search_space, 'bounded', `${label}: search space widened`);
  assert.equal(out.jurisdiction.scope, 'bounded', `${label}: scope posture widened`);
  assert.equal(out.jurisdiction.research, out.permissions.research, label);
  assert.equal(
    out.jurisdiction.implementation === 'bounded',
    requiresImplementationAuthority(declared.role) && out.permissions.code_write,
    `${label}: implementation authority does not track the narrowed write permission`,
  );
  assert.equal(
    out.jurisdiction.semantic_adjudication,
    declared.role === 'adjudicate' ? 'bounded' : 'none',
    `${label}: semantic adjudication authority does not follow the role`,
  );
  assert.equal(
    out.jurisdiction.mutation.repository,
    out.permissions.code_write ? 'write' : 'none',
    `${label}: repository mutation posture does not track the narrowed write permission`,
  );
  assert.equal(out.jurisdiction.mutation.external, out.permissions.external_write ? 'write' : 'none', label);
  assert.equal(out.jurisdiction.mutation.release, out.permissions.release ? 'authorized' : 'none', label);

  // Phase 1 fields are carried faithfully; nothing is invented in transit.
  assert.equal(out.version, 'charter/v0.1', label);
  assert.equal(out.task_id, declared.task.id, label);
  assert.equal(out.role, declared.role, label);
  assert.equal(out.execution_target, declared.execution_target, label);
  assert.equal(out.verification.level, declared.verification.level, label);
  assert.deepEqual(out.acceptance, declared.acceptance, label);
  assert.deepEqual(out.limits, declared.limits ?? {}, label);
  assert.deepEqual(out.non_goals, declared.non_goals ?? [], label);
  assert.deepEqual(out.terminal_state, TERMINAL_POLICY, label);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ── Routing ─────────────────────────────────────────────────────────────────

test('C1 — routing is role-only: task class and risk never change the tier', () => {
  const base: Record<Role, ModelTier> = {
    planner: 'workhorse',
    implement: 'workhorse',
    correct: 'workhorse',
    review: 'reviewer',
    adjudicate: 'reasoning',
  };
  for (const role of ROLES) {
    for (const taskClass of TASK_CLASSES) {
      for (const risk of RISKS) {
        assert.equal(routeModelTier(role, taskClass, risk), base[role], `${role} ${taskClass} ${risk}`);
      }
    }
  }
  // Frozen v0.1 routing regression (C1): no T3/T4/critical promotion, no risk-routing table.
  assert.equal(routeModelTier('implement', 'T0', 'low'), 'workhorse');
  assert.equal(routeModelTier('implement', 'T3', 'critical'), 'workhorse');
  assert.equal(routeModelTier('correct', 'T4', 'critical'), 'workhorse');
  assert.equal(routeModelTier('review', 'T0', 'low'), 'reviewer');
  assert.equal(routeModelTier('review', 'T4', 'critical'), 'reviewer');
  assert.equal(routeModelTier('adjudicate', 'T0', 'low'), 'reasoning');
  assert.equal(routeModelTier('adjudicate', 'T4', 'critical'), 'reasoning');
});

// ── C2 — semantic adjudication jurisdiction ─────────────────────────────────

test('C2 — adjudicate holds bounded semantic adjudication, every other role holds none', () => {
  for (const role of ROLES) {
    const expected: AuthorityLevel = role === 'adjudicate' ? 'bounded' : 'none';
    // No permission combination can raise it, and none can lower it for adjudicate either.
    for (const code_write of [false, true]) {
      for (const research of [false, true]) {
        for (const external_write of [false, true]) {
          for (const release of [false, true]) {
            const label = `${role} ${JSON.stringify({ code_write, research, external_write, release })}`;
            assert.equal(
              resolveJurisdiction(role, { code_write, research, external_write, release }).semantic_adjudication,
              expected,
              label,
            );
          }
        }
      }
    }
    assert.equal(ROLE_JURISDICTION_DEFAULTS[role].semantic_adjudication, expected, role);
  }
});

test('C2 — task class, risk, and the selected model cannot grant semantic adjudication', () => {
  for (const role of ROLES) {
    const expected: AuthorityLevel = role === 'adjudicate' ? 'bounded' : 'none';
    let baseline: ExecutionContract | undefined;
    for (const taskClass of TASK_CLASSES) {
      for (const risk of RISKS) {
        const candidate = probeContract(
          role,
          {
            code_write: requiresImplementationAuthority(role),
            research: true,
            external_write: false,
            release: false,
          },
          [],
          { id: `c2-${role}`, class: taskClass, risk, evidence: ['probe-evidence'] },
        );
        assert.ok(candidate, `no valid probe for role=${role} class=${taskClass} risk=${risk}`);
        const out = resolved(candidate);
        const label = `${role} ${taskClass} ${risk}`;
        assert.equal(out.jurisdiction.semantic_adjudication, expected, label);
        // Changing class/risk (and therefore nothing else either) cannot move any other axis.
        assert.deepEqual(out.jurisdiction.product_semantics, 'none', label);
        assert.deepEqual(out.jurisdiction.architecture, 'none', label);
        assert.equal(
          out.jurisdiction.mutation.repository,
          out.permissions.code_write ? 'write' : 'none',
          label,
        );
        if (baseline === undefined) baseline = out;
        else assert.deepEqual(out, baseline, label);
      }
    }
  }
});

// ── E1 — model availability and explicit fallback ───────────────────────────

test('E1-A — preferred available selects preferred, without fallback', () => {
  const model = resolved(fixtureContract('read-only review')).model;
  assert.equal(model.tier, 'reviewer');
  assert.equal(model.preferred, 'gpt-5.6-sol');
  assert.equal(model.resolved, 'gpt-5.6-sol');
  assert.equal(model.fallback_used, false);
});

test('E1-B — preferred unavailable selects the first declared available fallback', () => {
  const model = resolved(fixtureContract('read-only review'), { available: ['deepseek-v4.1-flash'] }).model;
  assert.equal(model.tier, 'reviewer');
  assert.equal(model.preferred, 'gpt-5.6-sol');
  assert.equal(model.resolved, 'deepseek-v4.1-flash');
  assert.equal(model.fallback_used, true);
});

test('E1-C/E1-D — no available admitted model is MODEL_UNAVAILABLE', () => {
  // Case C: fallback list empty.
  assert.deepEqual(
    errorCodes(resolve(fixtureContract('adjudicate evidence-backed architecture conflict'), { available: ['gemini-3.8-flash'] })),
    ['MODEL_UNAVAILABLE'],
  );
  // Case D: fallbacks declared but none available.
  assert.deepEqual(
    errorCodes(resolve(fixtureContract('read-only review'), { available: ['gemini-3.8-flash'] })),
    ['MODEL_UNAVAILABLE'],
  );
  // Case D': empty availability snapshot.
  assert.deepEqual(errorCodes(resolve(fixtureContract('read-only review'), { available: [] })), ['MODEL_UNAVAILABLE']);
});

test('E1-E — multiple fallbacks: the first declared available one wins, snapshot order irrelevant', () => {
  const profile = { reviewer: { preferred: 'p0', fallback: ['f1', 'f2', 'f3'] } };
  const contract = fixtureContract('read-only review');
  const forward = resolved(contract, { ...withProfile(profile), available: ['f2', 'f3'] }).model;
  const reversed = resolved(contract, { ...withProfile(profile), available: ['f3', 'f2'] }).model;
  assert.equal(forward.resolved, 'f2');
  assert.equal(forward.fallback_used, true);
  assert.deepEqual(reversed, forward);
  // `f1` is declared first but unavailable: it must not shadow the first *available* fallback.
  assert.equal(resolved(contract, { ...withProfile(profile), available: ['f1'] }).model.resolved, 'f1');
});

test('E1 — no substitution, guessing, or promotion outside the admitted profile', () => {
  const contract = fixtureContract('read-only review');
  // Another tier's preferred model is available: still MODEL_UNAVAILABLE.
  assert.deepEqual(errorCodes(resolve(contract, { available: ['gemini-3.8-flash'] })), ['MODEL_UNAVAILABLE']);
  // Routed tier absent from the profile: ROUTING_UNRESOLVED, never a different tier.
  assert.deepEqual(
    errorCodes(resolve(contract, withProfile({ workhorse: { preferred: 'gemini-3.8-flash', fallback: [] } }))),
    ['ROUTING_UNRESOLVED'],
  );
  // Malformed or unknown profile entries fail closed.
  assert.deepEqual(errorCodes(resolve(contract, withProfile({ ...PROFILE, workhorse: { preferred: 'x' } }))), [
    'ROUTING_UNRESOLVED',
  ]);
  assert.deepEqual(errorCodes(resolve(contract, withProfile({ ...PROFILE, reviewer: { preferred: 'x', fallback: [42] } }))), [
    'ROUTING_UNRESOLVED',
  ]);
  assert.deepEqual(errorCodes(resolve(contract, withProfile({ ...PROFILE, strongest: { preferred: 'x', fallback: [] } }))), [
    'ROUTING_UNRESOLVED',
  ]);
  // A malformed availability snapshot is a configuration error, not "everything unavailable".
  assert.deepEqual(errorCodes(resolve(contract, { available: 'gpt-5.6-sol' as unknown as string[] })), ['ROUTING_UNRESOLVED']);
});

// ── C3 — closed TierModels entries ──────────────────────────────────────────

test('C3 — a tier entry admits exactly preferred and fallback; any other key is ROUTING_UNRESOLVED', () => {
  const contract = fixtureContract('read-only review');
  for (const key of ['policy', 'fallback_mode', 'allow_any']) {
    const entry = { preferred: 'gpt-5.6-sol', fallback: [], [key]: 'auto' };
    // The offending tier is refused on its own account...
    assert.deepEqual(errorCodes(resolve(contract, withProfile({ ...PROFILE, reviewer: entry }))), ['ROUTING_UNRESOLVED'], key);
    // ...and a closed profile refuses it even when a different tier is the one being resolved.
    assert.deepEqual(errorCodes(resolve(contract, withProfile({ ...PROFILE, workhorse: entry }))), ['ROUTING_UNRESOLVED'], key);
  }
  const result = resolve(contract, withProfile({ ...PROFILE, reviewer: { preferred: 'p', fallback: [], policy: 'x' } }));
  assert.ok(!result.ok, 'an unknown tier-entry key must not resolve');
  assert.deepEqual(result.errors.map((e) => e.path), ['model.profile.reviewer.policy']);
  // The two admitted keys still resolve, including an empty fallback list.
  const model = resolved(contract).model;
  assert.equal(model.tier, 'reviewer');
  assert.equal(model.preferred, 'gpt-5.6-sol');
  assert.equal(model.fallback_used, false);
});

// ── I5 — task class is routing input, not authority ─────────────────────────

test('I5 — task class and risk change nothing in the resolved contract', () => {
  const base = fixtureContract('subagents implement with independent review');
  const escalated: TaskContract = {
    ...structuredClone(base),
    task: { id: 'escalated-implementation', class: 'T4', risk: 'critical', evidence: ['conflict-report-7'] },
  };
  const low = resolved(base);
  const high = resolved(escalated);
  // No promotion: the role alone selects the tier (C1), so only the task id moves.
  assert.equal(low.model.tier, 'workhorse');
  assert.equal(high.model.tier, 'workhorse');
  assert.equal(high.task_id, 'escalated-implementation');
  assert.deepEqual({ ...high, task_id: low.task_id }, low);
});

// ── E8 — monotonic narrowing ────────────────────────────────────────────────

test('E8 — positive contracts resolve without broadening anything', () => {
  for (const { name, contract } of POSITIVE_CONTRACTS) {
    assertNeverBroadens(resolved(contract), contract, name);
  }
});

test('E8 — no role default can raise scope, authority, or permission above the contract', () => {
  let accepted = 0;
  let contradictions = 0;
  let refusedByPhase1 = 0;
  for (const role of ROLES) {
    for (const code_write of [false, true]) {
      for (const release of [false, true]) {
        for (const external_write of [false, true]) {
          for (const research of [false, true]) {
            const declared: Permissions = { code_write, research, external_write, release };
            const label = `${role} ${JSON.stringify(declared)}`;
            const actions: StructuredAction[] = [
              ...(release ? (['tag'] as const) : []),
              ...(external_write ? (['push'] as const) : []),
            ];
            const candidate = probeContract(role, declared, actions);
            if (!candidate) {
              refusedByPhase1 += 1;
              assert.deepEqual(errorCodes(resolve(candidate)), ['INVALID_TASK_CONTRACT'], label);
              continue;
            }
            if (requiresImplementationAuthority(role) && !code_write) {
              contradictions += 1;
              assert.deepEqual(errorCodes(resolve(candidate)), ['CONTRACT_CONTRADICTION'], label);
              continue;
            }
            accepted += 1;
            assertNeverBroadens(resolved(candidate), candidate, label);
          }
        }
      }
    }
  }
  // 5 roles × 16 permission combinations; the counts prove the matrix is not vacuous.
  assert.equal(accepted + contradictions + refusedByPhase1, 80);
  assert.equal(accepted, 34);
  assert.equal(contradictions, 16);
  assert.equal(refusedByPhase1, 30);
});

test('E8 — release=false stays false for every role default', () => {
  for (const role of ROLES) {
    const candidate = probeContract(role, {
      code_write: requiresImplementationAuthority(role),
      research: true,
      external_write: false,
      release: false,
    });
    assert.ok(candidate, `no valid probe for role=${role}`);
    const out = resolved(candidate);
    assert.equal(out.permissions.release, false, role);
    assert.equal(out.jurisdiction.mutation.release, 'none', role);
  }
});

test('E8 — declared scope is preserved exactly for every role, and no default adds entries', () => {
  for (const role of ROLES) {
    const candidate = probeContract(role, {
      code_write: requiresImplementationAuthority(role),
      research: false,
      external_write: false,
      release: false,
    });
    assert.ok(candidate, `no valid probe for role=${role}`);
    const out = resolved(candidate);
    // A narrower scope would be legal; an invented or widened entry would not. v0.1 has no role
    // default that contributes scope entries, so the declared bound is carried verbatim.
    assert.deepEqual(out.scope, PROBE_SCOPE, role);
    scopeSubset(out.scope, candidate.scope, role);
  }
});

test('E8 — bound authority never widens to the binder catalogue', () => {
  const single = resolved(fixtureContract('read-only review'));
  assert.deepEqual(single.authority.bound_sources, ['reviewer-findings']);
  assert.ok(!single.authority.bound_sources.includes('canonical-master'));
  assert.ok(!single.authority.bound_sources.includes('extra-source-a'));

  const pair = resolved(fixtureContract('critical correction'));
  assert.deepEqual(pair.authority.bound_sources, ['canonical-master', 'reviewer-findings']);
});

test('E8 — an unimplemented resolver configuration key fails closed instead of narrowing silently', () => {
  const smuggled = {
    ...env(),
    scope: { files: ['**/*'] },
    authority: { sources: ['extra-source-a'] },
    permissions: { code_write: true, research: true, external_write: true, release: true },
  };
  const result = resolveExecutionContract(fixtureContract('read-only review'), smuggled as unknown as ResolverEnv);
  if (result.ok) assert.fail('a smuggled resolver configuration must not resolve');
  assert.deepEqual(result.errors.map((e) => e.path), ['env.scope', 'env.authority', 'env.permissions']);
  assert.ok(result.errors.every((e) => e.code === 'INVALID_TASK_CONTRACT'));
});

test('E8 — the inclusion checks themselves are not vacuous', () => {
  const full: Permissions = { code_write: true, research: true, external_write: true, release: true };
  assert.throws(() => permissionSubset(full, { ...full, code_write: false }, 'control'));
  assert.throws(() => scopeSubset({ files: ['a.go', 'sneaky.go'] }, { files: ['a.go'] }, 'control'));
  assert.throws(() => authoritySubset(['extra-source-a'], ['canonical-master'], 'control'));
  assert.throws(() => scopeSubset({ allow_unrestricted: true }, {}, 'control'));
});

// ── E9 — deterministic resolution ───────────────────────────────────────────

test('E9 — equivalent inputs produce deep-equivalent ExecutionContracts', () => {
  for (const { name, contract } of POSITIVE_CONTRACTS) {
    const first = resolved(contract);
    for (let round = 0; round < 5; round += 1) {
      assert.deepEqual(resolved(contract), first, name);
    }
    assert.deepEqual(resolved(structuredClone(contract)), first, name);
    assert.deepEqual(resolved(contract, { available: [...ALL_AVAILABLE].reverse() }), first, name);
  }
});

test('E9 — resolution does not mutate caller inputs', () => {
  for (const { name, contract } of POSITIVE_CONTRACTS) {
    const input = structuredClone(contract);
    const snapshot = JSON.stringify(input);
    // Strict mode: any write to a frozen input would throw instead of passing silently.
    const out = resolved(deepFreeze(input));
    assert.equal(JSON.stringify(input), snapshot, name);
    assert.equal(out.task_id, input.task.id, name);
  }
  const profile = deepFreeze(structuredClone(PROFILE));
  const available = deepFreeze([...ALL_AVAILABLE]);
  const result = resolveExecutionContract(fixtureContract('read-only review'), {
    authorityBinder: BINDER,
    assertionBinder: ASSERTION_BINDER,
    profile,
    available,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(profile, PROFILE);
  assert.deepEqual(available, ALL_AVAILABLE);
});

test('E9 — failures are deterministic and the resolver refuses what Phase 1 refuses', () => {
  const review = fixtureContract('read-only review');
  const unavailable = resolve(review, { available: [] });
  assert.deepEqual(resolve(review, { available: [] }), unavailable);
  assert.deepEqual(errorCodes(unavailable), ['MODEL_UNAVAILABLE']);

  const contradiction = probeContract('implement', {
    code_write: false,
    research: false,
    external_write: false,
    release: false,
  });
  assert.deepEqual(resolve(contradiction), resolve(structuredClone(contradiction)));

  // A forged contract cannot be used to obtain wider permission than Phase 1 admits.
  const forged = {
    ...structuredClone(review),
    permissions: { code_write: true, research: true, external_write: true, release: true },
  };
  assert.equal(validateTaskContract(forged, { authorityBinder: BINDER }).ok, false);
  assert.deepEqual(errorCodes(resolve(forged)), ['INVALID_TASK_CONTRACT']);

  // A missing or unusable binder is not a bypass.
  assert.deepEqual(errorCodes(resolve(review, { authorityBinder: {} as ResolverEnv['authorityBinder'] })), [
    'AUTHORITY_UNRESOLVED',
  ]);
  assert.deepEqual(
    errorCodes(resolveExecutionContract(review, { profile: PROFILE, available: ALL_AVAILABLE } as unknown as ResolverEnv)),
    ['AUTHORITY_UNRESOLVED'],
  );
});

// ── Phase boundary ──────────────────────────────────────────────────────────

test('Phase 2 surface — no execution-target capability or enforcement semantics leak in', () => {
  const out = resolved(fixtureContract('critical correction'));
  assert.deepEqual(Object.keys(out).sort(), [
    'acceptance',
    'assertion_bindings',
    'authority',
    'correction_targets',
    'execution_target',
    'jurisdiction',
    'limits',
    'model',
    'model_availability',
    'non_goals',
    'permissions',
    'role',
    'scope',
    'task_id',
    'terminal_state',
    'verification',
    'version',
  ]);
  assert.deepEqual(Object.keys(out.model).sort(), ['fallback_used', 'preferred', 'resolved', 'tier']);
  assert.deepEqual(Object.keys(out.jurisdiction).sort(), [
    'archaeology',
    'architecture',
    'implementation',
    'mutation',
    'product_semantics',
    'research',
    'scope',
    'search_space',
    'semantic_adjudication',
  ]);
  assert.deepEqual(Object.keys(out.jurisdiction.mutation).sort(), ['external', 'release', 'repository']);
  for (const forbidden of ['enforcement', 'capabilities', 'ENFORCED', 'INSTRUCTED', 'UNSUPPORTED', 'resolved_by']) {
    assert.ok(!Object.keys(out).includes(forbidden), `Phase 3+ field '${forbidden}' leaked into ExecutionContract`);
  }
});
