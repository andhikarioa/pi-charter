/**
 * The minimum Pi-native bridge (v0.1.1 Wave 2 — U2).
 *
 * Without this module, using Charter from Pi meant a handwritten temporary TypeScript script that
 * composed the pipeline by hand and invented its own environment evidence. The bridge replaces that
 * with two thin operations over the compiled package:
 *
 *   compileViaPi          compile governance for the ACTIVE Pi session
 *   verifyExecutionViaPi  verify what this session actually ran against that compiled governance
 *
 * What makes it a bridge rather than a convenience wrapper is where its evidence comes from. The
 * capability axes and the model inventory are NOT accepted from the caller: they are derived from the
 * actual Pi environment this process is running in (`PI_PROVIDER`, `PI_MODEL`, `PI_SESSION_ID`) and
 * from this adapter's own package metadata. A caller cannot pass booleans, a model list, or a source
 * name into it, so nothing a caller can supply becomes attested environment truth (H2, T2).
 *
 * What the bridge truthfully does NOT attest, and says so by omission:
 *
 *   capability enforcement   the bridge does not own execution, so it cannot observe whether the
 *                            substrate hard-enforces a tool ceiling, a file scope, a model, a fresh
 *                            session, or independent review. It therefore issues an explicit
 *                            UNATTESTED capability claim with no axis claimed true. A dimension a
 *                            real substrate does enforce must be attested by that substrate's own
 *                            adapter, which owns the boundary to issue it.
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

import type { AssertionBinder } from '../core/acceptance/assertion-binding.ts';
import { createAttestationVerifier } from '../core/attestation/attestation.ts';
import type { AuthorityBinder } from '../core/authority/binder.ts';
import type { CompileForTargetInput, CompiledGovernance } from '../core/compile/compile-for-target.ts';
import { compileForTarget } from '../core/compile/compile-for-target.ts';
import type { CharterError } from '../core/contracts/errors.ts';
import type { ExecutionContract } from '../core/contracts/execution-contract.ts';
import type { CorrectionAuthorityBinder } from '../core/correction/correction-authority.ts';
import type { RoleEnvelope } from '../core/envelopes/role-envelope.ts';
import {
  createExecutionAttestationIssuer,
  verifyExecutionAttestation,
  type ExecutionVerificationResult,
} from '../core/execution/execution-attestation.ts';
import { evidenceIdentity } from '../core/provenance/evidence.ts';
import type { ResolutionReceipt } from '../core/receipt/resolution-receipt.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';
import type { TaskContract } from '../core/contracts/task-contract.ts';

/** The one target the bridge mediates: the session this process is running in. */
export type PiMediatedTarget = 'parent';

/** What the bridge actually observed about the Pi environment it is running in. */
export interface PiEnvironmentObservation {
  readonly target: PiMediatedTarget;
  /** Provider identity the Pi session reports (H2). Observed, never supplied. */
  readonly provider: string;
  /** Model identity the Pi session reports as active (H2). Observed, never supplied. */
  readonly model: string;
  /** Session identity the Pi session reports. */
  readonly session_identity: string;
  /** Runtime the bridge is running under. */
  readonly runtime: string;
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

// ── compile ─────────────────────────────────────────────────────────────────

/**
 * What the bridge admits. Deliberately narrower than `CompileForTargetInput`: the environment
 * evidence channels are absent because the bridge derives them, so there is no field through which a
 * caller could supply capability booleans, a model list, or a trust boundary.
 */
export interface PiCompileInput {
  task_contract: TaskContract;
  authority_binder: AuthorityBinder;
  assertion_binder?: AssertionBinder;
  correction_binder?: CorrectionAuthorityBinder;
  model_profile: ModelProfile;
}

export type PiCompileResult =
  | { ok: true; compiled: CompiledGovernance; observation: PiEnvironmentObservation }
  | { ok: false; errors: CharterError[] };

const PI_COMPILE_KEYS = [
  'task_contract',
  'authority_binder',
  'assertion_binder',
  'correction_binder',
  'model_profile',
] as const;
/** Evidence this bridge derives for itself. Supplying any of it is refused, not ignored. */
const PI_BRIDGE_OWNED_KEYS = [
  'available',
  'model_availability_attestation',
  'model_availability_attestation_verifier',
  'capability_claim',
  'capability_attestation',
  'capability_attestation_verifier',
] as const;

/**
 * Compile governance for the active Pi session.
 *
 * The environment evidence is issued here, from the observation above: the model inventory is an
 * attested `model_registry` payload carrying the provider/model this session actually reports, and
 * the capability axes are an explicit UNATTESTED claim with no axis true, because the bridge cannot
 * observe substrate enforcement. Neither is caller-supplied, and neither is inferred from a target
 * name.
 */
export function compileViaPi(input: unknown): PiCompileResult {
  const errors: CharterError[] = [];
  const err = (path: string, message: string): void => {
    errors.push({ code: 'INVALID_TASK_CONTRACT', path, message });
  };
  if (!isRecord(input)) {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: '', message: 'bridge compile input must be an object' }] };
  }
  for (const key of Object.keys(input)) {
    if (PI_BRIDGE_OWNED_KEYS.includes(key as (typeof PI_BRIDGE_OWNED_KEYS)[number])) {
      err(
        key,
        `'${key}' is derived by the bridge from the actual Pi environment and is not accepted from a caller; supplying environment evidence here would be a claim dressed as observation`,
      );
      continue;
    }
    if (!PI_COMPILE_KEYS.includes(key as (typeof PI_COMPILE_KEYS)[number])) {
      err(key, `unknown field '${key}'`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const observation = observePiEnvironment();
  if (!observation.ok) {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: 'environment', message: observation.reason }] };
  }
  const observed = observation.observation;

  // This bridge answers for the session it runs in. Any other target is refused rather than answered
  // with evidence about a runtime the bridge cannot observe (T2 — no capability inferred from a name).
  const declaredTarget = isRecord(input.task_contract) ? input.task_contract.execution_target : undefined;
  if (declaredTarget !== observed.target) {
    return {
      ok: false,
      errors: [
        {
          code: 'UNSUPPORTED_BY_EXECUTION_TARGET',
          path: 'task_contract.execution_target',
          message: `the Pi bridge mediates only the active '${observed.target}' session; execution_target=${String(declaredTarget)} must be attested by the adapter that owns that runtime`,
        },
      ],
    };
  }

  // Observed: the model this session actually reports as active. Issued through the Wave 1 exact-issuance
  // verifier, which vouches for precisely this attestation and for nothing else.
  const modelInventory = {
    source_kind: 'model_registry' as const,
    source: 'pi-session-environment',
    payload: { models: [observed.model] },
  };
  // Claimed, never attested. The axes describe what THIS bridge hard-enforces, and it enforces no
  // dimension: it compiles governance and returns values, so it starts no session, applies no tool
  // ceiling, holds no file scope, and runs no verifier. Saying so is the honest, weaker-truth answer
  // (§19): the resolved truth for a policy dimension can then only be INSTRUCTED, `model_selection`
  // only UNSUPPORTED, and a contract that REQUIRES hard enforcement refuses here instead of receiving
  // an ENFORCED claim the bridge cannot stand behind. A substrate that really does enforce a dimension
  // attests it through that substrate's own adapter, which owns the issuance boundary for it.
  const capabilityClaim = {
    name: observed.target,
    capabilities: {
      model_selection: false,
      fresh_session: false,
      tool_ceiling: false,
      file_scope_enforcement: false,
      independent_review: false,
    },
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
    capability_claim: capabilityClaim,
  } satisfies CompileForTargetInput);
  if (!compiled.ok) return { ok: false, errors: compiled.errors };
  return { ok: true, compiled: compiled.compiled, observation: observed };
}

// ── verify_execution ────────────────────────────────────────────────────────

/** The compiled artifacts a run is checked against. The evidence itself comes from the observation. */
export interface PiExecutionVerificationInput {
  resolution_receipt: ResolutionReceipt;
  role_envelope: RoleEnvelope;
  execution_contract: ExecutionContract;
}

export type PiExecutionVerificationResult =
  | {
      ok: true;
      verification: ExecutionVerificationResult;
      observation: PiEnvironmentObservation;
    }
  | { ok: false; reason: string };

/**
 * Verify what this session actually ran against the governance compiled for it.
 *
 * The evidence is issued by this bridge's own execution-attestation boundary, from the same
 * observation: the model and session this process actually reports, and the target it actually is.
 * Everything the bridge cannot observe is omitted, so a contract that requires a tool ceiling, a
 * fresh session, or a verifier outcome gets a truthful deviation or `ACCEPTANCE_NOT_VERIFIED` rather
 * than a green result built on silence.
 *
 * Which artifact was compiled is transcribed from the artifacts presented, because Charter keeps no
 * compilation registry and no run history: the independent check is the observed run — the model, the
 * session, and the target this process actually is — which is exactly what a caller cannot assert.
 */
export function verifyExecutionViaPi(input: PiExecutionVerificationInput): PiExecutionVerificationResult {
  const observation = observePiEnvironment();
  if (!observation.ok) return { ok: false, reason: observation.reason };
  const observed = observation.observation;

  const receipt = input?.resolution_receipt;
  const envelope = input?.role_envelope;
  const contract = input?.execution_contract;
  if (!isRecord(receipt) || typeof receipt.receipt_identity !== 'string' || typeof receipt.execution_contract_identity !== 'string') {
    return { ok: false, reason: 'a resolution receipt is required to identify what was compiled' };
  }
  if (!isRecord(envelope)) {
    return { ok: false, reason: 'the compiled role envelope is required to identify what was executed' };
  }
  if (envelope.execution_target !== observed.target) {
    return {
      ok: false,
      reason: `the Pi bridge observes only the active '${observed.target}' session and cannot evidence an execution on target=${String(envelope.execution_target)}`,
    };
  }
  if (!isRecord(contract)) {
    return { ok: false, reason: 'the resolved execution contract is required to read required enforcement' };
  }

  // One boundary per bridge use, named for this adapter, issuing exactly one attestation: the process
  // identity of the boundary is what makes the evidence trusted, and nothing here can issue twice for
  // a different substrate.
  const issuer = createExecutionAttestationIssuer({ name: observed.adapter.name, version: observed.adapter.version });
  const issued = issuer.issue({
    resolution_receipt_identity: receipt.receipt_identity,
    execution_contract_identity: receipt.execution_contract_identity,
    role_envelope_identity: evidenceIdentity(envelope),
    execution_target: observed.target,
    model: observed.model,
    session: { session_identity: observed.session_identity },
  });
  if (!issued.ok) {
    return { ok: false, reason: `this bridge could not issue execution evidence for the observed session (${issued.errors[0]?.message ?? 'unknown reason'})` };
  }

  return {
    ok: true,
    observation: observed,
    verification: verifyExecutionAttestation({
      execution_attestation: issued.attestation,
      resolution_receipt: receipt as unknown as ResolutionReceipt,
      role_envelope: envelope as unknown as RoleEnvelope,
      execution_contract: contract as unknown as ExecutionContract,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
