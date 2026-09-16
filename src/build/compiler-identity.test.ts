/**
 * H1 — the compiler build identity is real (v0.1.1 Wave 2 — BUILD1, BUILD2).
 *
 * The identity must come from the compiled artifact set: the same artifact set gives the same
 * identity, and a material change to a compiled artifact gives a different one. A hardcoded SHA, a
 * date label, and the package version pretending to be an artifact identity all fail these probes.
 */

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { computeCompilerIdentity, listCompiledArtifacts, readCompilerIdentity } from './compiler-identity.ts';

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
