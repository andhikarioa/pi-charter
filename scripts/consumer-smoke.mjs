/**
 * External package consumer smoke (U3 + F3) — consume the packed artifact from outside the repo.
 *
 * The package is packed, installed into a throwaway consumer project, and exercised through its one
 * supported entry point. Nothing here reads the source tree: the consumer sees exactly what npm
 * would ship, which is where the stale-identity and deep-import failure modes would surface.
 *
 *   - the blessed entry resolves to compiled dist/ JavaScript, not a source path
 *   - internal trust minters are unreachable from outside
 *   - the recorded compiler identity verifies against the SHIPPED (test-free) artifact set
 *   - the Pi extension manifest and file ship, so Pi can discover the integration
 *   - the supported adapter contract is usable by an external consumer
 *
 * Usage: node scripts/consumer-smoke.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const scratch = mkdtempSync(join(tmpdir(), 'pi-charter-consumer-'));
try {
  execFileSync('npm', ['pack', '--pack-destination', scratch], { cwd: ROOT, stdio: 'inherit' });
  const tarball = readdirSync(scratch).find((entry) => entry.endsWith('.tgz'));
  assert(tarball !== undefined, 'npm pack must produce a tarball');

  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'pi-charter-consumer-smoke', private: true, type: 'module' }, null, 2)}\n`,
  );
  execFileSync(
    'npm',
    ['install', '--no-audit', '--no-fund', '--no-package-lock', '--ignore-scripts', join(scratch, tarball)],
    { cwd: consumer, stdio: 'inherit' },
  );

  const installed = join(consumer, 'node_modules', 'pi-charter');
  assert(existsSync(join(installed, 'dist', 'index.js')), 'the packed artifact must ship compiled dist/');
  assert(existsSync(join(installed, 'compiler-identity.json')), 'the packed artifact must ship the build identity');

  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert(manifest.exports?.['.']?.default === './dist/index.js', 'the blessed entry must be compiled JavaScript');
  assert(manifest.pi?.extensions?.includes('./extensions'), 'the package must declare the Pi extension surface');
  assert(existsSync(join(installed, 'extensions', 'pi-charter.ts')), 'the Pi extension file must ship');
  assert(manifest.files.includes('extensions'), 'the package manifest must ship the extensions directory');

  const consumerModule = join(consumer, 'consumer.mjs');
  writeFileSync(consumerModule, `${CONSUMER_SOURCE()}\n`);
  execFileSync(process.execPath, [consumerModule], { cwd: consumer, stdio: 'inherit' });
  console.log('external package consumer smoke: PASS');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/** Runs inside the throwaway consumer project, against the installed tarball only. */
function CONSUMER_SOURCE() {
  return `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import * as charter from 'pi-charter';

// The blessed entry is the compiled package, and the internal trust minters are absent from it.
const resolved = createRequire(import.meta.url).resolve('pi-charter');
assert.equal(resolved.endsWith('dist/index.js'), true, 'pi-charter must resolve to dist/index.js, got ' + resolved);
for (const internal of ['createExecutionAttestationIssuer', 'createAttestationVerifier', 'readCompilerIdentity', 'markIssuedExecutionAttestation']) {
  assert.equal(internal in charter, false, internal + ' must not be reachable from the package entry point');
}

// A normal consumer compiles through the blessed facade, with the SHIPPED compiler identity.
const contract = {
  version: 'charter/v0.1',
  task: { id: 'consumer-smoke', class: 'T1', risk: 'medium' },
  role: 'implement',
  execution_target: 'parent',
  root: '/projects/consumer-smoke',
  authority: { sources: ['consumer-spec'] },
  scope: { files: ['src/feature.ts'] },
  permissions: { code_write: true, research: false, external_write: false, release: false },
  acceptance: { commands: ['npm test'] },
  verification: { level: 'V1' },
};
const compiled = charter.compileForTarget({
  task_contract: contract,
  authority_binder: charter.createAuthorityBinder({ 'consumer-spec': { doc: 'CONSUMER-SPEC.md', revision: '1' } }),
  model_profile: { workhorse: { preferred: 'consumer-model', fallback: [] } },
  available: ['consumer-model'],
  capability_claim: { name: 'parent', capabilities: { model_selection: false, fresh_session: false, tool_ceiling: false, file_scope_enforcement: false, independent_review: false } },
});
assert.equal(compiled.ok, true, 'the shipped package must compile through the facade: ' + JSON.stringify(compiled.errors));
assert.match(compiled.compiled.resolution_receipt.compiler_identity, /^sha256:[0-9a-f]{64}$/);

// The supported adapter contract is usable by an external consumer, and it mints no trust for them.
const adapter = charter.createAdapterIntegration({
  name: 'consumer-adapter',
  version: '1.0.0',
  observeEnvironment: () => ({ ok: true, observation: { target: 'parent', provider: 'consumer-provider', model: 'consumer-model', session_identity: 'consumer-session', runtime: process.version } }),
});
const viaAdapter = adapter.compile({
  task_contract: contract,
  authority_binder: charter.createAuthorityBinder({ 'consumer-spec': { doc: 'CONSUMER-SPEC.md', revision: '1' } }),
  model_profile: { workhorse: { preferred: 'consumer-model', fallback: [] } },
});
assert.equal(viaAdapter.ok, true, 'the adapter contract must compile from outside: ' + JSON.stringify(viaAdapter.errors));
const verified = adapter.verifyExecution({ execution_handle: viaAdapter.execution_handle });
assert.equal(verified.ok, true);
assert.equal(verified.verification.verdict, 'EXECUTION_CONFORMANT');
const unbound = adapter.verifyExecution({ execution_handle: 'unbound-handle-value' });
assert.equal(unbound.ok, false, 'an unbound handle must be refused for an external consumer too');

console.log('external consumer module: facade compile + adapter compile/verify PASS');
`;
}
