/**
 * ExecutionAttestation — post-execution conformance evidence (v0.1.1 Wave 2 — T5).
 *
 * Charter compiles governance and executes nothing. An ExecutionAttestation is the evidence a
 * substrate that ACTUALLY RAN the work emits, and verification answers exactly one question:
 * does that run conform to the compiled governance artifact it claims to be?
 *
 *   ResolutionReceipt        proves what was compiled and resolved (Phase 1–5)
 *   RoleEnvelope             is the instruction artifact that was handed to an executor (Phase 4)
 *   ExecutionAttestation     says what actually ran, and is checked against both
 *
 * The two are not interchangeable: a receipt is evidence about a compilation, an attestation is
 * evidence about an execution. Only the second can move an assertion from `ASSERTION_BOUND` to
 * actually verified, and only when the bound verifier's execution is itself evidenced.
 *
 *   verifyExecutionAttestation(...)   EXECUTION_CONFORMANT, or the exact deviations
 *
 * Purity is the contract here: no clock, no randomness, no registry, no store, no lifecycle. The
 * verifier is a pure function over values, it returns every deviation it can name (never a score,
 * never a probability, never a partial pass), and it holds no state between calls. Charter records
 * no session, no run, no retry, and no workflow state — that belongs to the substrate.
 *
 * TRUST (W1_ATTESTATION_SELF_PROMOTION, repeated at the execution layer): a caller-authored object
 * with the right fields is not execution evidence. Evidence must cross the explicit
 * substrate/adapter issuance boundary (`createExecutionAttestationIssuer`, INTERNAL — absent from
 * the package surface), and `verifyExecutionAttestation` accepts only evidence this process actually
 * issued. A copy, a clone, and a JSON roundtrip are therefore all refused, and there is no
 * signatures/PKI infrastructure in this release.
 *
 * Only relevant dimensions are required: a contract that declares no tool policy, no hard
 * enforcement requirement, and no assertions is not asked for tool, enforcement, or verifier
 * evidence — and a dimension that the substrate could not observe stays absent instead of being
 * invented, which fails closed exactly where the contract really required it.
 */

import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  EXECUTION_TARGETS,
  type EnforcementConstraint,
  type ExecutionTargetName,
} from '../contracts/task-contract.ts';
import type { RoleEnvelope } from '../envelopes/role-envelope.ts';
import { requiresFreshSession } from '../enforcement/target-binding.ts';
import { evidenceIdentity } from '../provenance/evidence.ts';
import type { ResolutionReceipt } from '../receipt/resolution-receipt.ts';
import {
  isIssuedExecutionAttestation,
  markIssuedExecutionAttestation,
} from './trusted-execution-boundary.ts';

/** The frozen v0.1 attestation shape version. */
export const EXECUTION_ATTESTATION_VERSION = 'charter/v0.1' as const;

/** Identity of the substrate/adapter that issued the evidence. */
export interface ExecutionSubstrateIdentity {
  /** Name of the issuing substrate/adapter component. */
  name: string;
  /** Version that component reports, where one is reported. Absent means not reported. */
  version?: string;
}

/** One bound verifier's actual execution outcome, as the substrate observed it. */
export interface AssertionExecutionEvidence {
  /** The assertion reference exactly as the compiled contract declared it. */
  reference: string;
  /** The verifier identity that ran. Must match the bound verifier for the evidence to count. */
  verifier: string;
  /** Whether that verifier actually ran and passed. */
  passed: boolean;
}

/**
 * What a run actually did, observed by the component that ran it.
 *
 * Every field is evidence ABOUT A RUN, never a restatement of the compiled artifact: the artifact is
 * identified by identity fields and compared, never copied in. Dimensions the substrate could not
 * observe are OMITTED rather than filled with a convenient default; an omitted dimension fails
 * closed only when the compiled governance actually required it.
 */
export interface ExecutionAttestationObservations {
  /** Identity of the ResolutionReceipt this run claims to conform to. */
  resolution_receipt_identity: string;
  /** Identity of the ExecutionContract this run claims to have executed. */
  execution_contract_identity: string;
  /** Identity of the RoleEnvelope (`evidenceIdentity` of the compiled envelope) this run executed. */
  role_envelope_identity: string;
  /** The execution target the run actually executed on. */
  execution_target: ExecutionTargetName;
  /** The actual provider/model identity the substrate ran this work on. */
  model: string;
  /** The actual execution/session this work ran in. */
  session: { session_identity: string; fresh?: boolean };
  /** The actual tool ceiling in effect during the run, when the substrate could observe it. */
  tools?: string[];
  /** The constraints the substrate actually hard-enforced during the run, when observable. */
  enforcement_in_effect?: EnforcementConstraint[];
  /** Actual per-verifier execution outcomes, when the substrate could observe them. */
  assertion_executions?: AssertionExecutionEvidence[];
}

/** Issued, immutable execution evidence. */
export interface ExecutionAttestation extends ExecutionAttestationObservations {
  readonly version: typeof EXECUTION_ATTESTATION_VERSION;
  /** The substrate/adapter that issued this evidence. Supplied by the boundary, never by input. */
  readonly substrate: ExecutionSubstrateIdentity;
  /** SHA-256 over every observation, canonically serialized. Deterministic, never temporal. */
  readonly attestation_identity: string;
}

/**
 * The trusted execution-evidence boundary, at the position a substrate adapter occupies.
 *
 * INTERNAL — NOT PACKAGE SURFACE. `createExecutionAttestationIssuer` is the only thing that can mint
 * one, so it is deliberately absent from the exports of `index.ts`: an ordinary package consumer
 * cannot author trusted execution evidence at all. A caller who mints a boundary over their own
 * observations has reached inside the package rather than through its surface, which this release
 * does not attempt to defend against (it defends the package surface, not the process).
 */
export interface ExecutionAttestationIssuer {
  /** The substrate identity every attestation this boundary issues will carry. */
  readonly substrate: ExecutionSubstrateIdentity;
  /** Issue immutable evidence for one run's observations, fail-closed on malformed input. */
  issue(
    observations: unknown,
  ): { ok: true; attestation: ExecutionAttestation } | { ok: false; errors: CharterError[] };
}

const OBSERVATION_KEYS = [
  'resolution_receipt_identity',
  'execution_contract_identity',
  'role_envelope_identity',
  'execution_target',
  'model',
  'session',
  'substrate',
  'tools',
  'enforcement_in_effect',
  'assertion_executions',
] as const;
const SESSION_KEYS = ['session_identity', 'fresh'] as const;
const SUBSTRATE_KEYS = ['name', 'version'] as const;
const ASSERTION_EXECUTION_KEYS = ['reference', 'verifier', 'passed'] as const;

/**
 * Mint the one trusted execution-evidence boundary of a substrate adapter.
 *
 * INTERNAL — NOT PACKAGE SURFACE (see `ExecutionAttestationIssuer`). The substrate identity is
 * supplied by the component that owns the boundary, at the moment it is created, and it is the only
 * identity any attestation that boundary issues can carry: the issuer cannot be retargeted, and its
 * identity is not a field a caller can edit into a different claim. A boundary validates its own
 * observations fail-closed, freezes what it issues, and marks it in the process-local store, so only
 * an issuer's own output is accepted as trusted execution evidence.
 */
export function createExecutionAttestationIssuer(substrate: ExecutionSubstrateIdentity): ExecutionAttestationIssuer {
  const issuer: ExecutionAttestationIssuer = {
    substrate: Object.freeze({ ...substrate }),
    issue(observations) {
      const errors: CharterError[] = [];
      const err = (code: CharterErrorCode, path: string, message: string): void => {
        errors.push({ code, message, path });
      };
      const checked = checkObservations(observations, issuer.substrate, err);
      if (checked === undefined || errors.length > 0) {
        return { ok: false, errors };
      }
      const payload = { version: EXECUTION_ATTESTATION_VERSION, ...checked };
      // Frozen before return and marked in the non-exported store: the value is evidence others may
      // read, never one they can edit, and never one a copy of which is also evidence.
      return {
        ok: true,
        attestation: markIssuedExecutionAttestation(
          deepFreeze({ ...payload, attestation_identity: evidenceIdentity(payload) }),
        ),
      };
    },
  };
  return Object.freeze(issuer);
}

// ── Conformance verification ────────────────────────────────────────────────

/** The only two verdicts. No score, no probability, no partial pass, no lifecycle state. */
export const EXECUTION_VERDICTS = ['EXECUTION_CONFORMANT', 'NON_CONFORMANT'] as const;
export type ExecutionVerdict = (typeof EXECUTION_VERDICTS)[number];

/** Exact deviation vocabulary. Every deviation names one violated identity or one missing evidence. */
export const EXECUTION_DEVIATION_CODES = [
  'UNTRUSTED_EXECUTION_EVIDENCE',
  'RESOLUTION_RECEIPT_MISMATCH',
  'EXECUTION_CONTRACT_MISMATCH',
  'ROLE_ENVELOPE_MISMATCH',
  'EXECUTION_TARGET_MISMATCH',
  'MODEL_MISMATCH',
  'FRESH_SESSION_NOT_EVIDENCED',
  'TOOL_POLICY_NOT_EVIDENCED',
  'TOOL_POLICY_VIOLATION',
  'ENFORCEMENT_NOT_EVIDENCED',
] as const;
export type ExecutionDeviationCode = (typeof EXECUTION_DEVIATION_CODES)[number];

export interface ExecutionDeviation {
  readonly code: ExecutionDeviationCode;
  readonly path: string;
  readonly detail: string;
}

/**
 * What the run's verifier evidence establishes about acceptance. `ACCEPTANCE_NOT_DECLARED` is not a
 * soft PASS: a contract that declares no assertion has no assertion to verify, and Charter says
 * exactly that rather than inventing acceptance.
 */
export const ACCEPTANCE_EVIDENCE_STATUSES = [
  'ACCEPTANCE_VERIFIED',
  'ACCEPTANCE_NOT_VERIFIED',
  'ACCEPTANCE_NOT_DECLARED',
] as const;
export type AcceptanceEvidenceStatus = (typeof ACCEPTANCE_EVIDENCE_STATUSES)[number];

export interface AcceptanceVerification {
  readonly status: AcceptanceEvidenceStatus;
  readonly verified: readonly { reference: string; verifier: string }[];
  readonly unverified: readonly { reference: string; verifier: string; reason: string }[];
}

/** The compiled governance artifacts plus the submitted execution evidence they are checked against. */
export interface ExecutionVerificationInput {
  /** Submitted execution evidence. A caller-authored object is refused, not read. */
  execution_attestation: unknown;
  /** The receipt of the compilation this run claims to conform to. */
  resolution_receipt: ResolutionReceipt;
  /** The compiled instruction artifact this run claims to have executed. */
  role_envelope: RoleEnvelope;
  /** The resolved contract behind both, so required enforcement is read from resolved truth. */
  execution_contract: ExecutionContract;
}

export type ExecutionVerificationResult =
  | {
      readonly verdict: 'EXECUTION_CONFORMANT';
      readonly deviations: readonly [];
      readonly acceptance: AcceptanceVerification;
      readonly execution_attestation_identity: string;
      readonly substrate: ExecutionSubstrateIdentity;
    }
  | {
      readonly verdict: 'NON_CONFORMANT';
      readonly deviations: readonly ExecutionDeviation[];
      readonly acceptance: AcceptanceVerification;
      readonly execution_attestation_identity?: string;
      readonly substrate?: ExecutionSubstrateIdentity;
    };

/**
 * Verify that one run conforms to one compiled governance artifact.
 *
 * Pure, deterministic, and total: the same inputs always produce the same verdict with the same
 * ordered deviations, every dimension the contract requires is checked, and no dimension it does not
 * require is demanded. Deviations are collected in a fixed order rather than short-circuiting, so a
 * near-miss reports everything that disagrees instead of the first thing.
 */
export function verifyExecutionAttestation(input: ExecutionVerificationInput): ExecutionVerificationResult {
  const submitted: unknown = input?.execution_attestation;
  const receipt: ResolutionReceipt | undefined = input?.resolution_receipt;
  const envelope: RoleEnvelope | undefined = input?.role_envelope;
  const contract: ExecutionContract | undefined = input?.execution_contract;

  // The only accepted evidence is evidence this process issued. Shape proves nothing: a caller can
  // reproduce every field, so nothing about the object's contents is read as trust.
  if (!isIssuedExecutionAttestation(submitted)) {
    const acceptance = evaluateAcceptance(envelope, undefined, false);
    return {
      verdict: 'NON_CONFORMANT',
      deviations: [
        {
          code: 'UNTRUSTED_EXECUTION_EVIDENCE',
          path: 'execution_attestation',
          detail:
            'execution evidence must be an attestation issued by an execution-attestation boundary in this process; a caller-authored object, a copy, a clone, and a JSON roundtrip are all claims, not evidence',
        },
      ],
      acceptance,
    };
  }
  const attestation = submitted as ExecutionAttestation;
  const deviations: ExecutionDeviation[] = [];
  const deviate = (code: ExecutionDeviationCode, path: string, detail: string): void => {
    deviations.push({ code, path, detail });
  };

  const contractIdentity = contract === undefined ? undefined : evidenceIdentity(contract);
  const envelopeIdentity = envelope === undefined ? undefined : evidenceIdentity(envelope);

  // Identity: the evidence must name the exact compiled artifacts it claims to be the run of — the
  // receipt, the resolved contract behind it, and the instruction artifact that was executed.
  if (receipt === undefined || attestation.resolution_receipt_identity !== receipt.receipt_identity) {
    deviate(
      'RESOLUTION_RECEIPT_MISMATCH',
      'resolution_receipt.receipt_identity',
      `evidence claims receipt ${attestation.resolution_receipt_identity}, which is not the receipt supplied (${receipt?.receipt_identity ?? 'none'})`,
    );
  }
  if (
    receipt === undefined ||
    contractIdentity === undefined ||
    attestation.execution_contract_identity !== receipt.execution_contract_identity ||
    receipt.execution_contract_identity !== contractIdentity
  ) {
    deviate(
      'EXECUTION_CONTRACT_MISMATCH',
      'execution_contract',
      `evidence claims contract ${attestation.execution_contract_identity}, the supplied contract is ${contractIdentity ?? 'none'}, and the receipt committed to ${receipt?.execution_contract_identity ?? 'none'}`,
    );
  }
  if (envelopeIdentity === undefined || attestation.role_envelope_identity !== envelopeIdentity) {
    deviate(
      'ROLE_ENVELOPE_MISMATCH',
      'role_envelope',
      `evidence executed envelope ${attestation.role_envelope_identity}; the supplied envelope is ${envelopeIdentity ?? 'none'}`,
    );
  }

  // Target and model: what the substrate actually ran, against the target and model the compiled
  // governance selected. Neither is read out of the artifact and echoed back.
  const selectedTarget = envelope?.execution_target;
  if (
    selectedTarget === undefined ||
    attestation.execution_target !== selectedTarget ||
    (contract !== undefined && contract.execution_target !== selectedTarget)
  ) {
    deviate(
      'EXECUTION_TARGET_MISMATCH',
      'execution_target',
      `the run executed on ${attestation.execution_target}; the compiled governance selects ${selectedTarget ?? 'none'}`,
    );
  }
  const selectedModel = envelope?.model?.resolved;
  if (selectedModel === undefined || attestation.model !== selectedModel) {
    deviate(
      'MODEL_MISMATCH',
      'model',
      `the run actually executed on ${attestation.model}; the compiled governance resolved ${selectedModel ?? 'none'}`,
    );
  }

  // Freshness is required only where the contract requires review outside the working session.
  if (requiresFreshSession(envelope?.acceptance?.review) && attestation.session.fresh !== true) {
    deviate(
      'FRESH_SESSION_NOT_EVIDENCED',
      'session.fresh',
      `this contract requires a fresh session for review and the evidence ${attestation.session.fresh === false ? 'records a session that is not fresh' : 'carries no fresh-session observation'}`,
    );
  }

  // Tool policy: required only where the contract declares one. The ceiling is exact, and a run
  // reporting a tool outside it violated the policy rather than being re-read as something softer.
  const declaredTools = envelope?.execution_policy?.allowed_tools ?? [];
  if (declaredTools.length > 0) {
    if (attestation.tools === undefined) {
      deviate(
        'TOOL_POLICY_NOT_EVIDENCED',
        'tools',
        `this contract declares a tool policy (${declaredTools.join(', ')}) and the evidence carries no tool ceiling in effect`,
      );
    } else {
      for (const tool of attestation.tools) {
        if (!declaredTools.includes(tool)) {
          deviate(
            'TOOL_POLICY_VIOLATION',
            'tools',
            `the run had tool '${tool}' in effect, which is outside the declared tool policy (${declaredTools.join(', ')})`,
          );
        }
      }
    }
  }

  // Hard enforcement: required only where the resolved contract requires it. Phase 3 already proved
  // the target could enforce it; this checks the run actually did.
  const required = contract?.requirements?.enforcement;
  const inEffect = attestation.enforcement_in_effect ?? [];
  for (const constraint of ENFORCEMENT_CONSTRAINTS) {
    if (required?.[constraint] !== 'required') continue;
    if (!inEffect.includes(constraint)) {
      deviate(
        'ENFORCEMENT_NOT_EVIDENCED',
        `enforcement_in_effect.${constraint}`,
        `this contract requires '${constraint}' hard-enforced and the evidence does not report it in effect during the run`,
      );
    }
  }

  const acceptance = evaluateAcceptance(envelope, attestation, deviations.length === 0);
  if (deviations.length > 0) {
    return { verdict: 'NON_CONFORMANT', deviations, acceptance, execution_attestation_identity: attestation.attestation_identity, substrate: attestation.substrate };
  }
  return {
    verdict: 'EXECUTION_CONFORMANT',
    deviations: [],
    acceptance,
    execution_attestation_identity: attestation.attestation_identity,
    substrate: attestation.substrate,
  };
}

/**
 * What the verifier evidence establishes about acceptance (T4 → T5, X8/X9).
 *
 * A bound assertion becomes actually verified only when the exact verifier identity the contract
 * bound reports a successful execution. A different verifier's success, a reported failure, and
 * silence are all NOT VERIFIED — a bound assertion is `ASSERTION_BOUND`, and only real execution
 * evidence of that verifier's run can move it.
 */
function evaluateAcceptance(
  envelope: RoleEnvelope | undefined,
  attestation: ExecutionAttestation | undefined,
  conformant: boolean,
): AcceptanceVerification {
  const bindings = envelope?.assertion_bindings ?? [];
  if (bindings.length === 0) {
    return { status: 'ACCEPTANCE_NOT_DECLARED', verified: [], unverified: [] };
  }
  const executions = attestation?.assertion_executions ?? [];
  const verified: { reference: string; verifier: string }[] = [];
  const unverified: { reference: string; verifier: string; reason: string }[] = [];
  for (const binding of bindings) {
    const forReference = executions.filter((execution) => execution.reference === binding.reference);
    const exact = forReference.filter((execution) => execution.verifier === binding.verifier);
    if (exact.some((execution) => execution.passed === true)) {
      verified.push({ reference: binding.reference, verifier: binding.verifier });
      continue;
    }
    const reason =
      exact.length > 0
        ? 'the bound verifier ran and reported failure'
        : forReference.length > 0
          ? 'the recorded execution names a verifier identity other than the bound one'
          : attestation === undefined
            ? 'no trusted execution evidence was supplied'
            : 'the evidence carries no verifier execution outcome for this binding';
    unverified.push({ reference: binding.reference, verifier: binding.verifier, reason });
  }
  if (!conformant || unverified.length > 0) {
    return { status: 'ACCEPTANCE_NOT_VERIFIED', verified, unverified };
  }
  return { status: 'ACCEPTANCE_VERIFIED', verified, unverified: [] };
}

// ── Issuance validation ─────────────────────────────────────────────────────

/**
 * Validate one run's observations fail-closed. Required identity fields must be present and
 * non-empty, the target and the enforcement vocabulary are closed, and every optional dimension is
 * checked for shape when present and OMITTED only by absence — never defaulted into existence.
 */
function checkObservations(
  raw: unknown,
  substrate: ExecutionSubstrateIdentity,
  err: (code: CharterErrorCode, path: string, message: string) => void,
): (ExecutionAttestationObservations & { substrate: ExecutionSubstrateIdentity }) | undefined {
  if (!isRecord(raw)) {
    err('INVALID_TASK_CONTRACT', '', 'execution observations must be an object');
    return undefined;
  }
  checkUnknownKeys(raw, OBSERVATION_KEYS, '', err);
  let complete = true;
  for (const key of ['resolution_receipt_identity', 'execution_contract_identity', 'role_envelope_identity', 'model'] as const) {
    if (!isNonEmptyString(raw[key])) {
      err('INVALID_TASK_CONTRACT', key, `${key} must name the artifact or identity the run actually used`);
      complete = false;
    }
  }
  if (!isOneOf(raw.execution_target, EXECUTION_TARGETS)) {
    err('INVALID_TASK_CONTRACT', 'execution_target', `execution_target must be one of ${EXECUTION_TARGETS.join('|')}`);
    complete = false;
  }
  const session = checkSession(raw.session, err);
  if (session === undefined) complete = false;
  // The issuing boundary's own identity is the substrate this evidence names. The submitted object
  // cannot declare a different issuer, so no caller can attribute a run to another component.
  if (raw.substrate !== undefined) {
    err(
      'CONTRACT_CONTRADICTION',
      'substrate',
      'substrate identity belongs to the issuing boundary, not to the observations; an issuer cannot be retargeted by its input',
    );
    complete = false;
  }
  const tools = checkOptionalStringList(raw.tools, 'tools', err);
  if (raw.tools !== undefined && tools === undefined) complete = false;
  const enforcement = checkEnforcementList(raw.enforcement_in_effect, err);
  if (raw.enforcement_in_effect !== undefined && enforcement === undefined) complete = false;
  const executions = checkAssertionExecutions(raw.assertion_executions, err);
  if (raw.assertion_executions !== undefined && executions === undefined) complete = false;
  if (!complete || session === undefined) return undefined;
  return {
    resolution_receipt_identity: raw.resolution_receipt_identity as string,
    execution_contract_identity: raw.execution_contract_identity as string,
    role_envelope_identity: raw.role_envelope_identity as string,
    execution_target: raw.execution_target as ExecutionTargetName,
    model: raw.model as string,
    session,
    substrate: { ...substrate },
    ...(tools !== undefined ? { tools } : {}),
    ...(enforcement !== undefined ? { enforcement_in_effect: enforcement } : {}),
    ...(executions !== undefined ? { assertion_executions: executions } : {}),
  };
}

function checkSession(
  raw: unknown,
  err: (code: CharterErrorCode, path: string, message: string) => void,
): { session_identity: string; fresh?: boolean } | undefined {
  if (!isRecord(raw)) {
    err('INVALID_TASK_CONTRACT', 'session', 'session must describe the execution session');
    return undefined;
  }
  checkUnknownKeys(raw, SESSION_KEYS, 'session', err);
  if (!isNonEmptyString(raw.session_identity)) {
    err('INVALID_TASK_CONTRACT', 'session.session_identity', 'session.session_identity must name the actual session');
    return undefined;
  }
  if (raw.fresh !== undefined && typeof raw.fresh !== 'boolean') {
    err('INVALID_TASK_CONTRACT', 'session.fresh', 'session.fresh must be a boolean when the substrate observed it');
    return undefined;
  }
  return { session_identity: raw.session_identity, ...(raw.fresh !== undefined ? { fresh: raw.fresh } : {}) };
}

function checkOptionalStringList(
  raw: unknown,
  path: string,
  err: (code: CharterErrorCode, p: string, message: string) => void,
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((item) => isNonEmptyString(item))) {
    err('INVALID_TASK_CONTRACT', path, `${path} must be a list of tool identities when the substrate observed one`);
    return undefined;
  }
  return [...(raw as string[])];
}

function checkEnforcementList(
  raw: unknown,
  err: (code: CharterErrorCode, path: string, message: string) => void,
): EnforcementConstraint[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((item) => isOneOf(item, ENFORCEMENT_CONSTRAINTS))) {
    err(
      'INVALID_TASK_CONTRACT',
      'enforcement_in_effect',
      `enforcement_in_effect must list canonical constraints (${ENFORCEMENT_CONSTRAINTS.join('|')})`,
    );
    return undefined;
  }
  return [...(raw as EnforcementConstraint[])];
}

function checkAssertionExecutions(
  raw: unknown,
  err: (code: CharterErrorCode, path: string, message: string) => void,
): AssertionExecutionEvidence[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    err('INVALID_TASK_CONTRACT', 'assertion_executions', 'assertion_executions must be a list');
    return undefined;
  }
  const executions: AssertionExecutionEvidence[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      err('INVALID_TASK_CONTRACT', 'assertion_executions', 'every assertion execution must be an object');
      return undefined;
    }
    checkUnknownKeys(entry, ASSERTION_EXECUTION_KEYS, 'assertion_executions', err);
    if (
      !isNonEmptyString(entry.reference) ||
      !isNonEmptyString(entry.verifier) ||
      typeof entry.passed !== 'boolean'
    ) {
      err(
        'INVALID_TASK_CONTRACT',
        'assertion_executions',
        'every assertion execution must name its reference, the verifier identity that ran, and whether it passed',
      );
      return undefined;
    }
    executions.push({ reference: entry.reference, verifier: entry.verifier, passed: entry.passed });
  }
  return executions;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  err: (code: CharterErrorCode, path: string, message: string) => void,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const path = prefix ? `${prefix}.${key}` : key;
      err('INVALID_TASK_CONTRACT', path, `unknown field '${path}'`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
