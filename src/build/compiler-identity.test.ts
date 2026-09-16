/**
 * H1 — the compiler build identity is real (v0.1.1 Wave 2 — BUILD1, BUILD2; F2 — BUILD3/BUILD5/BUILD6).
 *
 * The identity must come from the compiled runtime artifact set: the same artifact set gives the same
 * identity, a material change to a compiled artifact gives a different one, and a stale record can
 * never authorize the modified set. A hardcoded SHA, a date label, the package version pretending to
 * be an artifact identity, an artifact the package does not ship, and a caller-supplied string all
 * fail these probes.
 */

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileForTarget } from '../core/compile/compile-for-target.ts';
import { COMPILER_IDENTITY_FILE, computeCompilerIdentity, listCompiledArtifacts, readCompilerIdentity } from './compiler-identity.ts';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_ROOT = resolve(DIST, '..');

test('BUILD1 — the recorded identity describes the artifact set that was actually built', () => {
  const recorded = readCompilerIdentity();
  assert.equal(recorded.ok, true);
  if (!recorded.ok) return;

  // Same artifact set → same identity, computed the same way twice.
  assert.equal(recorded.compiler_identity, computeCompilerIdentity(DIST));
  assert.equal(computeCompilerIdentity(DIST), computeCompilerIdentity(DIST));

  // It is an artifact digest, not the product version wearing a build identity's clothes.
  const pkg = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string };
  assert.notEqual(recorded.compiler_identity, pkg.version);
  assert.notEqual(recorded.compiler_identity, 'charter/v0.1');
  assert.match(recorded.compiler_identity, /^sha256:[0-9a-f]{64}$/);

  // The recorded identity is derived from the compiled artifact set, which is non-empty and real.
  assert.ok(listCompiledArtifacts(DIST).length > 20, 'the compiled artifact set must be present');
  assert.ok(listCompiledArtifacts(DIST).every((path) => path.endsWith('.js') || path.endsWith('.d.ts')));
});

test('BUILD2 — a material compiled-artifact change changes the identity', () => {
  const copy = mkdtempSync(join(tmpdir(), 'pi-charter-identity-'));
  try {
    cpSync(DIST, copy, { recursive: true });
    const baseline = computeCompilerIdentity(copy);
    assert.equal(baseline, computeCompilerIdentity(DIST), 'a faithful copy is the same artifact set');

    // One byte of one compiled artifact.
    const artifact = join(copy, 'core', 'enforcement', 'target-binding.js');
    writeFileSync(artifact, `${readFileSync(artifact, 'utf8')}\n// material change\n`, 'utf8');
    assert.notEqual(computeCompilerIdentity(copy), baseline);

    // A declaration change counts too: types are part of what consumers compile against.
    const declaration = join(copy, 'index.d.ts');
    writeFileSync(declaration, `${readFileSync(declaration, 'utf8')}\n// material change\n`, 'utf8');
    const afterDeclaration = computeCompilerIdentity(copy);

    // An added artifact counts.
    writeFileSync(join(copy, 'core', 'added.js'), 'export const added = true;\n', 'utf8');
    assert.notEqual(computeCompilerIdentity(copy), afterDeclaration);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test('BUILD3 (F2) — a tampered runtime artifact refuses against the recorded identity', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'pi-charter-tamper-'));
  try {
    const artifactsDir = join(scratch, 'dist');
    cpSync(DIST, artifactsDir, { recursive: true });
    const recordPath = join(scratch, COMPILER_IDENTITY_FILE);
    cpSync(resolve(PACKAGE_ROOT, COMPILER_IDENTITY_FILE), recordPath);

    // The faithful copy verifies against the record: the record is an expectation, and it holds.
    const fresh = readCompilerIdentity({ artifactsDir, recordPath });
    assert.equal(fresh.ok, true);
    if (!fresh.ok) return;

    // One byte of one SHIPPED runtime artifact makes the record stale, and stale refuses.
    const artifact = join(artifactsDir, 'core', 'enforcement', 'target-binding.js');
    writeFileSync(artifact, `${readFileSync(artifact, 'utf8')}\n// material change\n`, 'utf8');
    const stale = readCompilerIdentity({ artifactsDir, recordPath });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.reason.includes('COMPILER_IDENTITY_MISMATCH'), true);

    // A declaration change is a material artifact change too.
    const declaration = join(artifactsDir, 'index.d.ts');
    writeFileSync(declaration, `${readFileSync(declaration, 'utf8')}\n// material change\n`, 'utf8');
    const staleDeclaration = readCompilerIdentity({ artifactsDir, recordPath });
    assert.equal(staleDeclaration.ok, false);

    // An explicit rebuild records the current set, and the record verifies again.
    const rebuilt = computeCompilerIdentity(artifactsDir);
    writeFileSync(recordPath, `${JSON.stringify({ compiler_identity: rebuilt })}\n`, 'utf8');
    const afterRebuild = readCompilerIdentity({ artifactsDir, recordPath });
    assert.equal(afterRebuild.ok, true);
    if (!afterRebuild.ok) return;
    assert.equal(afterRebuild.compiler_identity, rebuilt);
    assert.notEqual(rebuilt, fresh.compiler_identity);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('BUILD5 (F2) — test-only artifacts are not part of the runtime identity', () => {
  const copy = mkdtempSync(join(tmpdir(), 'pi-charter-tests-only-'));
  try {
    cpSync(DIST, copy, { recursive: true });
    const baseline = computeCompilerIdentity(copy);

    // The package excludes test artifacts; they must not define the shipped runtime identity.
    const testArtifactRelative = 'build/compiler-identity.test.js';
    assert.equal(existsSync(join(copy, testArtifactRelative)), true, 'the build emits test artifacts, which the set must skip');
    assert.equal(listCompiledArtifacts(copy).includes(testArtifactRelative), false);

    const testArtifact = join(copy, testArtifactRelative);
    writeFileSync(testArtifact, `${readFileSync(testArtifact, 'utf8')}\n// test-only change\n`, 'utf8');
    assert.equal(computeCompilerIdentity(copy), baseline);

    // A shipped artifact still counts.
    const shipped = join(copy, 'index.js');
    writeFileSync(shipped, `${readFileSync(shipped, 'utf8')}\n// shipped change\n`, 'utf8');
    assert.notEqual(computeCompilerIdentity(copy), baseline);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test('BUILD6 (F2) — a caller cannot supply or override the compiler identity', () => {
  const result = compileForTarget({
    task_contract: {},
    authority_binder: {},
    model_profile: {},
    compiler_identity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]?.path, 'compiler_identity');
  assert.equal(result.errors[0]?.message.includes('unknown field'), true);
});
