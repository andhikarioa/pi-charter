/**
 * Supported adapter integration contract.
 *
 * An adapter may report the environment and capability axes it actually observes. Ordinary package
 * consumers produce candidate evidence only; caller-supplied observations cannot self-promote into
 * trusted `ENFORCED` truth. The package-wired Pi integration holds the separate host authorization
 * capability that may promote genuine runtime observations.
 *
 * This integration is compile-only. It owns no execution admission, handle, observation registry,
 * post-run verifier, scheduler, retry loop, session lifecycle, or persistence.
 */

import type { AssertionBinder } from '../core/acceptance/assertion-binding.ts';
import { createAttestationVerifier } from '../core/attestation/attestation.ts';
import type { AuthorityBinder } from '../core/authority/binder.ts';
import type { CompiledGovernance } from '../core/compile/compile-for-target.ts';
import { compileForTarget } from '../core/compile/compile-for-target.ts';
import type { CharterError } from '../core/contracts/errors.ts';
import { EXECUTION_TARGETS, type ExecutionTargetName, type TaskContract } from '../core/contracts/task-contract.ts';
import type { CorrectionAuthorityBinder } from '../core/correction/correction-authority.ts';
import {
  TARGET_CAPABILITY_KEYS,
  type TargetCapabilityKey,
} from '../core/enforcement/target-binding.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';

/** What one adapter actually observed about the runtime it is integrated with. */
export interface AdapterEnvironmentObservation {
  /** The runtime this adapter IS: the execution target its observations are about. */
  readonly target: ExecutionTargetName;
  /** Provider identity the runtime reports (H2). Observed, never supplied by a caller. */
  readonly provider: string;
  /** Model identity the runtime reports as active (H2). Observed, never supplied by a caller. */
  readonly model: string;
  /** Session identity the runtime reports. */
  readonly session_identity: string;
  /** Runtime version the adapter is executing under. */
  readonly runtime: string;
}

export type AdapterObservationResult =
  | { ok: true; observation: AdapterEnvironmentObservation }
  | { ok: false; reason: string };

/**
 * What an adapter can actually observe about its runtime's enforcement capability.
 *
 * Every axis is optional and every stated value is an OBSERVATION: `true` means this adapter observed
 * its runtime hard-enforcing that dimension, `false` means it observed the runtime not providing it,
 * and an OMITTED axis means it observed nothing about that dimension and therefore attests nothing.
 * The adapter states what it saw. It never states trust, and it cannot: there is no `attested` field,
 * and an axis this object does not name is never recorded as an attested primitive.
 *
 * The three states stay three states all the way into evidence (F3): an axis observed `true` becomes a
 * trusted positive observation, an axis observed `false` becomes a trusted NEGATIVE observation, and
 * an omitted axis becomes no observation at all. Omission is never rewritten as an observed `false`,
 * so `{ fresh_session: false }` and `{}` carry different evidence identities, and neither can ground
 * `ENFORCED`.
 */
export type AdapterCapabilityObservation = Partial<Record<TargetCapabilityKey, boolean>>;

export type AdapterCapabilityObservationResult =
  | { ok: true; observed: AdapterCapabilityObservation }
  | { ok: false; reason: string };

/**
 * The supported adapter registration contract.
 *
 * The adapter provides its identity and its observation callbacks. Core calls them on every operation
 * and converts the returned observations into evidence. The adapter holds no minter, no boundary store,
 * and no trust capability: the constrained issuance context it may use is these callbacks, and what
 * those observations are worth is decided by which integration path created it — an ordinary caller
 * gets candidates, the host-authorized path gets trusted evidence (F3).
 */
export interface AdapterIntegrationOptions {
  /** Adapter component name. It is the substrate identity every attestation it causes will carry. */
  readonly name: string;
  /** Adapter component version the runtime reports. */
  readonly version: string;
  /**
   * Report what this adapter can actually observe about its runtime. Omitted facts are not attested:
   * returning a non-conformant or partial observation fails closed instead of filling defaults.
   */
  readonly observeEnvironment: () => AdapterObservationResult;
  /**
   * Report only the capability dimensions this adapter actually observed about its own runtime.
   * Absent means capabilities are not observed at all and none is attested. Every observation is a
   * fact about a runtime, never a trust flag, so no axis can become trusted capability evidence
   * without an observation of `true` here, and core still owns that promotion — which only a
   * host-authorized integration may reach.
   */
  readonly observeCapabilities?: () => AdapterCapabilityObservationResult;
}

/** What an adapter or integration may submit for compilation. Environment evidence is absent. */
export interface AdapterCompileInput {
  task_contract: TaskContract;
  authority_binder: AuthorityBinder;
  assertion_binder?: AssertionBinder;
  correction_binder?: CorrectionAuthorityBinder;
  model_profile: ModelProfile;
}

export interface AdapterCompileSuccess {
  ok: true;
  compiled: CompiledGovernance;
  observation: AdapterEnvironmentObservation;
}

export type AdapterCompileResult = AdapterCompileSuccess | { ok: false; errors: CharterError[] };

/** Compile-only adapter surface: runtime observations in, bounded governance out. */
export interface AdapterIntegration {
  compile(input: unknown): AdapterCompileResult;
}

// ── The contract ────────────────────────────────────────────────────────────

/** Inputs the integration derives from its own observation. Supplying any of them is refused. */
const INTEGRATION_OWNED_KEYS = [
  'available',
  'model_availability_attestation',
  'model_availability_attestation_verifier',
  'capability_claim',
  'capability_attestation',
  'capability_attestation_verifier',
  'compiler_identity',
] as const;

const COMPILE_INPUT_KEYS = [
  'task_contract',
  'authority_binder',
  'assertion_binder',
  'correction_binder',
  'model_profile',
] as const;

/** The adapter identity fields, and nothing else: trust is not a registration option. */
const ADAPTER_OPTION_KEYS = ['name', 'version', 'observeEnvironment', 'observeCapabilities'] as const;

// ── The host adapter-authority capability (F3) ──────────────────────────────

/** Opaque host authorization. It carries no data; only process-local identity makes it authorization. */
export interface HostAdapterAuthority {
  /** Present in the type system only, so no caller-supplied shape can satisfy the position. */
  readonly __host_adapter_authority: unique symbol;
}

const HOST_ADAPTER_AUTHORITIES = new WeakSet<object>();

/**
 * The host adapter authority this process minted. NOT PACKAGE SURFACE: `index.ts` re-exports the
 * adapter contract below and deliberately not this value, so a caller reaching it has reached inside
 * the package rather than through its surface. The integration the package itself wires holds it.
 */
export const HOST_ADAPTER_AUTHORITY: HostAdapterAuthority = Object.freeze(
  ((): HostAdapterAuthority => {
    const authority = {} as HostAdapterAuthority;
    HOST_ADAPTER_AUTHORITIES.add(authority);
    return authority;
  })(),
);

/**
 * True only for the authority object this process minted. Nothing about a supplied value's contents is
 * read as authorization, so a record-shaped token, a string, a spread copy, a clone, and a parsed
 * envelope all fail this check and are refused rather than trusted.
 */
export function isHostAdapterAuthority(value: unknown): value is HostAdapterAuthority {
  return typeof value === 'object' && value !== null && HOST_ADAPTER_AUTHORITIES.has(value);
}

/**
 * Create the ordinary adapter integration. Its observations are CANDIDATES: core records them as
 * unattested evidence, and no run it reports verifies as trusted execution (F3).
 */
export function createAdapterIntegration(options: AdapterIntegrationOptions): AdapterIntegration {
  return buildAdapterIntegration(options, false);
}

/**
 * Create a HOST-AUTHORIZED adapter integration, or refuse (F3).
 *
 * NOT PACKAGE SURFACE. This is the host seam the runtime integration the package itself wires — the Pi
 * bridge, the installed Pi extension — goes through, and the authority check is the gate: without the
 * capability this process minted an integration is not host-authorized, however plausible the value
 * handed in, and its observations stay candidates.
 */
export function createHostAuthorizedAdapterIntegration(
  options: AdapterIntegrationOptions,
  authority: unknown,
): AdapterIntegration {
  if (!isHostAdapterAuthority(authority)) {
    throw new TypeError(
      'a host-authorized adapter integration requires the host adapter authority this process minted; a submitted value, a copy, or a plain object is not a host-authorized adapter context',
    );
  }
  return buildAdapterIntegration(options, true);
}

/**
 * Build one adapter integration. `hostAuthorized` is decided by the two callers above and never by
 * input.
 *
 * Fail-closed at construction for a malformed adapter identity and for an unknown option (so no trust
 * flag can ride along as a field), and fail-closed at every operation for an adapter whose observation
 * is unusable. Nothing here schedules, spawns, retries, persists, or tracks execution state.
 */
function buildAdapterIntegration(options: AdapterIntegrationOptions, hostAuthorized: boolean): AdapterIntegration {
  if (
    !isRecord(options) ||
    !isNonEmptyString(options.name) ||
    typeof options.version !== 'string' ||
    typeof options.observeEnvironment !== 'function' ||
    (options.observeCapabilities !== undefined && typeof options.observeCapabilities !== 'function') ||
    Object.keys(options).some((key) => !(ADAPTER_OPTION_KEYS as readonly string[]).includes(key))
  ) {
    throw new TypeError(
      'createAdapterIntegration requires { name, version, observeEnvironment, observeCapabilities? }: an adapter must name itself and report what it can observe, and it may not supply trust as a field',
    );
  }
  const substrate = Object.freeze({ name: options.name.trim(), version: options.version });
  const observe = options.observeEnvironment;
  const observeCapabilities = options.observeCapabilities;

  const integration: AdapterIntegration = {
    compile(input) {
      const errors: CharterError[] = [];
      const err = (path: string, message: string): void => {
        errors.push({ code: 'INVALID_TASK_CONTRACT', path, message });
      };
      if (!isRecord(input)) {
        return {
          ok: false,
          errors: [{ code: 'INVALID_TASK_CONTRACT', path: '', message: 'integration compile input must be an object' }],
        };
      }
      for (const key of Object.keys(input)) {
        if ((INTEGRATION_OWNED_KEYS as readonly string[]).includes(key)) {
          err(
            key,
            `'${key}' is derived by the integration from the runtime it actually observes and is not accepted from a caller; supplying environment evidence here would be a claim dressed as observation`,
          );
          continue;
        }
        if (!(COMPILE_INPUT_KEYS as readonly string[]).includes(key)) err(key, `unknown field '${key}'`);
      }
      if (errors.length > 0) return { ok: false, errors };

      const observed = observeOrFail();
      if ('reason' in observed) {
        return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: 'environment', message: observed.reason }] };
      }
      const capabilities = observeCapabilitiesOrFail();
      if ('reason' in capabilities) {
        return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: 'capabilities', message: capabilities.reason }] };
      }

      // This integration answers for the runtime it observes. Any other target is refused rather than
      // answered with evidence about a runtime it cannot see (T2 — no capability inferred from a name).
      const declaredTarget = isRecord(input.task_contract) ? input.task_contract.execution_target : undefined;
      if (declaredTarget !== observed.target) {
        return {
          ok: false,
          errors: [
            {
              code: 'UNSUPPORTED_BY_EXECUTION_TARGET',
              path: 'task_contract.execution_target',
              message: `this integration observes only the active '${observed.target}' runtime; execution_target=${String(declaredTarget)} must be attested by the adapter that owns that runtime`,
            },
          ],
        };
      }

      // Observed: the model this runtime actually reports as active. The host-authorized path issues it
      // through the Wave 1 exact-issuance verifier, which vouches for precisely this attestation and
      // nothing else. An ordinary integration holds no such boundary and submits the availability CLAIM
      // it is, so a caller-created adapter cannot attest a provider/model it merely declared (F3, H2).
      const modelInventory = {
        source_kind: 'model_registry' as const,
        source: substrate.name,
        payload: { models: [observed.model] },
      };
      const modelEvidence = hostAuthorized
        ? {
            model_availability_attestation: modelInventory,
            model_availability_attestation_verifier: createAttestationVerifier([modelInventory]),
          }
        : { available: [observed.model] };

      // Only the axes the adapter actually OBSERVED, exactly as it observed them: a true observation is
      // present and true, a false observation is present and false, and an omitted axis is simply
      // absent. Nothing fills an unobserved axis in, so omission never becomes an observed `false` and
      // the two carry different evidence identities (F3 tri-state). A target name, an adapter name, and
      // a source name never imply a capability: this object is built from the adapter's observations
      // alone and from nothing else.
      const observedCapabilityAxes: AdapterCapabilityObservation = { ...(capabilities.observed ?? {}) };
      // Core promotes the observations into ONE capability payload; the adapter never sees the boundary
      // that vouches for it, and a caller cannot supply either half of this pair.
      const capabilityCandidate = {
        source_kind: 'execution_adapter' as const,
        source: substrate.name,
        payload: { target: observed.target, capabilities: observedCapabilityAxes },
      };
      // A capability observer on the host-authorized path is the only place a boundary exists to vouch
      // for those observations. Everywhere else they stay exactly what they are — a candidate nobody
      // vouched for — and core records them as the unattested claim they are: no observed capability
      // reaches ENFORCED, however many axes the adapter observed true.
      const capabilityEvidence =
        hostAuthorized && capabilities.observed !== undefined
          ? {
              capability_attestation: capabilityCandidate,
              capability_attestation_verifier: createAttestationVerifier([capabilityCandidate]),
            }
          : { capability_attestation: capabilityCandidate };

      const compiled = compileForTarget({
        task_contract: input.task_contract as TaskContract,
        authority_binder: input.authority_binder as AuthorityBinder,
        ...(input.assertion_binder !== undefined ? { assertion_binder: input.assertion_binder as AssertionBinder } : {}),
        ...(input.correction_binder !== undefined
          ? { correction_binder: input.correction_binder as CorrectionAuthorityBinder }
          : {}),
        model_profile: input.model_profile as ModelProfile,
        ...modelEvidence,
        ...capabilityEvidence,
      });
      if (!compiled.ok) return { ok: false, errors: compiled.errors };

      return { ok: true, compiled: compiled.compiled, observation: observed };
    },
  };
  return Object.freeze(integration);

  /**
   * Observe the runtime's capability dimensions, or fail closed. `observed: undefined` means this
   * adapter supplied no capability observer at all — which is not the same as observing nothing, but
   * has the same truthful consequence: no capability is attested.
   */
  function observeCapabilitiesOrFail(): { observed: AdapterCapabilityObservation | undefined } | { reason: string } {
    if (observeCapabilities === undefined) return { observed: undefined };
    let result: AdapterCapabilityObservationResult;
    try {
      result = observeCapabilities();
    } catch {
      return { reason: 'the adapter capability observation callback failed, so no capability evidence can be issued' };
    }
    if (!isRecord(result) || result.ok !== true) {
      const reason =
        isRecord(result) && typeof result.reason === 'string'
          ? result.reason
          : 'the adapter reported no usable capability observation';
      return { reason };
    }
    const observed: unknown = result.observed;
    if (!isRecord(observed)) return { reason: 'the adapter capability observation must be an object naming the axes it observed' };
    for (const key of Object.keys(observed)) {
      if (!(TARGET_CAPABILITY_KEYS as readonly string[]).includes(key)) {
        return {
          reason: `'${key}' is not a capability axis this release observes (${TARGET_CAPABILITY_KEYS.join('|')}); an adapter reports observations, never trust`,
        };
      }
      if (typeof observed[key] !== 'boolean') {
        return { reason: `capability '${key}' must be an observed boolean; omit an axis this adapter did not observe` };
      }
    }
    return { observed: { ...observed } as AdapterCapabilityObservation };
  }

  /** Observe, or fail closed: a partial or malformed observation receives no evidence. */
  function observeOrFail(): AdapterEnvironmentObservation | { reason: string } {
    let result: AdapterObservationResult;
    try {
      result = observe();
    } catch {
      return { reason: 'the adapter observation callback failed, so no environment evidence can be issued' };
    }
    if (!isRecord(result) || result.ok !== true) {
      const reason = isRecord(result) && typeof result.reason === 'string' ? result.reason : 'the adapter reported no usable environment observation';
      return { reason };
    }
    const observation: unknown = result.observation;
    if (!isRecord(observation)) return { reason: 'the adapter observation must be an object' };
    if (!(EXECUTION_TARGETS as readonly string[]).includes(String(observation.target))) {
      return { reason: `the adapter must report the execution target it observes (one of ${EXECUTION_TARGETS.join('|')})` };
    }
    for (const key of ['provider', 'model', 'session_identity', 'runtime'] as const) {
      if (!isNonEmptyString(observation[key])) {
        return { reason: `the adapter observation does not report ${key}, so no environment evidence can be issued` };
      }
    }
    const target = observation.target as ExecutionTargetName;
    return Object.freeze({
      target,
      provider: (observation.provider as string).trim(),
      model: (observation.model as string).trim(),
      session_identity: (observation.session_identity as string).trim(),
      runtime: (observation.runtime as string).trim(),
    });
  }
}

function unknownKeys(value: unknown, allowed: readonly string[]): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value).filter((key) => !(allowed as readonly string[]).includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
