/**
 * The Pi bridge (v0.1.1 Wave 2 — U2; final correction — F1/F3).
 *
 * Without this module, using Charter from Pi meant a handwritten temporary TypeScript script that
 * composed the pipeline by hand and invented its own environment evidence. The bridge replaces that
 * with two thin operations over the compiled package, and it is now one instantiation of the one
 * supported adapter contract (`createAdapterIntegration`) — the same contract a legitimate external
 * substrate adapter integrates through:
 *
 *   compileViaPi                  compile governance for the ACTIVE Pi session
 *   observeExecutionViaPi         report that this session ACTUALLY executed an admitted artifact set
 *   verifyExecutionViaPi          verify that observed run against that compiled governance
 *
 * What makes it a bridge rather than a convenience wrapper is where its evidence comes from. The
 * capability axes and the model inventory are NOT accepted from the caller: they are derived from the
 * actual Pi environment this process is running in (`PI_PROVIDER`, `PI_MODEL`, `PI_SESSION_ID`) and
 * from this adapter's own package metadata, and the capability axes come from this bridge's own
 * capability observation (none, for the bridge: it does not own execution). A caller cannot pass
 * booleans, a model list, or a source name into it, so nothing a caller can supply becomes attested
 * environment truth (H2, T2).
 *
 * This bridge is also one of the two runtime integrations the package itself wires, so it holds the
 * host adapter authority and its observations may cross into trusted evidence (F3). That position is
 * NOT inferred from this file's name or from any label: the bridge hands the contract the capability
 * this process minted, which no ordinary caller can obtain from the package surface, while an adapter
 * a caller constructs without it stays a candidate path with no attested environment truth.
 *
 * The execution artifact link (F1) is carried by the compile-time admission handle plus the observed
 * execution event. `compileViaPi` returns the handle; `observeExecutionViaPi` is where the runtime
 * owner reports that the admitted artifact set actually ran, and `verifyExecutionViaPi` refuses to
 * issue execution evidence without it — an admitted artifact set nothing ever reported executing has
 * admission evidence and no execution evidence. A receipt, envelope, and contract supplied at
 * verification time are checked AGAINST the admitted artifact set, never copied into trusted
 * evidence, so "compile B, run nothing, then verify B" is not EXECUTION_CONFORMANT: it is a mismatch
 * against the admission, a refusal when nothing was admitted, or a refusal when nothing was observed
 * executing. The evidence names the session the run was OBSERVED in, so a run observed in one session
 * never verifies as a run of another.
 *
 * What the bridge truthfully does NOT attest, and says so by omission:
 *
 *   capability enforcement   the bridge does not own execution, so it cannot observe whether the
 *                            substrate hard-enforces a tool ceiling, a file scope, a model, a fresh
 *                            session, or independent review. It therefore observes no capability axis,
 *                            which core records as an explicit UNATTESTED claim with no axis true. A
 *                            dimension a real substrate does enforce must be observed by that
 *                            substrate's own adapter, which owns the observation boundary to report it.
 *   fresh-session state      the active session's topology is not independent-review evidence, so no
 *                            freshness observation is recorded; a contract requiring it fails closed.
 *   tool/enforcement outcome what was in effect during a run is not observable from here.
 *   verifier outcomes        the bridge does not run verifiers, so bound assertions stay unverified.
 *
 * The bridge spawns nothing, schedules nothing, retries nothing, manages no child session, persists
 * no run, owns no lifecycle, and mutates no project file. It calls the compiled core and returns
 * values. Only the active `parent` session is mediated at all: a `subagents` contract is refused
 * rather than answered with evidence about a runtime the bridge cannot see.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createHostAuthorizedAdapterIntegration,
  HOST_ADAPTER_AUTHORITY,
  type AdapterCompileInput,
  type AdapterCompileResult,
  type AdapterEnvironmentObservation,
  type AdapterExecutionObservationInput,
  type AdapterExecutionObservationResult,
  type AdapterExecutionVerificationInput,
  type AdapterExecutionVerificationResult,
  type AdapterIntegration,
} from '../integration/adapter-integration.ts';

/** The one target the bridge mediates: the session this process is running in. */
export type PiMediatedTarget = 'parent';

/** What the bridge actually observed about the Pi environment it is running in. */
export interface PiEnvironmentObservation extends AdapterEnvironmentObservation {
  /** The bridge mediates the active parent session only. */
  readonly target: PiMediatedTarget;
  /** This bridge, as it names itself in its own package metadata. */
  readonly adapter: { readonly name: string; readonly version: string };
}

export type PiObservationResult =
  | { ok: true; observation: PiEnvironmentObservation }
  | { ok: false; reason: string };

/** The package root, resolved identically from `src/bridge/` and from `dist/bridge/`. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Read this bridge's own identity from the package it ships in. Absent metadata means no adapter
 * identity, which is reported rather than invented.
 */
function readAdapterIdentity(): { name: string; version: string } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') return undefined;
    return { name: parsed.name, version: parsed.version };
  } catch {
    return undefined;
  }
}

/**
 * Observe the actual Pi environment. Fail-closed: an environment that does not report a provider, a
 * model, and a session is not one this bridge can issue evidence about, and it says so instead of
 * filling the gap with a default.
 */
export function observePiEnvironment(): PiObservationResult {
  const provider = process.env.PI_PROVIDER;
  const model = process.env.PI_MODEL;
  const sessionIdentity = process.env.PI_SESSION_ID;
  const missing = [
    ...(provider === undefined || provider.trim().length === 0 ? ['PI_PROVIDER'] : []),
    ...(model === undefined || model.trim().length === 0 ? ['PI_MODEL'] : []),
    ...(sessionIdentity === undefined || sessionIdentity.trim().length === 0 ? ['PI_SESSION_ID'] : []),
  ];
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `the Pi environment does not report ${missing.join(', ')}, so no environment evidence can be issued`,
    };
  }
  const adapter = readAdapterIdentity();
  if (adapter === undefined) {
    return { ok: false, reason: 'this bridge cannot read its own package identity, so it cannot attribute evidence it issues' };
  }
  return {
    ok: true,
    observation: Object.freeze({
      target: 'parent' as const,
      provider: (provider as string).trim(),
      model: (model as string).trim(),
      session_identity: (sessionIdentity as string).trim(),
      runtime: process.version,
      adapter: Object.freeze(adapter),
    }),
  };
}

/**
 * One bridge instantiation of the one supported adapter contract. The observation callback is the
 * bridge's constrained issuance context: it reports the observed environment, and core promotes it.
 */
function piIntegration(): AdapterIntegration | { reason: string } {
  const identity = readAdapterIdentity();
  if (identity === undefined) {
    return { reason: 'this bridge cannot read its own package identity, so it cannot attribute evidence it issues' };
  }
  return createHostAuthorizedAdapterIntegration(
    {
      name: identity.name,
      version: identity.version,
      observeEnvironment: () => {
        const observation = observePiEnvironment();
        return observation.ok ? { ok: true, observation: observation.observation } : { ok: false, reason: observation.reason };
      },
    },
    HOST_ADAPTER_AUTHORITY,
  );
}

// ── compile ─────────────────────────────────────────────────────────────────

/**
 * What the bridge admits. Deliberately narrower than `CompileForTargetInput`: the environment
 * evidence channels are absent because the bridge derives them, so there is no field through which a
 * caller could supply capability booleans, a model list, or a trust boundary.
 */
export type PiCompileInput = AdapterCompileInput;

/** Includes the compile-time execution handle that the verification of this compile requires. */
export type PiCompileResult = AdapterCompileResult;

/**
 * Compile governance for the active Pi session.
 *
 * The environment evidence is issued by the adapter contract from the actual observation: the model
 * inventory is an attested `model_registry` payload carrying the provider/model this session actually
 * reports, and no capability axis is attested because the bridge observes none — core records that as
 * an explicit UNATTESTED claim with no axis true. Neither is caller-supplied, and neither is inferred
 * from a target name. The returned `execution_handle` is this process's admission of exactly this
 * artifact set for execution.
 */
export function compileViaPi(input: unknown): PiCompileResult {
  const integration = piIntegration();
  if ('reason' in integration) {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: 'environment', message: integration.reason }] };
  }
  return integration.compile(input);
}

// ── observe_execution ───────────────────────────────────────────────────────

/**
 * The one admitted input of an execution observation: the handle of the artifact set that ran.
 */
export type PiExecutionObservationInput = AdapterExecutionObservationInput;

export type PiExecutionObservationResult = AdapterExecutionObservationResult;

/**
 * Report that the active Pi session actually executed the artifact set a handle admitted.
 *
 * This is the runtime owner's observation, and it is the only thing that makes an admitted artifact
 * set eligible for execution evidence: the runtime reports that it ran, and the session identity it
 * reports at that moment is bound into the evidence. Admission alone (compile, then verify) is not
 * execution, and `verifyExecutionViaPi` refuses without this step rather than reading execution out
 * of the artifacts, the model, or the session metadata.
 */
export function observeExecutionViaPi(input: PiExecutionObservationInput): PiExecutionObservationResult {
  const integration = piIntegration();
  if ('reason' in integration) return { ok: false, reason: integration.reason };
  return integration.observeExecution(input);
}

// ── verify_execution ────────────────────────────────────────────────────────

/**
 * The artifacts a run is checked against, plus the execution handle that admitted them. The handle is
 * required: without it, the artifacts are a claim about a run, not proof this process admitted them.
 * The handle is also not sufficient on its own: the run must have been observed executing.
 */
export type PiExecutionVerificationInput = AdapterExecutionVerificationInput;

export type PiExecutionVerificationResult = AdapterExecutionVerificationResult;

/**
 * Verify a run of this session against the governance compiled for it.
 *
 * Two things are required, and neither substitutes for the other: the admission handle the compile
 * minted for exactly these artifacts, and a recorded observation that the runtime actually executed
 * them (`observeExecutionViaPi`). The bridge withholds execution evidence when either is missing,
 * and it refuses when the observed session is not the session currently being verified — a run
 * observed in one session is not a run of another, however well the target and model agree.
 *
 * The evidence is issued from the admission and the observed run; everything the bridge cannot
 * observe is omitted, so a contract that requires a tool ceiling, a fresh session, or a verifier
 * outcome gets a truthful deviation or `ACCEPTANCE_NOT_VERIFIED` rather than a green result built on
 * silence. Which artifact was compiled is read from the admission — never transcribed from whatever
 * artifacts are presented here.
 */
export function verifyExecutionViaPi(input: PiExecutionVerificationInput): PiExecutionVerificationResult {
  const integration = piIntegration();
  if ('reason' in integration) return { ok: false, reason: integration.reason };
  return integration.verifyExecution(input);
}
