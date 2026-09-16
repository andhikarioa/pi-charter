/**
 * F3 Pi integration smoke — the extension is discovered by Pi itself, and its tools work.
 *
 * This is not a handwritten temporary script composing Charter by hand. It loads
 * `extensions/pi-charter.ts` through Pi's OWN resource loader (`DefaultResourceLoader`, the same
 * jiti-based loader Pi uses for installed packages), takes the tool definitions Pi registered, and
 * calls them with a live-shaped Extension context. That exercises the discoverable surface end to
 * end: manifest → Pi loader → registered tool → compiled package → adapter integration → admissions.
 *
 *   P1  Pi discovers the extension and registers both operations
 *   P2  charter_compile compiles a tiny parent contract through the real context observation
 *   P3/P4  the exact admitted artifact set verifies (handle-only, as the LLM would call it)
 *   P5  a handle this process never minted is refused
 *   P6  the trusted model evidence is the provider/model the context actually reported
 *   P7  no capability the extension cannot observe is attested
 *   P10 the extension owns no scheduling, session lifecycle, or persistence
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

const TOOL_NAMES = ['charter_compile', 'charter_verify_execution'];

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

const execute = (name, params) => tools.get(name).definition.execute(`smoke-${name}`, params, undefined, undefined, context);

// ── P2/P3/P6/P7 — compile through the Pi-registered tool ───────────────────

const compiled = await execute('charter_compile', {
  task_contract: taskContract,
  authority: { source: 'smoke-spec', doc: 'SMOKE-SPEC.md', revision: '1' },
});
assert(compiled.details.ok === true, `charter_compile refused: ${compiled.content[0].text}`);
assert(typeof compiled.details.execution_handle === 'string' && compiled.details.execution_handle.length >= 32, 'compile must return the admission handle');
assert(compiled.details.model_availability_evidence === 'attested', 'the observed model must become attested evidence');
assert(compiled.details.resolved_model === OBSERVED.model, 'the resolved model must be the model the context actually reported');
assert(compiled.details.capability_evidence === 'unattested_claim', 'an unobserved capability must stay an unattested claim');
assert(
  Object.values(compiled.details.enforcement_truth).every((truth) => truth !== 'ENFORCED'),
  'the integration must not attest any capability it cannot observe',
);
console.log(`pi integration smoke: compiled via Pi tool; model evidence = ${compiled.details.resolved_model}`);

// ── P4 — verify the exact admitted artifact set, handle-only ───────────────

const verified = await execute('charter_verify_execution', { execution_handle: compiled.details.execution_handle });
assert(verified.details.ok === true, `charter_verify_execution refused: ${verified.content[0].text}`);
assert(verified.details.verdict === 'EXECUTION_CONFORMANT', `expected EXECUTION_CONFORMANT, got ${verified.details.verdict}`);
console.log('pi integration smoke: admitted artifact set verified EXECUTION_CONFORMANT');

// ── P5 — an unbound artifact / foreign handle is refused ───────────────────

const forged = await execute('charter_verify_execution', { execution_handle: 'f'.repeat(48) });
assert(forged.details.ok !== true, 'a handle this process never minted must not verify');
assert(forged.content[0].text.includes('refused'), 'the refusal must be explicit');

const noHandle = await execute('charter_verify_execution', {});
assert(noHandle.details.ok !== true, 'verification without a handle must be refused');
console.log('pi integration smoke: unbound handles refused');

// ── P10 — the Pi-facing extension owns no lifecycle and persists nothing ───

const extensionSource = readFileSync(EXTENSION_PATH, 'utf8');
for (const forbidden of ['child_process', 'spawn(', 'spawnSync', 'setTimeout', 'setInterval', 'writeFileSync', 'createWriteStream', 'Date.now', 'Math.random', 'process.exit', 'localStorage', 'indexedDB']) {
  assert(!extensionSource.includes(forbidden), `the extension must not contain '${forbidden}'`);
}

rmSync(agentDir, { recursive: true, force: true });
console.log('F3 Pi integration smoke: PASS');
