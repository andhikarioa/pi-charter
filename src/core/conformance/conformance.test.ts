import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAttestationVerifier } from '../attestation/attestation.ts';
import { createAuthorityBinder, type AuthorityBinder } from '../authority/binder.ts';
import { compileForTarget } from '../compile/compile-for-target.ts';
import type { TaskContract } from '../contracts/task-contract.ts';
import type { ExecutionTargetCapabilities } from '../enforcement/target-binding.ts';
import { validateTaskContract } from '../validation/validate.ts';

const MODEL = 'conformance-model';
const ROOT = '/projects/conformance';
const AUTHORITY = createAuthorityBinder({ spec: { doc: 'SPEC.md', revision: 1 } });
const ALL_CAPABLE: ExecutionTargetCapabilities = {
  model_selection: true,
  fresh_session: true,
  tool_ceiling: true,
  file_scope_enforcement: true,
  independent_review: true,
};

function task(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    version: 'charter/v0.1',
    task: { id: 'conformance', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'parent',
    root: ROOT,
    authority: { sources: ['spec'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V1' },
    ...overrides,
  };
}

function claim(target: 'parent' | 'subagents', capabilities: ExecutionTargetCapabilities = ALL_CAPABLE) {
  return { name: target, capabilities };
}

function attested(target: 'parent' | 'subagents', capabilities: ExecutionTargetCapabilities = ALL_CAPABLE) {
  const candidate = {
    source_kind: 'execution_adapter',
    source: `pi-${target}`,
    source_version: '0.1.0',
    payload: { target, capabilities },
  };
  return {
    capability_attestation: candidate,
    capability_attestation_verifier: createAttestationVerifier([candidate]),
  };
}

function compile(
  contract: TaskContract,
  options: {
    authorityBinder?: AuthorityBinder;
    available?: readonly string[];
    modelProfile?: Record<string, { preferred: string; fallback: string[] }>;
    capability?: Record<string, unknown>;
  } = {},
) {
  return compileForTarget({
    task_contract: contract,
    authority_binder: options.authorityBinder ?? AUTHORITY,
    model_profile: options.modelProfile ?? {
      workhorse: { preferred: MODEL, fallback: [] },
      reviewer: { preferred: MODEL, fallback: [] },
      reasoning: { preferred: MODEL, fallback: [] },
    },
    available: options.available ?? [MODEL],
    ...(options.capability ?? { capability_claim: claim(contract.execution_target) }),
  });
}

test('unknown governance-bearing fields fail closed', () => {
  const result = validateTaskContract({ ...task(), invented_authority: true });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.path === 'invented_authority'), true);
});

test('scope escape fails closed', () => {
  const result = validateTaskContract(task({ scope: { files: ['../outside.ts'] } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.path?.startsWith('scope.files') === true), true);
});

test('write-capable roles need explicit write authority and bounded scope', () => {
  const noWrite = validateTaskContract(task({ permissions: { code_write: false, research: false, external_write: false, release: false } }));
  assert.equal(noWrite.ok, true, 'shape validation does not invent write authority');
  const resolved = compile(task({ permissions: { code_write: false, research: false, external_write: false, release: false } }));
  assert.equal(resolved.ok, false, 'resolution refuses an implement role without write authority');

  const emptyScope = validateTaskContract(task({ scope: {} }));
  assert.equal(emptyScope.ok, false);
});

test('review role remains read-only', () => {
  const result = validateTaskContract(task({
    role: 'review',
    permissions: { code_write: true, research: false, external_write: false, release: false },
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.path === 'permissions.code_write'), true);
});

test('missing and ambiguous authority both fail closed', () => {
  const missing = compile(task({ authority: { sources: ['missing'] } }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors.some((error) => error.code === 'AUTHORITY_UNRESOLVED'), true);

  const ambiguous: AuthorityBinder = { bind: () => [{ id: 'a' }, { id: 'b' }] };
  const result = compile(task(), { authorityBinder: ambiguous });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.code === 'AUTHORITY_UNRESOLVED'), true);
});

test('model fallback is explicit and deterministic', () => {
  const result = compile(task(), {
    available: ['fallback-model'],
    modelProfile: {
      workhorse: { preferred: 'missing-preferred', fallback: ['fallback-model'] },
      reviewer: { preferred: MODEL, fallback: [] },
      reasoning: { preferred: MODEL, fallback: [] },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.execution_contract.model.resolved, 'fallback-model');
  assert.equal(result.compiled.execution_contract.model.fallback_used, true);
});

test('unavailable model with no explicit fallback refuses', () => {
  const result = compile(task(), { available: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.code === 'MODEL_UNAVAILABLE'), true);
});

test('untrusted capability claim stays instruction-only or unsupported', () => {
  const result = compile(task({ execution_policy: { allowed_tools: ['read'] } }), {
    capability: { capability_claim: claim('parent') },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const truth = result.compiled.target_binding.enforcement;
  assert.equal(Object.values(truth).includes('ENFORCED'), false);
  assert.equal(truth.allowed_tools, 'INSTRUCTED');
  assert.equal(truth.model_selection, 'UNSUPPORTED');
});

test('no policy is NOT_APPLICABLE rather than silently unrestricted', () => {
  const result = compile(task());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.compiled.target_binding.enforcement.allowed_tools, 'NOT_APPLICABLE');
  assert.match(result.compiled.rendered_role_envelope, /no tool policy/);
});

test('required hard enforcement refuses when target truth cannot supply it', () => {
  const result = compile(task({
    execution_policy: { allowed_tools: ['read'] },
    requirements: { enforcement: { allowed_tools: 'required' } },
  }), {
    capability: {
      capability_claim: claim('parent', {
        model_selection: false,
        fresh_session: false,
        tool_ceiling: false,
        file_scope_enforcement: false,
        independent_review: false,
      }),
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((error) => error.code === 'UNSUPPORTED_BY_EXECUTION_TARGET'), true);
});

test('fresh-session independent review compiles only with trusted supporting capability', () => {
  const review = task({
    task: { id: 'review', class: 'T2', risk: 'high' },
    role: 'review',
    execution_target: 'subagents',
    permissions: { code_write: false, research: false, external_write: false, release: false },
    acceptance: { review: { required: true, independence: 'independent', executor: 'fresh_session' } },
  });
  const claimed = compile(review, { capability: { capability_claim: claim('subagents') } });
  assert.equal(claimed.ok, false);

  const trusted = compile(review, { capability: attested('subagents') });
  assert.equal(trusted.ok, true);
  if (!trusted.ok) return;
  assert.equal(trusted.compiled.target_binding.enforcement.model_selection, 'ENFORCED');
  assert.match(trusted.compiled.rendered_role_envelope, /independent review is required by this contract/);
});
