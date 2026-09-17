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
 *   - SMOKE 1: the public adapter is compile-only; post-execution admission/verification is absent
 *   - SMOKE 2 (F3): an external adapter reports only the capability axes it observed. From OUTSIDE the
 *     package its observations are CANDIDATES: no attested capability, no attested model, and no
 *     ENFORCED — the host-authorized position is not reachable from here. Observed true, observed
 *     false, and omitted stay three distinct observations
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
for (const internal of ['createAttestationVerifier', 'readCompilerIdentity', 'verifyExecutionAttestation', 'observeExecutionViaPi', 'verifyExecutionViaPi', 'decideNextAction']) {
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

// The supported adapter contract is usable by an external consumer, and it mints no trust for them:
// the host-authorized position is not reachable from this package surface at all.
for (const hostOnly of ['createHostAuthorizedAdapterIntegration', 'isHostAdapterAuthority', 'HOST_ADAPTER_AUTHORITY']) {
  assert.equal(hostOnly in charter, false, hostOnly + ' must not be reachable from the package entry point');
}
//
// SMOKE 1 — the public adapter is compile-only. Charter emits bounded governance and stops there.
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
assert.equal(viaAdapter.compiled.execution_contract.model_availability.class, 'unattested_claim', 'an ordinary consumer cannot attest the model it declares');
assert.equal(viaAdapter.compiled.target_binding.capability_evidence.class, 'unattested_claim');
assert.deepEqual(Object.keys(adapter), ['compile'], 'the supported adapter must own no post-execution lifecycle');
for (const name of ['observeExecution', 'verifyExecution', 'markExecutionObserved', 'markExecuted', 'createExecutionObservation', 'verifyExecutionAttestation']) {
  assert.equal(name in charter, false, name + ' must not be reachable from the package entry point');
}
console.log('SMOKE 1 — compile-only adapter: no post-execution lifecycle surface');

// SMOKE 2 — adapter capability observation, from the ordinary consumer position. The adapter reports
// only the axes it observed, and from here those observations are candidates: observed axes are never
// promoted, omitted axes are never inherited, and required axes still refuse.
const observeContract = (taskContract) => ({
  task_contract: taskContract,
  authority_binder: charter.createAuthorityBinder({ 'consumer-spec': { doc: 'CONSUMER-SPEC.md', revision: '1' } }),
  model_profile: { workhorse: { preferred: 'consumer-model', fallback: [] } },
});
const observing = charter.createAdapterIntegration({
  name: 'consumer-capability-adapter',
  version: '1.0.0',
  observeEnvironment: () => ({ ok: true, observation: { target: 'parent', provider: 'consumer-provider', model: 'consumer-model', session_identity: 'consumer-session', runtime: process.version } }),
  observeCapabilities: () => ({ ok: true, observed: { fresh_session: true, independent_review: true } }),
});
const reviewContract = {
  ...contract,
  acceptance: { commands: ['npm test'], review: { required: true, independence: 'independent', executor: 'fresh_session' } },
};
const refusedReview = observing.compile(observeContract(reviewContract));
assert.equal(refusedReview.ok, false, 'a required capability needs trusted evidence, which an ordinary consumer cannot obtain');
const observedPolicy = observing.compile(observeContract({ ...contract, execution_policy: { allowed_tools: ['read'] } }));
assert.equal(observedPolicy.ok, true, 'the untrusted contract still compiles; it just proves nothing');
assert.equal(observedPolicy.compiled.target_binding.capability_evidence.class, 'unattested_claim');
assert.equal(observedPolicy.compiled.target_binding.enforcement.allowed_tools, 'INSTRUCTED');
assert.equal(Object.values(observedPolicy.compiled.target_binding.enforcement).includes('ENFORCED'), false, 'nothing observed from here may reach ENFORCED');

// tool_ceiling and file_scope_enforcement were omitted, so a contract that requires them refuses.
const requiring = {
  ...contract,
  execution_policy: { allowed_tools: ['read'] },
  requirements: { enforcement: { allowed_tools: 'required' } },
};
const refused = observing.compile(observeContract(requiring));
assert.equal(refused.ok, false, 'an omitted capability axis must not be inherited from a neighbouring one');
assert.equal(refused.errors[0].code, 'UNSUPPORTED_BY_EXECUTION_TARGET');

// A name is not a boundary: pi-charter and pi-subagents establish nothing out here.
for (const name of ['pi-charter', 'pi-subagents', 'parent']) {
  const named = charter.createAdapterIntegration({
    name,
    version: '1.0.0',
    observeEnvironment: () => ({ ok: true, observation: { target: 'parent', provider: 'consumer-provider', model: 'consumer-model', session_identity: 'consumer-session', runtime: process.version } }),
    observeCapabilities: () => ({ ok: true, observed: { fresh_session: true, independent_review: true } }),
  });
  const asNamed = named.compile(observeContract(reviewContract));
  assert.equal(asNamed.ok, false, name + ' is a name, not a trusted runtime position');
}

// observed false, observed true, and omitted remain three DIFFERENT observations: the evidence
// identity over the observed axes distinguishes them, even on this candidate path.
const identityFor = (capabilities) => {
  const asCandidate = charter.createAdapterIntegration({
    name: 'consumer-tri-state-adapter',
    version: '1.0.0',
    observeEnvironment: () => ({ ok: true, observation: { target: 'parent', provider: 'consumer-provider', model: 'consumer-model', session_identity: 'consumer-session', runtime: process.version } }),
    observeCapabilities: () => ({ ok: true, observed: capabilities }),
  });
  const result = asCandidate.compile(observeContract(contract));
  assert.equal(result.ok, true, JSON.stringify(capabilities) + ' must compile: ' + JSON.stringify(result.errors));
  return result.compiled.target_binding.capability_evidence.evidence_identity;
};
const observedTrueIdentity = identityFor({ fresh_session: true });
const observedFalseIdentity = identityFor({ fresh_session: false });
const omittedIdentity = identityFor({});
assert.notEqual(observedTrueIdentity, observedFalseIdentity, 'observed true and observed false are different observations');
assert.notEqual(observedFalseIdentity, omittedIdentity, 'observed false must not be materialized as an omission');
assert.notEqual(observedTrueIdentity, omittedIdentity, 'observed true and omitted are different observations');

console.log('SMOKE 2 — adapter capability observation: candidates stay candidates, tri-state preserved, omitted axis refuses');

console.log('external consumer module: facade compile + ordinary adapter + capability truth PASS');
`;
}
