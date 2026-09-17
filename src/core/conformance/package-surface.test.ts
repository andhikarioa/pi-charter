import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as charter from '../../index.ts';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('package exposes one blessed subpath and a small high-level compiler/operator surface', async () => {
  const pkg = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(pkg.exports), ['.']);

  const blessed = (await import('pi-charter')) as Record<string, unknown>;
  for (const name of [
    'compileForTarget',
    'normalizeOperatorRequest',
    'compileDelegation',
    'renderParentCompile',
    'renderDelegationCompile',
    'renderRefusal',
    'createAuthorityBinder',
    'createEvidenceBinder',
    'createAdapterIntegration',
  ]) {
    assert.equal(typeof blessed[name], 'function', `'${name}' must be reachable from the package entry point`);
  }
});

test('internal compiler phases and trust minters are not public SDK contracts', () => {
  const internal = [
    'validateTaskContract',
    'resolveExecutionContract',
    'bindExecutionTarget',
    'compileRoleEnvelope',
    'createResolutionReceipt',
    'resolveJurisdiction',
    'createAttestationVerifier',
    'markIssuedAttestationVerifier',
    'isIssuedAttestationVerifier',
    'createHostAuthorizedAdapterIntegration',
    'isHostAdapterAuthority',
    'HOST_ADAPTER_AUTHORITY',
    'readCompilerIdentity',
    'writeCompilerIdentity',
    'computeCompilerIdentity',
  ];
  for (const name of internal) {
    assert.equal(name in charter, false, `'${name}' must not be reachable from the package entry point`);
  }
});

test('internal package subpaths remain unreachable', async () => {
  for (const subpath of [
    'pi-charter/core/attestation/trusted-boundary.js',
    'pi-charter/core/resolver/resolve.js',
    'pi-charter/package.json',
  ]) {
    await assert.rejects(
      () => import(subpath),
      (error: NodeJS.ErrnoException) => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      `${subpath} must not be an exported package path`,
    );
  }
});

test('compiled package is the blessed artifact, not a source path', () => {
  const pkg = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    exports: { '.': { types: string; default: string } };
    engines?: { node?: string };
  };
  assert.equal(pkg.exports['.'].default, './dist/index.js');
  assert.equal(pkg.exports['.'].types, './dist/index.d.ts');
  assert.equal(typeof pkg.engines?.node, 'string');

  const declaration = readFileSync(resolve(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');
  assert.equal(declaration.includes('.ts\''), false, 'declarations must reference emitted modules');
  assert.equal(declaration.includes('/Users/'), false, 'declarations must not leak absolute source paths');
});
