/**
 * The adapter-facing integration boundary (v0.1.1 final correction — F1 + F3).
 *
 * Two accepted final-review findings meet here.
 *
 * F3 — the observation surface. Before this module, the only way to have Charter issue environment and
 * execution evidence was to be the compiled Pi bridge (or to import internal core modules). A
 * legitimate substrate adapter had no supported package-facing way in. This module is that way, and
 * it is the ONE adapter contract in the release:
 *
 *   createAdapterIntegration({ name, version, observeEnvironment, observeCapabilities? })
 *
 * The adapter supplies OBSERVATIONS. Core owns TRUST PROMOTION. The adapter never sees
 * `createAttestationVerifier`, `createExecutionAttestationIssuer`, or any other internal minter: it
 * returns what it can actually see — which runtime it is, provider/model, session identity, runtime
 * version, and which capability dimensions it observed its own runtime hard-enforcing — and core
 * converts exactly that into trusted evidence. It may not attest what it does not observe, because
 * there is no input through which it could: capability booleans, model inventories, trust
 * boundaries, `attested: true`, and unknown capability axes are all refused by name. An adapter that
 * supplies no capability observer still attests no capability at all, exactly as before, and an axis
 * it did not observe is recorded as not-capable rather than as an attested primitive.
 *
 * F1 — the execution artifact link. Before this correction, `verifyExecutionViaPi` copied the
 * receipt/contract/envelope identities out of the artifacts a caller handed it at verification time
 * and issued trusted execution evidence naming them. That made governance artifacts SUPPLIED AT
 * VERIFICATION into execution proof: compile A and B, execute nothing for B, verify B, receive
 * EXECUTION_CONFORMANT. Supplying an artifact at verification time is a claim about a run, not
 * evidence that this process admitted that artifact for execution.
 *
 * The correction has two halves, because admission is still not execution:
 *
 *   compile/admit governance artifact  → opaque execution handle bound to that exact artifact set
 *   substrate actually executes it     → observeExecution(handle): the runtime's OWN observation
 *   verify(handle, artifacts)          → evidence is issued from the ADMISSION and that OBSERVED
 *                                        RUN, and the supplied artifacts are checked AGAINST it
 *
 * The handle is a random opaque token minted only here, valid only in this process, and valid only
 * for the exact compile it was minted for. A caller cannot forge one (it is not derived from caller
 * data), cannot self-promote one (a foreign object/string is refused, never verified), and cannot
 * swap artifacts under one (a mismatch is NON_CONFORMANT, never a pass). Admission alone proves the
 * artifact set was admitted for execution and nothing more: until the substrate reports that it
 * executed it, `verifyExecution` refuses, however plausible the artifacts, model, and session look.
 * The evidence carries the session the run was OBSERVED in, and verification refuses when the
 * observed session is not the session currently being looked at, so a run observed under session A
 * never verifies as a run of session B. No persistence, no run database, no session manager, no
 * workflow engine, no lifecycle: the admission store is a bounded in-memory map holding one observed
 * execution event per admission, and it is the minimum required to bind one execution to one
 * governance artifact.
 */

import { randomBytes } from 'node:crypto';

import type { AssertionBinder } from '../core/acceptance/assertion-binding.ts';
import { createAttestationVerifier } from '../core/attestation/attestation.ts';
import type { AuthorityBinder } from '../core/authority/binder.ts';
import type { CompiledGovernance } from '../core/compile/compile-for-target.ts';
import { compileForTarget } from '../core/compile/compile-for-target.ts';
import type { CharterError } from '../core/contracts/errors.ts';
import type { ExecutionContract } from '../core/contracts/execution-contract.ts';
import { EXECUTION_TARGETS, type ExecutionTargetName, type TaskContract } from '../core/contracts/task-contract.ts';
import type { CorrectionAuthorityBinder } from '../core/correction/correction-authority.ts';
import {
  TARGET_CAPABILITY_KEYS,
  type TargetCapabilityKey,
} from '../core/enforcement/target-binding.ts';
import type { RoleEnvelope } from '../core/envelopes/role-envelope.ts';
import {
  createExecutionAttestationIssuer,
  verifyExecutionAttestation,
  type ExecutionVerificationResult,
} from '../core/execution/execution-attestation.ts';
import { evidenceIdentity } from '../core/provenance/evidence.ts';
import type { ResolutionReceipt } from '../core/receipt/resolution-receipt.ts';
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
 */
export type AdapterCapabilityObservation = Partial<Record<TargetCapabilityKey, boolean>>;

export type AdapterCapabilityObservationResult =
  | { ok: true; observed: AdapterCapabilityObservation }
  | { ok: false; reason: string };

/**
 * The supported adapter registration contract.
 *
 * The adapter provides its identity and its observation callbacks. Core calls them on every operation,
 * promotes the returned observations into trusted evidence, and issues nothing else. The adapter holds
 * no minter, no boundary store, and no trust capability: the constrained issuance context it may use
 * is these callbacks.
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
   * without an observation of `true` here, and core still owns that promotion.
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
  /**
   * Opaque process-local admission handle for exactly this compiled artifact set. It is the ONLY
   * thing that makes those artifacts eligible for trusted execution verification: present it to
   * `verifyExecution`, and nothing else can take its place.
   */
  execution_handle: string;
}

export type AdapterCompileResult = AdapterCompileSuccess | { ok: false; errors: CharterError[] };

/**
 * What a runtime observed when it actually executed the artifact set a handle admitted.
 *
 * The handle is the only input. Whether the artifact executed is not a statement a caller may make:
 * it is a fact the runtime owner reports by calling this operation, and the observation recorded is
 * the one this integration's own environment callback returns at that moment.
 */
export interface AdapterExecutionObservationInput {
  /**
   * The handle `compile` minted for the artifact set this runtime actually executed. An absent,
   * foreign, copied, or caller-constructed handle is refused, never interpreted.
   */
  execution_handle?: unknown;
}

export type AdapterExecutionObservationResult =
  | { ok: true; observation: AdapterEnvironmentObservation }
  | { ok: false; reason: string };

/**
 * What a run claims it executed. The artifacts are optional: when absent, the admitted artifact set
 * itself is verified; when present, they are checked AGAINST the admission, and any artifact that
 * does not match the exact admitted one is a deviation, never a pass.
 */
export interface AdapterExecutionVerificationInput {
  /**
   * The handle `compile` minted for the artifact set this run claims to be. Required at runtime: an
   * absent, foreign, copied, or caller-constructed handle is refused, never interpreted.
   */
  execution_handle?: unknown;
  resolution_receipt?: ResolutionReceipt;
  role_envelope?: RoleEnvelope;
  execution_contract?: ExecutionContract;
}

export type AdapterExecutionVerificationResult =
  | { ok: true; verification: ExecutionVerificationResult; observation: AdapterEnvironmentObservation }
  | { ok: false; reason: string };

/**
 * The narrow adapter-facing surface. Three operations, no lifecycle, no generic trust minter: admit
 * an artifact set, report that the runtime executed it, and verify a run against it.
 */
export interface AdapterIntegration {
  compile(input: unknown): AdapterCompileResult;
  /**
   * Report that this runtime ACTUALLY executed the artifact set a handle admitted. This is the
   * substrate's execution observation, not a caller declaration: it records this integration's own
   * environment observation (including the session identity) against the admission, and it is the
   * only thing that makes that artifact set eligible for execution evidence at all.
   */
  observeExecution(input: AdapterExecutionObservationInput): AdapterExecutionObservationResult;
  verifyExecution(input: AdapterExecutionVerificationInput): AdapterExecutionVerificationResult;
}

// ── Process-local execution admissions ──────────────────────────────────────

/** One admitted compile: the exact artifact identities this process bound to an execution handle. */
interface ExecutionAdmission {
  readonly receipt_identity: string;
  readonly execution_contract_identity: string;
  readonly role_envelope_identity: string;
  readonly execution_target: ExecutionTargetName;
  /** The admitted artifacts themselves, so a handle-only verification is possible. */
  readonly artifacts: CompiledGovernance;
  /**
   * What this integration observed when the runtime actually executed this artifact set. ABSENT until
   * the substrate reports it: admission is not execution, and this field is the only thing that moves
   * an admission from admitted-for-execution to observed-executed. It is process-local and lives no
   * longer than the admission it belongs to.
   */
  execution_observation?: AdapterEnvironmentObservation;
}

/**
 * The process-local admission store. It is not a run database: it holds one entry per compilation
 * this process admitted for execution, keyed by an unguessable token, and nothing else. It is not
 * exported, not persisted, and not reachable from the package surface.
 *
 * ponytail: FIFO cap, oldest admission dropped first. Raise it only if a single process legitimately
 * needs more than 64 simultaneously live execution handles.
 */
const EXECUTION_ADMISSIONS = new Map<string, ExecutionAdmission>();
const MAX_EXECUTION_ADMISSIONS = 64;

/** Mint the opaque handle for one admission. Random, not derived from caller data, never reused. */
function mintExecutionHandle(admission: ExecutionAdmission): string {
  const handle = randomBytes(24).toString('hex');
  EXECUTION_ADMISSIONS.set(handle, admission);
  while (EXECUTION_ADMISSIONS.size > MAX_EXECUTION_ADMISSIONS) {
    const oldest = EXECUTION_ADMISSIONS.keys().next().value;
    if (oldest === undefined) break;
    EXECUTION_ADMISSIONS.delete(oldest);
  }
  return handle;
}

/** Resolve a handle to the admission this process minted, or nothing. Never trusts the argument. */
function readExecutionAdmission(handle: unknown): ExecutionAdmission | undefined {
  if (typeof handle !== 'string' || handle.length === 0) return undefined;
  return EXECUTION_ADMISSIONS.get(handle);
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

/** The one admitted input of an execution observation: the handle, and nothing a caller can assert. */
const EXECUTION_OBSERVATION_KEYS = ['execution_handle'] as const;

const EXECUTION_VERIFICATION_KEYS = [
  'execution_handle',
  'resolution_receipt',
  'role_envelope',
  'execution_contract',
] as const;

/**
 * Create the one supported adapter integration.
 *
 * Fail-closed at construction for a malformed adapter identity, and fail-closed at every operation
 * for an adapter whose observation is unusable. Nothing here schedules, spawns, retries, or persists:
 * the integration owns one observation callback and one bounded process-local admission map.
 */
export function createAdapterIntegration(options: AdapterIntegrationOptions): AdapterIntegration {
  if (
    !isRecord(options) ||
    !isNonEmptyString(options.name) ||
    typeof options.version !== 'string' ||
    typeof options.observeEnvironment !== 'function' ||
    (options.observeCapabilities !== undefined && typeof options.observeCapabilities !== 'function')
  ) {
    throw new TypeError(
      'createAdapterIntegration requires { name, version, observeEnvironment, observeCapabilities? }: an adapter must name itself and report what it can observe',
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

      // Observed: the model this runtime actually reports as active. Issued through the Wave 1
      // exact-issuance verifier, which vouches for precisely this attestation and nothing else.
      const modelInventory = {
        source_kind: 'model_registry' as const,
        source: substrate.name,
        payload: { models: [observed.model] },
      };
      // The adapter's own observation, or no capability at all. An axis the adapter observed true is
      // recorded true; an axis it observed false, and an axis it did not observe, are both recorded
      // not-capable — so no dimension can ever be reported ENFORCED from something nobody observed.
      // A target name, an adapter name, and a source name never imply a capability: this object is
      // built from the adapter's observations alone and from nothing else.
      const capabilityAxes = Object.fromEntries(
        TARGET_CAPABILITY_KEYS.map((axis) => [axis, capabilities.observed?.[axis] === true] as const),
      ) as Record<TargetCapabilityKey, boolean>;
      // Core promotes the observations into ONE attested capability payload; the adapter never sees
      // the boundary that vouches for it, and a caller cannot supply either half of this pair.
      const capabilityAttestation = {
        source_kind: 'execution_adapter' as const,
        source: substrate.name,
        payload: { target: observed.target, capabilities: capabilityAxes },
      };
      const capabilityEvidence =
        capabilities.observed === undefined
          ? // No observer: the truthful statement is that nothing is attested, and it is recorded as
            // the unattested claim it is rather than as unavailable evidence.
            { capability_claim: { name: observed.target, capabilities: capabilityAxes } }
          : {
              capability_attestation: capabilityAttestation,
              capability_attestation_verifier: createAttestationVerifier([capabilityAttestation]),
            };

      const compiled = compileForTarget({
        task_contract: input.task_contract as TaskContract,
        authority_binder: input.authority_binder as AuthorityBinder,
        ...(input.assertion_binder !== undefined ? { assertion_binder: input.assertion_binder as AssertionBinder } : {}),
        ...(input.correction_binder !== undefined
          ? { correction_binder: input.correction_binder as CorrectionAuthorityBinder }
          : {}),
        model_profile: input.model_profile as ModelProfile,
        model_availability_attestation: modelInventory,
        model_availability_attestation_verifier: createAttestationVerifier([modelInventory]),
        ...capabilityEvidence,
      });
      if (!compiled.ok) return { ok: false, errors: compiled.errors };

      const artifacts = compiled.compiled;
      // Not frozen: the execution observation is recorded on this record later, and until it is, this
      // admission is admitted-for-execution and nothing more.
      const execution_handle = mintExecutionHandle({
        receipt_identity: artifacts.resolution_receipt.receipt_identity,
        execution_contract_identity: artifacts.resolution_receipt.execution_contract_identity,
        role_envelope_identity: evidenceIdentity(artifacts.role_envelope),
        execution_target: observed.target,
        artifacts,
      });
      return { ok: true, compiled: artifacts, observation: observed, execution_handle };
    },

    observeExecution(input) {
      if (!isRecord(input)) {
        return { ok: false, reason: 'an execution observation must be an object naming the execution_handle of the admitted artifact set' };
      }
      const unknown = unknownKeys(input, EXECUTION_OBSERVATION_KEYS);
      if (unknown.length > 0) {
        return {
          ok: false,
          reason: `'${unknown[0]}' is not accepted here: whether an artifact executed is observed by the runtime that ran it, never declared by a caller`,
        };
      }
      const observed = observeOrFail();
      if ('reason' in observed) return { ok: false, reason: observed.reason };
      const admission = readExecutionAdmission(input.execution_handle);
      if (admission === undefined) {
        return {
          ok: false,
          reason:
            'an execution observation requires the execution handle this integration minted when it admitted the artifact for execution; a handle this process never minted cannot be reported as executed',
        };
      }
      if (admission.execution_target !== observed.target) {
        return {
          ok: false,
          reason: `the admitted artifact is for '${admission.execution_target}' and this integration currently observes '${observed.target}', so it cannot report that runtime as executing it`,
        };
      }
      admission.execution_observation = observed;
      return { ok: true, observation: observed };
    },

    verifyExecution(input) {
      const unknown = unknownKeys(input, EXECUTION_VERIFICATION_KEYS);
      if (isRecord(input) && unknown.length > 0) {
        return {
          ok: false,
          reason: `'${unknown[0]}' is not accepted here: execution is verified against the observation the runtime reported, never against a claim supplied with the artifacts`,
        };
      }
      const observed = observeOrFail();
      if ('reason' in observed) return { ok: false, reason: observed.reason };

      // The exact artifact link (F1). No admission, no evidence: supplying a receipt, an envelope,
      // and a contract at verification time is a claim about a run, not a record that this process
      // admitted that artifact for execution.
      const admission = readExecutionAdmission(input?.execution_handle);
      if (admission === undefined) {
        return {
          ok: false,
          reason:
            'execution verification requires the execution handle this integration minted when it admitted the artifact for execution; artifacts supplied at verification time are a claim about a run, not proof this process admitted them',
        };
      }
      if (admission.execution_target !== observed.target) {
        return {
          ok: false,
          reason: `the admitted artifact is for '${admission.execution_target}' and this integration currently observes '${observed.target}'`,
        };
      }

      // Admission is NOT execution (F1). An admitted artifact set that the runtime never reported
      // executing has no execution evidence: same process, same model, same session, and the
      // artifacts in hand are all claims about a run, and none of them is a record that it ran.
      const executed = admission.execution_observation;
      if (executed === undefined) {
        return {
          ok: false,
          reason:
            'this artifact set was admitted for execution and this integration has observed no execution of it, so no execution evidence can be issued; the runtime that executed it must report that with observeExecution first',
        };
      }
      // The run is bound to the session it was OBSERVED in. A session that is not the observed one is
      // not the run this admission has evidence for, and target/model agreement does not change that.
      if (executed.session_identity !== observed.session_identity) {
        return {
          ok: false,
          reason: `the admitted artifact set was observed executing in session '${executed.session_identity}' and this integration currently observes session '${observed.session_identity}', which is not that run`,
        };
      }

      const suppliedReceipt = input?.resolution_receipt;
      const suppliedEnvelope = input?.role_envelope;
      const suppliedContract = input?.execution_contract;
      if (suppliedReceipt !== undefined && !isRecord(suppliedReceipt)) {
        return { ok: false, reason: 'resolution_receipt must be the compiled receipt when it is supplied' };
      }
      if (suppliedEnvelope !== undefined && !isRecord(suppliedEnvelope)) {
        return { ok: false, reason: 'role_envelope must be the compiled envelope when it is supplied' };
      }
      if (suppliedContract !== undefined && !isRecord(suppliedContract)) {
        return { ok: false, reason: 'execution_contract must be the resolved contract when it is supplied' };
      }
      const receipt = (suppliedReceipt ?? admission.artifacts.resolution_receipt) as ResolutionReceipt;
      const envelope = (suppliedEnvelope ?? admission.artifacts.role_envelope) as RoleEnvelope;
      const contract = (suppliedContract ?? admission.artifacts.execution_contract) as ExecutionContract;

      // The evidence names the ADMITTED artifact identities and the RUN that was observed — never the
      // artifacts handed in with this call, and never the model or session this verification happens
      // to be looking at. The supplied artifacts are what the verifier compares against that
      // evidence, so an artifact that was not the admitted one is reported as a deviation, not obeyed.
      const issuer = createExecutionAttestationIssuer(substrate);
      const issued = issuer.issue({
        resolution_receipt_identity: admission.receipt_identity,
        execution_contract_identity: admission.execution_contract_identity,
        role_envelope_identity: admission.role_envelope_identity,
        execution_target: admission.execution_target,
        model: executed.model,
        session: { session_identity: executed.session_identity },
      });
      if (!issued.ok) {
        return {
          ok: false,
          reason: `this integration could not issue execution evidence for the observed session (${issued.errors[0]?.message ?? 'unknown reason'})`,
        };
      }

      return {
        ok: true,
        observation: observed,
        verification: verifyExecutionAttestation({
          execution_attestation: issued.attestation,
          resolution_receipt: receipt,
          role_envelope: envelope,
          execution_contract: contract,
        }),
      };
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
