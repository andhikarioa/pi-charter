/**
 * CN0 — the operator-facing compile request (v0.1.2 Wave 1).
 *
 * These tests hold the simple surface to two promises at once: it fills the deterministic fields core
 * requires with values a reader can see, and it invents nothing governance-bearing. The second half is
 * the one that matters — every refusal below is a fact the normalization REFUSED to supply rather than
 * a fact it made up.
 *
 * The correction-authority cases (CN6) run the same normalization and then the real facade, because
 * what that surface has to prove is not the shape it produces but whether an already-accepted finding
 * actually admits a bounded corrector — and whether anything less than two resolved evidence links
 * still fails closed.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { compileForTarget } from '../core/compile/compile-for-target.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';
import { normalizeOperatorRequest, type NormalizedOperatorRequest } from './operator-request.ts';

const PLAN = '# Build plan\n\nBounded storage only.\n';

function fixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'pi-charter-operator-'));
  writeFileSync(join(root, 'PLAN.md'), PLAN, 'utf8');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const SIMPLE = (root: string): Record<string, unknown> => ({
  task: 'implement JSON persistence',
  role: 'implement',
  target: 'subagents',
  authority: 'PLAN.md',
  scope: ['internal/store/**'],
  root,
  fresh: 'required',
  gates: ['go test ./internal/store/...', 'go vet ./internal/store/...'],
});

function expectOk(result: ReturnType<typeof normalizeOperatorRequest>) {
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) throw new Error('unreachable');
  return result.request;
}

function expectErrors(result: ReturnType<typeof normalizeOperatorRequest>) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  return result.errors;
}

const MODEL = 'model-under-test';
const PROFILE: ModelProfile = { workhorse: { preferred: MODEL, fallback: [] }, reviewer: { preferred: MODEL, fallback: [] } };

/**
 * The admission step the Pi surface performs: the normalized request goes to the real facade. Nothing
 * is added here except the CLAIM channel a library caller must state — the claim asserts no capability,
 * so this test can only ever observe admission without enforcement, never ENFORCED truth.
 */
function admit(request: NormalizedOperatorRequest) {
  return compileForTarget({
    task_contract: request.task_contract,
    authority_binder: request.authority_binder,
    correction_binder: request.correction_binder,
    model_profile: PROFILE,
    available: [MODEL],
    capability_claim: {
      name: 'parent',
      capabilities: {
        model_selection: false,
        fresh_session: false,
        tool_ceiling: false,
        file_scope_enforcement: false,
        independent_review: false,
      },
    },
  });
}

/** One accepted correction target, as an operator states it: references only, never a binder. */
const ACCEPTED = [{ target: 'P1', finding: 'review-finding:P1', acceptance: 'owner-acceptance:P1' }];

const CORRECTOR: Record<string, unknown> = {
  task: 'reject duplicate task ids',
  role: 'correct',
  target: 'parent',
  authority: 'PLAN.md',
  scope: ['internal/store/json.go', 'internal/store/json_test.go'],
  gates: ['go test ./internal/store/...'],
};

test('CN0 — simple intent normalizes into the canonical strict TaskContract', () => {
  const { root, cleanup } = fixture();
  try {
    const request = expectOk(normalizeOperatorRequest(SIMPLE(root), { cwd: root }));
    assert.equal(request.request_kind, 'simple');
    assert.deepEqual(request.task_contract, {
      version: 'charter/v0.1',
      task: { id: 'implement-json-persistence', class: 'T1', risk: 'low' },
      role: 'implement',
      execution_target: 'subagents',
      root,
      authority: { sources: ['PLAN.md'] },
      scope: { directories: ['internal/store/**'] },
      permissions: { code_write: true, research: false, external_write: false, release: false },
      acceptance: { commands: ['go test ./internal/store/...', 'go vet ./internal/store/...'] },
      verification: { level: 'V1' },
    });
    assert.equal(request.authority_reference, 'PLAN.md');
    assert.deepEqual(request.authority_document, { reference: 'PLAN.md', path: join(root, 'PLAN.md') });
    assert.equal(request.fresh_context, 'REQUIRED');
    // No model pin exists on the canonical contract: routing stays a requirement (CN2).
    assert.equal('model' in request.task_contract, false);
  } finally {
    cleanup();
  }
});

test('CN0 — the same intent always produces the same contract identity, and role drives permissions', () => {
  const { root, cleanup } = fixture();
  try {
    const first = expectOk(normalizeOperatorRequest(SIMPLE(root), { cwd: root }));
    const second = expectOk(normalizeOperatorRequest(SIMPLE(root), { cwd: root }));
    assert.deepEqual(first.task_contract, second.task_contract);

    const review = expectOk(
      normalizeOperatorRequest({ ...SIMPLE(root), role: 'review', fresh: 'not_required' }, { cwd: root }),
    );
    // A read-only role is never granted write authority by this surface, and `fresh` is stated, not inferred.
    assert.deepEqual(review.task_contract.permissions, {
      code_write: false,
      research: false,
      external_write: false,
      release: false,
    });
    assert.equal(review.fresh_context, 'NOT_REQUIRED');
  } finally {
    cleanup();
  }
});

test('CN0 — the root defaults to the session directory, and the authority document is read from it', () => {
  const { root, cleanup } = fixture();
  try {
    const request = expectOk(
      normalizeOperatorRequest(
        { task: 'implement JSON persistence', role: 'implement', target: 'subagents', authority: 'PLAN.md', scope: ['internal/store/**'], gates: ['go test ./...'] },
        { cwd: root },
      ),
    );
    assert.equal(request.task_contract.root, root);
    assert.equal(request.authority_document?.path, join(root, 'PLAN.md'));
  } finally {
    cleanup();
  }
});

test('CN0 — a fresh child session cannot be required of the parent target', () => {
  const { root, cleanup } = fixture();
  try {
    const errors = expectErrors(
      normalizeOperatorRequest({ ...SIMPLE(root), target: 'parent' }, { cwd: root }),
    );
    assert.deepEqual([...new Set(errors.map((error) => error.code))], ['UNSUPPORTED_BY_EXECUTION_TARGET']);
    assert.equal(errors[0]?.path, 'fresh');
  } finally {
    cleanup();
  }
});

test('CN0 — authority fails closed: no document, an escaping path, an absolute path, a directory, an empty file', () => {
  const { root, cleanup } = fixture();
  try {
    const cases: [string, string][] = [
      ['MISSING.md', 'no authority document'],
      ['../escape.md', 'escapes the declared root'],
      [join(root, 'PLAN.md'), 'absolute path'],
      ['.', 'not a regular file'],
      ['EMPTY.md', 'is empty'],
    ];
    writeFileSync(join(root, 'EMPTY.md'), '   \n', 'utf8');
    for (const [authority, expected] of cases) {
      const errors = expectErrors(normalizeOperatorRequest({ ...SIMPLE(root), authority }, { cwd: root }));
      assert.deepEqual([...new Set(errors.map((error) => error.code))], ['AUTHORITY_UNRESOLVED'], authority);
      assert.ok(errors[0]?.message.includes(expected) === true, `${authority}: ${errors[0]?.message}`);
    }
  } finally {
    cleanup();
  }
});

test('F3 — authority containment is a filesystem truth: a symlink cannot escape the declared root', () => {
  const { root, cleanup } = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'pi-charter-outside-'));
  try {
    writeFileSync(join(outside, 'OUTSIDE.md'), '# Outside\n\nNot this root\'s authority.\n', 'utf8');
    // A file link whose target is outside the root, and a directory link into outside: both deliver
    // content the declared root does not contain, so both refuse exactly like a lexical `../` escape.
    symlinkSync(join(outside, 'OUTSIDE.md'), join(root, 'LINKED.md'));
    symlinkSync(outside, join(root, 'linked-dir'));
    // A link that resolves INSIDE the root delivers in-root content and stays admitted.
    symlinkSync(join(root, 'PLAN.md'), join(root, 'INROOT-LINK.md'));

    const escaping: [string, string][] = [
      ['LINKED.md', 'resolves outside the declared root'],
      ['linked-dir/OUTSIDE.md', 'resolves outside the declared root'],
    ];
    for (const [authority, expected] of escaping) {
      const errors = expectErrors(normalizeOperatorRequest({ ...SIMPLE(root), authority }, { cwd: root }));
      assert.deepEqual([...new Set(errors.map((error) => error.code))], ['AUTHORITY_UNRESOLVED'], authority);
      assert.ok(errors[0]?.message.includes(expected) === true, `${authority}: ${errors[0]?.message}`);
    }

    const inRoot = expectOk(normalizeOperatorRequest({ ...SIMPLE(root), authority: 'INROOT-LINK.md' }, { cwd: root }));
    assert.equal(inRoot.authority_reference, 'INROOT-LINK.md');
    assert.deepEqual(inRoot.authority_binder.bind('INROOT-LINK.md')[0], {
      id: 'INROOT-LINK.md',
      source_kind: 'document',
      content: PLAN,
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
    cleanup();
  }
});

test('CN0 — a missing authority document is a refusal, never a fuzzy filename search', () => {
  const { root, cleanup } = fixture();
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'NESTED-PLAN.md'), PLAN, 'utf8');
    // The same document exists one directory down; a lookup that guessed by name would bind it.
    const errors = expectErrors(normalizeOperatorRequest({ ...SIMPLE(root), authority: 'NESTED-PLAN.md' }, { cwd: root }));
    assert.deepEqual([...new Set(errors.map((error) => error.code))], ['AUTHORITY_UNRESOLVED']);
    assert.ok(errors[0]?.message.includes('NESTED-PLAN.md') === true);
  } finally {
    cleanup();
  }
});

test('CN0 — the normalizer adds nothing of its own: an undeclared gate set or scope stays undeclared', () => {
  const { root, cleanup } = fixture();
  try {
    // No gates: acceptance is declared nowhere, and the normalizer does not invent one.
    const request = expectOk(
      normalizeOperatorRequest({ ...SIMPLE(root), gates: [] }, { cwd: root }),
    );
    assert.equal(request.task_contract.acceptance.commands, undefined);
    // No scope: nothing is added either — a writing role with empty scope is core`s refusal to make.
    const scopeless = expectOk(normalizeOperatorRequest({ ...SIMPLE(root), scope: [] }, { cwd: root }));
    assert.deepEqual(scopeless.task_contract.scope, {});
  } finally {
    cleanup();
  }
});

test('CN0 — the advanced path still compiles a canonical contract, unchanged', () => {
  const contract = {
    version: 'charter/v0.1',
    task: { id: 'advanced', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'parent',
    root: '/projects/advanced',
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V2' },
  };
  const request = expectOk(
    normalizeOperatorRequest(
      { task_contract: contract, authority_evidence: { source: 'canonical-master', doc: 'MASTER.md', revision: '7' } },
      { cwd: '/projects/advanced' },
    ),
  );
  assert.equal(request.request_kind, 'advanced');
  // Verbatim: the caller's own contract is not normalized, cloned into a different shape, or repaired.
  assert.equal(request.task_contract, contract);
  assert.equal(request.authority_reference, 'canonical-master');
  const bindings = request.authority_binder.bind('canonical-master');
  assert.equal(bindings.length, 1);
  assert.deepEqual(bindings[0], { id: 'canonical-master', content: { doc: 'MASTER.md', revision: '7' } });
  assert.equal(request.fresh_context, 'NOT_REQUIRED');
});

test('F2 — the released v0.1.1 advanced invocation (task_contract + authority object) still works', () => {
  const contract = {
    version: 'charter/v0.1',
    task: { id: 'advanced', class: 'T1', risk: 'low' },
    role: 'implement',
    execution_target: 'parent',
    root: '/projects/advanced',
    authority: { sources: ['canonical-master'] },
    scope: { files: ['src/feature.ts'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V2' },
  };
  // The exact v0.1.1 tool invocation: the evidence object is spelled `authority`, beside the contract.
  const request = expectOk(
    normalizeOperatorRequest(
      { task_contract: contract, authority: { source: 'canonical-master', doc: 'MASTER.md', revision: '7' } },
      { cwd: '/projects/advanced' },
    ),
  );
  assert.equal(request.request_kind, 'advanced');
  assert.equal(request.task_contract, contract);
  assert.equal(request.authority_reference, 'canonical-master');
  const bindings = request.authority_binder.bind('canonical-master');
  assert.equal(bindings.length, 1);
  assert.deepEqual(bindings[0], { id: 'canonical-master', content: { doc: 'MASTER.md', revision: '7' } });
  assert.equal(request.fresh_context, 'NOT_REQUIRED');
});

test('F2 — the evidence object is refused without a contract, and both spellings together are refused', () => {
  const legacyAlone = expectErrors(
    normalizeOperatorRequest({ authority: { source: 'canonical-master', doc: 'MASTER.md' } }, { cwd: '/projects/advanced' }),
  );
  assert.deepEqual([...new Set(legacyAlone.map((error) => error.code))], ['INVALID_TASK_CONTRACT']);
  assert.equal(legacyAlone[0]?.path, 'authority');
  assert.ok(legacyAlone[0]?.message.includes('task_contract') === true);

  const both = expectErrors(
    normalizeOperatorRequest(
      {
        task_contract: { version: 'charter/v0.1' },
        authority: { source: 'canonical-master', doc: 'MASTER.md' },
        authority_evidence: { source: 'canonical-master', doc: 'MASTER.md' },
      },
      { cwd: '/projects/advanced' },
    ),
  );
  assert.deepEqual([...new Set(both.map((error) => error.code))], ['AUTHORITY_UNRESOLVED']);
  assert.equal(both[0]?.path, 'authority_evidence');
  assert.ok(both[0]?.message.includes('never both') === true);
});

test('CN0 — ambiguous and malformed requests are refused, never half-normalized', () => {
  const { root, cleanup } = fixture();
  try {
    const both = expectErrors(
      normalizeOperatorRequest(
        { ...SIMPLE(root), task_contract: { whatever: true }, authority_evidence: { source: 'x', doc: 'y' } },
        { cwd: root },
      ),
    );
    assert.ok(both[0]?.message.includes('both present') === true, 'a request is never half-normalized and half-authored');

    const noEvidence = expectErrors(
      normalizeOperatorRequest({ task_contract: { version: 'charter/v0.1' } }, { cwd: root }),
    );
    assert.deepEqual([...new Set(noEvidence.map((error) => error.code))], ['AUTHORITY_UNRESOLVED']);

    const unknown = expectErrors(normalizeOperatorRequest({ ...SIMPLE(root), model: 'gpt-x' }, { cwd: root }));
    assert.deepEqual([...new Set(unknown.map((error) => error.code))], ['INVALID_TASK_CONTRACT']);
    assert.equal(unknown[0]?.path, 'model');

    const relativeRoot = expectErrors(
      normalizeOperatorRequest({ ...SIMPLE(root), root: 'relative/root' }, { cwd: root }),
    );
    assert.equal(relativeRoot[0]?.path, 'root');
  } finally {
    cleanup();
  }
});

test('CN0 — the two surfaces never blend: advanced evidence without a contract is refused by name', () => {
  const errors = expectErrors(
    normalizeOperatorRequest({ authority_evidence: { source: 'canonical-master', doc: 'MASTER.md' } }, { cwd: '/projects/advanced' }),
  );
  assert.deepEqual([...new Set(errors.map((error) => error.code))], ['INVALID_TASK_CONTRACT']);
  assert.equal(errors[0]?.path, 'authority_evidence');
  assert.ok(errors[0]?.message.includes('task_contract') === true);
});

// ── CN6 — accepted correction authority reaches role=correct ────────────────

test('CN6 — an accepted finding admits a bounded corrector, with both evidence links carried', () => {
  const { root, cleanup } = fixture();
  try {
    const request = expectOk(
      normalizeOperatorRequest({ ...CORRECTOR, correction_authority: ACCEPTED }, { cwd: root }),
    );
    // The stated target IS the blocker the contract declares, alongside the operator's own scope.
    assert.deepEqual(request.task_contract.scope, {
      directories: ['internal/store/json.go', 'internal/store/json_test.go'],
      blockers: ['P1'],
    });
    assert.deepEqual(request.task_contract.permissions, {
      code_write: true,
      research: false,
      external_write: false,
      release: false,
    });
    // The package built the live binder: the operator handed over references, not binder internals.
    assert.deepEqual(request.correction_binder?.findings.bind('P1'), [
      { id: 'review-finding:P1', content: 'review-finding:P1' },
    ]);
    assert.deepEqual(request.correction_binder?.acceptances.bind('P1'), [
      { id: 'owner-acceptance:P1', content: 'owner-acceptance:P1' },
    ]);

    const admitted = admit(request);
    assert.equal(admitted.ok, true, JSON.stringify(admitted.ok ? [] : admitted.errors));
    if (!admitted.ok) return;
    assert.equal(admitted.compiled.role_envelope.role, 'correct');
    assert.equal(admitted.compiled.execution_contract.execution_target, 'parent');
    const targets = admitted.compiled.execution_contract.correction_targets;
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.id, 'P1');
    // Two DISTINCT resolved links: the finding, and the acceptance of it. Neither substitutes for the other.
    assert.equal(targets[0]?.finding.binding_id, 'review-finding:P1');
    assert.equal(targets[0]?.acceptance.binding_id, 'owner-acceptance:P1');
    assert.match(targets[0]?.finding.content_digest ?? '', /^[0-9a-f]{64}$/);
    assert.notEqual(targets[0]?.finding.content_digest, targets[0]?.acceptance.content_digest);
  } finally {
    cleanup();
  }
});

test('CN6 — less than two resolved links refuses: unaccepted, unfound, ambiguous, or asserted by flag', () => {
  const { root, cleanup } = fixture();
  try {
    const cases: [string, unknown, string][] = [
      // A finding nobody accepted is a report, not correction authority.
      ['acceptance', [{ target: 'P1', finding: 'review-finding:P1' }], 'correction_authority[0].acceptance'],
      // A target with no finding evidence is not correctable.
      ['finding', [{ target: 'P1', acceptance: 'owner-acceptance:P1' }], 'correction_authority[0].finding'],
      // An unnamed target names nothing to correct.
      ['target', [{ finding: 'review-finding:P1', acceptance: 'owner-acceptance:P1' }], 'correction_authority[0].target'],
      // An empty authority is not 'no correction needed': it is a request with nothing admitted.
      ['empty', [], 'correction_authority'],
      // A string is not a target list.
      ['not-a-list', 'P1', 'correction_authority'],
      // A boolean is an assertion, not evidence: the field is refused by name.
      ['flag', [{ ...ACCEPTED[0], accepted: true }], 'correction_authority[0].accepted'],
    ];
    for (const [label, correction_authority, path] of cases) {
      const errors = expectErrors(
        normalizeOperatorRequest({ ...CORRECTOR, correction_authority }, { cwd: root }),
      );
      assert.deepEqual([...new Set(errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION'], label);
      assert.equal(errors[0]?.path, path, label);
    }

    // The same target twice is ambiguous: it is refused rather than collapsed onto one entry.
    const duplicate = expectErrors(
      normalizeOperatorRequest(
        {
          ...CORRECTOR,
          correction_authority: [
            { target: 'P1', finding: 'review-finding:P1', acceptance: 'owner-acceptance:P1' },
            { target: 'P1', finding: 'review-finding:P1-other', acceptance: 'owner-acceptance:P1-other' },
          ],
        },
        { cwd: root },
      ),
    );
    assert.equal(duplicate[0]?.path, 'correction_authority[1].target');
    assert.ok(duplicate[0]?.message.includes('more than once') === true);
  } finally {
    cleanup();
  }
});

test('CN6 — correction authority and the role that may use it refuse one another when only one is stated', () => {
  const { root, cleanup } = fixture();
  try {
    // A corrector with nothing accepted has nothing to correct.
    const unstated = expectErrors(normalizeOperatorRequest(CORRECTOR, { cwd: root }));
    assert.deepEqual([...new Set(unstated.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
    assert.equal(unstated[0]?.path, 'correction_authority');
    assert.ok(unstated[0]?.message.includes('already accepted') === true);

    // A role whose purpose is not correction cannot be handed correction authority.
    const wrongRole = expectErrors(
      normalizeOperatorRequest({ ...CORRECTOR, role: 'implement', correction_authority: ACCEPTED }, { cwd: root }),
    );
    assert.deepEqual([...new Set(wrongRole.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
    assert.equal(wrongRole[0]?.path, 'correction_authority');
    assert.ok(wrongRole[0]?.message.includes("role 'implement' cannot correct") === true);
  } finally {
    cleanup();
  }
});

test('CN6 — a declared blocker with no stated evidence link fails closed at admission', () => {
  // The advanced path declares its own blockers: this contract says P2 is what may be corrected.
  const contract = {
    version: 'charter/v0.1',
    task: { id: 'correction-admission', class: 'T3', risk: 'high' },
    role: 'correct',
    execution_target: 'parent',
    root: '/projects/correction',
    authority: { sources: ['canonical-master'] },
    scope: { blockers: ['P2'], files: ['internal/example.go'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['go test ./...'] },
    verification: { level: 'V2' },
  };
  const authority_evidence = { source: 'canonical-master', doc: 'MASTER.md' };
  const cwd = '/projects/correction';

  // Stated evidence exists, but only for P1 — an unresolvable target admits no correction.
  const mismatch = expectOk(
    normalizeOperatorRequest(
      { task_contract: contract, authority_evidence, correction_authority: ACCEPTED },
      { cwd },
    ),
  );
  const refused = admit(mismatch);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.deepEqual([...new Set(refused.errors.map((error) => error.code))], ['CONTRACT_CONTRADICTION']);
  assert.equal(refused.errors[0]?.path, 'scope.blockers');
  assert.ok(refused.errors[0]?.message.includes("'P2'") === true);

  // Stating nothing at all is still the same fail-closed refusal it always was: a target identifier
  // on its own was never correction authority.
  const bare = expectOk(
    normalizeOperatorRequest({ task_contract: contract, authority_evidence }, { cwd }),
  );
  const bareRefused = admit(bare);
  assert.equal(bareRefused.ok, false);
  if (bareRefused.ok) return;
  assert.equal(bareRefused.errors[0]?.path, 'scope.blockers');
  assert.ok(bareRefused.errors[0]?.message.includes('no correction-authority binder') === true);
});
