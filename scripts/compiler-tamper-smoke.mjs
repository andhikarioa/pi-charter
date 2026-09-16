/**
 * F2 compiler tamper smoke — build → tamper a shipped artifact → compilation refuses.
 *
 * This runs against a COPY of the built package, never the live `dist/`: the suite executes the real
 * `dist`, and a smoke that mutated it would corrupt the run it is measuring. Copying `dist`,
 * `package.json`, and `compiler-identity.json` reproduces the shipped package exactly, so the compile
 * path exercised here is the real one — `compileForTarget` reading `dist/build/compiler-identity.js`
 * from its own package root and verifying the record against the artifact set it is executing.
 *
 *   before tamper : the identity gate passes (any refusal must be about the junk contract)
 *   after  tamper : the gate refuses with COMPILER_IDENTITY_MISMATCH @ compiler_identity
 *   after  rebuild: an explicit rebuild records the new set and the gate passes again
 *
 * Usage: node scripts/compiler-tamper-smoke.mjs
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPILER_IDENTITY_FILE = 'compiler-identity.json';

/** A contract that is knowingly invalid: the identity gate must decide before validation does. */
const MINIMAL_INPUT = { task_contract: {}, authority_binder: {}, model_profile: {} };

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'pi-charter-f2-smoke-'));
try {
  const dist = join(scratch, 'dist');
  cpSync(resolve(ROOT, 'dist'), dist, { recursive: true });
  cpSync(resolve(ROOT, 'package.json'), join(scratch, 'package.json'));
  cpSync(resolve(ROOT, COMPILER_IDENTITY_FILE), join(scratch, COMPILER_IDENTITY_FILE));

  const charter = await import(pathToFileURL(join(dist, 'index.js')).href);
  const compilerIdentity = await import(pathToFileURL(join(dist, 'build', 'compiler-identity.js')).href);
  const originalIdentity = JSON.parse(readFileSync(join(scratch, COMPILER_IDENTITY_FILE), 'utf8')).compiler_identity;

  const before = charter.compileForTarget(MINIMAL_INPUT);
  assert(before.ok === false, 'the junk contract must be refused');
  assert(
    before.errors[0]?.path !== 'compiler_identity',
    `the identity gate must pass on a faithful build copy, got ${JSON.stringify(before.errors[0])}`,
  );
  console.log('tamper smoke: faithful copy passes the compiler identity gate');

  const artifact = join(dist, 'core', 'enforcement', 'target-binding.js');
  writeFileSync(artifact, `${readFileSync(artifact, 'utf8')}\n// tampered after build\n`, 'utf8');

  const tampered = charter.compileForTarget(MINIMAL_INPUT);
  assert(tampered.ok === false, 'compilation must be refused after a shipped artifact changed');
  assert(
    tampered.errors[0]?.path === 'compiler_identity',
    `the refusal must point at compiler_identity, got ${JSON.stringify(tampered.errors[0])}`,
  );
  assert(
    String(tampered.errors[0]?.message).includes('COMPILER_IDENTITY_MISMATCH'),
    `the refusal must name COMPILER_IDENTITY_MISMATCH, got ${String(tampered.errors[0]?.message)}`,
  );
  console.log('tamper smoke: tampered dist refused with COMPILER_IDENTITY_MISMATCH');

  const rebuiltIdentity = compilerIdentity.writeCompilerIdentity(dist);
  assert(
    rebuiltIdentity !== originalIdentity,
    'the rebuilt identity must differ from the pre-tamper record',
  );
  const afterRebuild = charter.compileForTarget(MINIMAL_INPUT);
  assert(
    afterRebuild.errors[0]?.path !== 'compiler_identity',
    `an explicit rebuild must satisfy the identity gate again, got ${JSON.stringify(afterRebuild.errors[0])}`,
  );
  console.log('tamper smoke: explicit rebuild records the new identity and the gate passes again');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('F2 compiler tamper smoke: PASS');
