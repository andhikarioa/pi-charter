/**
 * U2 — the package export boundary (v0.1.1 Wave 2 — PKG1, PKG2).
 *
 * The package ships one entry point. Internal trust machinery — the attestation verifier factory, the
 * execution-evidence issuance factory, both process-local boundary stores, the host adapter-authority
 * capability and its authorized integration factory, and the internal binding provenance store — is
 * deliberately absent from it, so an ordinary consumer cannot occupy a trust position through the
 * package at all. Deep filesystem imports from a source checkout are outside the blessed contract;
 * this probe is about the contract that IS blessed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as charter from '../../index.ts';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('PKG2 — internal trust minters are not on the package surface', () => {
  const internal = [
    'createAttestationVerifier',
    'markIssuedAttestationVerifier',
    'isIssuedAttestationVerifier',
    'createExecutionAttestationIssuer',
    'markIssuedExecutionAttestation',
    'isIssuedExecutionAttestation',
    'markCanonicalTargetBinding',
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

test('PKG2 — the package exposes exactly one subpath, and it is the blessed one', async () => {
  const pkg = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(pkg.exports), ['.']);

  // Real resolution, not a reading of the manifest: the package's own name resolves to the blessed
  // entry point, and an internal module is simply not addressable.
  const blessed = (await import('pi-charter')) as Record<string, unknown>;
  for (const name of ['compileForTarget', 'verifyExecutionAttestation', 'compileViaPi', 'verifyExecutionViaPi', 'bindExecutionTarget', 'compileBoundRoleEnvelope', 'createResolutionReceipt']) {
    assert.equal(typeof blessed[name], 'function', `'${name}' must be reachable from the package entry point`);
  }
  for (const subpath of ['pi-charter/core/attestation/trusted-boundary.js', 'pi-charter/core/execution/trusted-execution-boundary.js', 'pi-charter/core/execution/execution-attestation.js', 'pi-charter/package.json']) {
    await assert.rejects(
      () => import(subpath),
      (error: NodeJS.ErrnoException) => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      `${subpath} must not be an exported package path`,
    );
  }
});

test('PKG1 — the compiled package is the blessed artifact, not a source path', () => {
  const pkg = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    exports: { '.': { types: string; default: string } };
    engines?: { node?: string };
  };
  assert.equal(pkg.exports['.'].default, './dist/index.js');
  assert.equal(pkg.exports['.'].types, './dist/index.d.ts');
  assert.equal(typeof pkg.engines?.node, 'string');

  // The blessed entry is compiled JavaScript plus declarations: no `--experimental-strip-types`, and
  // no absolute path to a TypeScript source file.
  const declaration = readFileSync(resolve(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');
  assert.equal(declaration.includes('.ts\''), false, 'declarations must reference emitted modules');
  assert.equal(declaration.includes('/Users/'), false, 'declarations must not leak absolute source paths');
});
