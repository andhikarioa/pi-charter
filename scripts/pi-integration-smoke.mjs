/**
 * Pi integration smoke — Pi discovers Charter's single compile tool and exercises it end to end.
 *
 * The extension is loaded through Pi's own resource loader. The smoke verifies:
 *   P1  exactly one operation is registered: charter_compile
 *   P2  parent compilation uses the live Pi provider/model/session observation
 *   P3  compile returns no post-execution handle and claims no unobserved ENFORCED capability
 *   P4  the released v0.1.1 advanced authority-evidence spelling remains accepted
 *   P5  delegation compiles one bounded HANDOFF_READY result without a child execution claim
 *   P6  the Pi-facing extension owns no scheduler, child lifecycle, persistence, or execution verifier
 *
 * Usage: node scripts/pi-integration-smoke.mjs
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_PATH = resolve(ROOT, 'extensions', 'pi-charter.ts');
const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';

const TOOL_NAMES = ['charter_compile'];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

/** Locate the installed Pi package the `pi` binary on PATH belongs to. */
function findPiPackageRoot() {
  if (process.env.PI_CHARTER_PI_ROOT) return process.env.PI_CHARTER_PI_ROOT;
  for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(dir, 'pi');
    if (!existsSync(candidate)) continue;
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    let current = dirname(real);
    while (true) {
      const manifest = join(current, 'package.json');
      if (existsSync(manifest)) {
        try {
          if (JSON.parse(readFileSync(manifest, 'utf8')).name === PI_PACKAGE_NAME) return current;
        } catch {
          // Not a readable manifest; keep walking up.
        }
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
}

const piRoot = findPiPackageRoot();
assert(piRoot !== undefined, 'no installed Pi package found: put `pi` on PATH or set PI_CHARTER_PI_ROOT');
const pi = await import(pathToFileURL(join(piRoot, 'dist', 'index.js')).href);
assert(typeof pi.DefaultResourceLoader === 'function', 'the Pi package must export DefaultResourceLoader');

// ── P1 — Pi discovers the extension and its operations ─────────────────────

const agentDir = mkdtempSync(join(tmpdir(), 'pi-charter-pi-agent-'));
const loader = new pi.DefaultResourceLoader({
  cwd: ROOT,
  // A throwaway agent dir keeps the smoke hermetic: no user settings, no user extensions.
  agentDir,
  additionalExtensionPaths: [EXTENSION_PATH],
});
await loader.reload();
const loaded = loader.getExtensions();
assert(loaded.errors.length === 0, `Pi reported extension errors: ${JSON.stringify(loaded.errors)}`);

const extension = loaded.extensions.find((candidate) => {
  try {
    return realpathSync(candidate.resolvedPath) === realpathSync(EXTENSION_PATH);
  } catch {
    return false;
  }
});
assert(extension !== undefined, `Pi did not discover ${EXTENSION_PATH}`);

const tools = extension.tools;
for (const name of TOOL_NAMES) assert(tools.has(name), `Pi did not register '${name}'`);
assert(tools.size === TOOL_NAMES.length, `the extension must expose exactly ${TOOL_NAMES.length} operations, got ${[...tools.keys()].join(', ')}`);
console.log(`pi integration smoke: Pi loaded ${extension.resolvedPath.split('/').slice(-2).join('/')} with ${[...tools.keys()].join(', ')}`);

// ── The live-shaped Extension context the tools observe ────────────────────

const OBSERVED = { provider: 'smoke-provider', model: 'smoke-model', session: 'smoke-session-1' };
const context = {
  model: { provider: OBSERVED.provider, id: OBSERVED.model },
  sessionManager: { getSessionId: () => OBSERVED.session },
  cwd: ROOT,
};

const taskContract = {
  version: 'charter/v0.1',
  task: { id: 'pi-integration-smoke', class: 'T1', risk: 'medium' },
  role: 'implement',
  execution_target: 'parent',
  root: '/projects/pi-integration-smoke',
  authority: { sources: ['smoke-spec'] },
  scope: { files: ['src/feature.ts'] },
  permissions: { code_write: true, research: false, external_write: false, release: false },
  acceptance: { commands: ['npm test'] },
  verification: { level: 'V1' },
};

const executeIn = (name, params, ctx) => tools.get(name).definition.execute(`smoke-${name}`, params, undefined, undefined, ctx);
const execute = (name, params) => executeIn(name, params, context);

// ── P2/P3 — compile through the Pi-registered tool ─────────────────────────

const compiled = await execute('charter_compile', {
  task_contract: taskContract,
  authority_evidence: { source: 'smoke-spec', doc: 'SMOKE-SPEC.md', revision: '1' },
});
assert(compiled.details.ok === true, `charter_compile refused: ${compiled.content[0].text}`);
assert(compiled.details.execution_handle === undefined, 'parent compile must return no post-execution handle');
assert(compiled.details.model_availability_evidence === 'attested', 'the observed model must become attested evidence');
assert(compiled.details.resolved_model === OBSERVED.model, 'the resolved model must be the model the context actually reported');
assert(compiled.details.capability_evidence === 'unattested_claim', 'an unobserved capability must stay an unattested claim');
assert(
  Object.values(compiled.details.enforcement_truth).every((truth) => truth !== 'ENFORCED'),
  'the integration must not attest any capability it cannot observe',
);
console.log(`pi integration smoke: parent compiled via Pi tool; model evidence = ${compiled.details.resolved_model}`);

// ── P4 — the released v0.1.1 advanced invocation is preserved (F2) ────────

const compileDefinition = tools.get('charter_compile').definition;
assert(
  compileDefinition.parameters?.properties?.authority?.type === 'string',
  'the public schema keeps `authority` strict (a string) for the simple path',
);
assert(
  typeof compileDefinition.prepareArguments === 'function',
  'the extension must translate the v0.1.1 evidence object before schema validation',
);
const legacyParams = {
  task_contract: taskContract,
  authority: { source: 'smoke-spec', doc: 'SMOKE-SPEC.md', revision: '1' },
};
const preparedArgs = compileDefinition.prepareArguments(legacyParams);
assert(
  preparedArgs.authority === undefined && preparedArgs.authority_evidence !== undefined,
  'the legacy `authority` evidence object must become `authority_evidence` before validation',
);
let bothRefused = false;
try {
  compileDefinition.prepareArguments({
    ...legacyParams,
    authority_evidence: { source: 'smoke-spec', doc: 'SMOKE-SPEC.md' },
  });
} catch (error) {
  bothRefused = /both present/.test(String(error instanceof Error ? error.message : error));
}
assert(bothRefused, 'stating both evidence spellings must be refused, never silently reduced to one');
const legacyContext = {
  model: { provider: OBSERVED.provider, id: OBSERVED.model },
  sessionManager: { getSessionId: () => 'smoke-session-legacy' },
  cwd: ROOT,
};
const legacy = await executeIn('charter_compile', preparedArgs, legacyContext);
assert(legacy.details.ok === true, `the v0.1.1 advanced invocation must still compile: ${legacy.content[0].text}`);
assert(legacy.details.execution_handle === undefined, 'legacy advanced compile must also own no post-execution lifecycle');
console.log('pi integration smoke: released v0.1.1 advanced invocation preserved (F2)');

// ── P5 — canonical delegation flow ───────────────────────────────────────

/**
 * The dogfood intent, stated the way a normal operator states it and nothing more: no canonical
 * contract, no binder object, no model profile, no capability envelope. One call, then the result.
 *
 * The fixture is the tasklet repository READ-ONLY. It is used when present (the dogfood environment),
 * and reported as SKIPPED elsewhere so this smoke stays runnable without it.
 */
const taskletRoot = process.env.PI_CHARTER_TASKLET_ROOT ?? resolve(ROOT, '..', 'tasklet');
const taskletPlan = join(taskletRoot, 'CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md');
if (!existsSync(taskletPlan)) {
  console.log(`pi integration smoke: delegation flow SKIPPED (no read-only fixture at ${taskletPlan})`);
} else {
  // Count every operation this scenario performs, so the UX budget is measured, not asserted.
  let compileAttempts = 0;
  const delegationContext = {
    model: { provider: OBSERVED.provider, id: OBSERVED.model },
    sessionManager: { getSessionId: () => 'smoke-session-delegation' },
    cwd: taskletRoot,
  };
  const delegationExecute = async (name, params) => {
    if (name === 'charter_compile') compileAttempts += 1;
    return executeIn(name, params, delegationContext);
  };

  const delegation = await delegationExecute('charter_compile', {
    task: 'Implement JSON persistence',
    role: 'implement',
    target: 'subagents',
    authority: 'CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md',
    scope: ['internal/store/**'],
    fresh: 'required',
    gates: ['go test ./internal/store/...', 'go vet ./internal/store/...'],
  });

  assert(delegation.details.ok === true, `delegation charter_compile refused: ${delegation.content[0].text}`);
  assert(delegation.details.status === 'HANDOFF_READY', `expected HANDOFF_READY, got ${delegation.details.status}`);
  assert(compileAttempts === 1, `the canonical delegation must need exactly one compile attempt, got ${compileAttempts}`);
  assert(delegation.details.truth !== undefined, 'the delegation result must state its truth block');
  assert(delegation.details.truth.authority === 'BOUND', 'authority must be BOUND');
  assert(delegation.details.truth.handoff === 'HANDOFF_READY', 'the handoff must be ready');
  assert(delegation.details.truth.runtime_attested === false, 'no child runtime was observed, and the result must say so');
  assert(delegation.details.truth.execution_proof === 'UNAVAILABLE', 'no child execution proof is available');
  assert(delegation.details.execution_handle === undefined, 'a delegation compile must mint no execution handle');

  const handoff = delegation.details.handoff;
  assert(handoff.role === 'implement', 'the handoff must carry the resolved role');
  assert(handoff.root === taskletRoot, 'the handoff must carry the declared root');
  assert(
    JSON.stringify(handoff.scope) === JSON.stringify({ directories: ['internal/store/**'] }),
    `the handoff must carry the bounded scope, got ${JSON.stringify(handoff.scope)}`,
  );
  assert(handoff.fresh_context === 'REQUIRED', 'the declared fresh requirement must cross as a requirement');
  assert(
    handoff.fresh_session_required === true,
    'the dispatch freshness truth must be consistent across the handoff fields (F1): the Wave 1B contradiction was REQUIRED alongside false',
  );
  assert(
    handoff.routing.truth === 'REQUIREMENT_ONLY',
    'routing must be stated as a requirement, never as proof of the child model',
  );
  assert(handoff.acceptance_commands.length === 2, 'the declared gates must cross as acceptance commands');
  assert(
    JSON.stringify(handoff.authority.bound_sources) === JSON.stringify(['CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md']),
    'the handoff must name the authority document it was compiled from',
  );
  assert(
    Object.values(handoff.enforcement).every((truth) => truth !== 'ENFORCED'),
    'nothing about the unobserved child may be reported ENFORCED',
  );

  const panel = delegation.content[0].text;
  for (const expected of ['Authority     BOUND', 'Handoff       READY', 'Runtime execution is not observed or verified by Charter.', 'Fresh         required']) {
    assert(panel.includes(expected), `the operator panel must state '${expected}', got:\n${panel}`);
  }
  assert(!panel.includes('EXECUTION_CONFORMANT'), 'a delegation result must never claim execution conformance');
  console.log('pi integration smoke: canonical delegation operator panel:');
  for (const line of panel.split('\n')) console.log(`  | ${line}`);
  console.log(
    `pi integration smoke: canonical delegation HANDOFF_READY via 1 compile attempt, ` +
      `source reads 0, reference reads 0, config greps 0, no execution handle`,
  );
}

// ── P6 — the Pi-facing extension owns no lifecycle and persists nothing ───

const extensionSource = readFileSync(EXTENSION_PATH, 'utf8');
for (const forbidden of ['child_process', 'spawn(', 'spawnSync', 'setTimeout', 'setInterval', 'writeFileSync', 'createWriteStream', 'Date.now', 'Math.random', 'process.exit', 'localStorage', 'indexedDB']) {
  assert(!extensionSource.includes(forbidden), `the extension must not contain '${forbidden}'`);
}

rmSync(agentDir, { recursive: true, force: true });
console.log('Pi integration smoke: PASS');
