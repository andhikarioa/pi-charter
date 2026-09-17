/**
 * Pi bridge — compile bounded governance from the active Pi environment.
 *
 * `compileViaPi` observes provider/model/session identity from Pi itself and routes that observation
 * through the host-authorized adapter integration. It owns no post-execution lifecycle, execution
 * handle, scheduler, worker, retry loop, or persistence.
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

export type PiCompileResult = AdapterCompileResult;

/**
 * Compile governance for the active Pi session.
 *
 * The environment evidence is issued by the adapter contract from the actual observation: the model
 * inventory is an attested `model_registry` payload carrying the provider/model this session actually
 * reports, and no capability axis is attested because the bridge observes none — core records that as
 * an explicit UNATTESTED claim with no axis true. Neither is caller-supplied, and neither is inferred
 * from a target name.
 */
export function compileViaPi(input: unknown): PiCompileResult {
  const integration = piIntegration();
  if ('reason' in integration) {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: 'environment', message: integration.reason }] };
  }
  return integration.compile(input);
}
